const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

const dbPath = path.join(__dirname, 'villanos_y_planes');
let presetDatabase = {};

function loadDatabase() {
  try {
    const targetPath = fs.existsSync(dbPath) ? dbPath : path.join(__dirname, 'villanos_y_planes.json');
    
    if (fs.existsSync(targetPath)) {
      const rawData = fs.readFileSync(targetPath, 'utf8');
      const cards = JSON.parse(rawData);
      
      presetDatabase = {};
      const sets = {};

      cards.forEach(card => {
        if (!card.set_code) return;

        const code = card.set_code.toLowerCase().trim();
        if (!sets[code]) sets[code] = { set_code: code, villainsMap: new Map(), mainScheme: null };

        const tipo = (card.tipo_carta || card.type_code || '').toLowerCase();

        // 1. Guardamos solo una versión por cada nombre de villano distinto dentro del set
        if (tipo.includes('villano') || tipo.includes('villain')) {
          const villainName = card.name ? card.name.trim() : 'Villano';
          
          if (!sets[code].villainsMap.has(villainName)) {
            const healthMatch = card.health ? String(card.health).match(/\d+/) : null;
            const baseHp = healthMatch ? parseInt(healthMatch[0], 10) : (parseInt(card.health, 10) || 10);

            sets[code].villainsMap.set(villainName, {
              name: villainName,
              baseHp: baseHp
            });
          }
        } 
        // 2. Guardamos la primera etapa de Plan Principal
        else if ((tipo.includes('plan principal') || tipo.includes('main_scheme'))) {
          const stage = String(card.stage || card.stage_code || '').toUpperCase();
          if (!sets[code].mainScheme || stage.includes('1') || stage.includes('A')) {
            sets[code].mainScheme = card;
          }
        }
      });

      // Función auxiliar para extraer números de forma segura de cadenas o enteros
      const parseNumeric = (val, fallback) => {
        if (val === undefined || val === null) return fallback;
        const match = String(val).match(/\d+/);
        return match ? parseInt(match[0], 10) : fallback;
      };

      Object.values(sets).forEach(set => {
        const villainsList = Array.from(set.villainsMap.values());

        if (villainsList.length > 0) {
          const mainScheme = set.mainScheme || {};

          // Extracción inteligente de amenaza base por jugador
          const rawBaseThreat = mainScheme.base_threat !== undefined 
            ? mainScheme.base_threat 
            : (mainScheme.threat !== undefined ? mainScheme.threat : mainScheme.starting_threat);
          const threatBase = parseNumeric(rawBaseThreat, 1);

          // Búsqueda exhaustiva del umbral / amenaza máxima en múltiples claves conocidas
          let rawThreshold = undefined;
          const possibleThresholdKeys = [
            'threat_maxima', 'escalation_threat', 'base_threat_fixed', 
            'threat_fixed', 'max_threat', 'target', 'target_base', 
            'threshold', 'fixed_threat', 'threat_star', 'threat_target'
          ];

          for (const key of possibleThresholdKeys) {
            if (mainScheme[key] !== undefined && mainScheme[key] !== null) {
              rawThreshold = mainScheme[key];
              break;
            }
          }

          // Si no se encuentra en las claves conocidas, busca dinámicamente cualquier propiedad con 'max', 'target', 'threshold' o 'limite'
          if (rawThreshold === undefined) {
            const dynamicKey = Object.keys(mainScheme).find(k => {
              const lower = k.toLowerCase();
              return lower.includes('max') || lower.includes('target') || lower.includes('threshold') || lower.includes('limite');
            });
            if (dynamicKey) {
              rawThreshold = mainScheme[dynamicKey];
            }
          }

          const threatMax = parseNumeric(rawThreshold, 7);

          presetDatabase[set.set_code] = {
            key: set.set_code,
            villainName: villainsList[0].name, // por compatibilidad con el buscador
            villainsList: villainsList,        // 1 tarjeta por cada villano único distinto
            mainScheme: {
              name: mainScheme.name || 'Plan Principal',
              stage: mainScheme.stage || mainScheme.stage_code || '', // <-- Capturamos la etapa (stage) correctamente
              baseThreat: threatBase,
              baseThreshold: threatMax
            }
          };
        }
      });

      console.log(`Base de datos cargada: ${Object.keys(presetDatabase).length} escenarios estructurados.`);
    }
  } catch (e) {
    console.error('Error cargando villanos_y_planes:', e);
  }
}
loadDatabase();

const rooms = {};

function createRoomState(hostSocketId) {
  return {
    hostId: hostSocketId,
    selectedVillain: null,
    players: 1,
    threat: { 
      name: 'Plan Principal', 
      stage: '',
      baseThreat: 1, 
      baseThreshold: 7, 
      current: 1 
    },
    villains: [{ id: 'v1', name: 'Seleccionar Villano', baseHp: 10, hp: 10 }],
    sideSchemes: [],
    heroes: []
  };
}

io.on('connection', (socket) => {

  socket.on('join_room', ({ roomCode }) => {
    const code = roomCode ? roomCode.toUpperCase() : 'MARV';
    if (socket.roomCode) socket.leave(socket.roomCode);
    
    socket.join(code);
    socket.roomCode = code;

    let isHost = false;

    if (!rooms[code]) {
      rooms[code] = createRoomState(socket.id);
      isHost = true;
    } else if (rooms[code].hostId === socket.id) {
      isHost = true;
    }

    const room = rooms[code];

    socket.emit('init_session', { 
      isHost: isHost, 
      database: isHost ? Object.values(presetDatabase) : [] 
    });

    io.to(code).emit('update_room', room);
  });

  socket.on('select_preset', ({ presetKey }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];

    if (room.hostId !== socket.id) {
      return socket.emit('error_message', 'Solo el anfitrión de la sala puede seleccionar el villano.');
    }

    const preset = presetDatabase[presetKey];
    if (!preset) return;

    room.selectedVillain = presetKey;
    const playerCount = room.players || 1;

    // Cargar Plan Principal con los valores y la etapa (stage) reales del JSON
    room.threat.name = preset.mainScheme.name;
    room.threat.stage = preset.mainScheme.stage;
    room.threat.baseThreat = preset.mainScheme.baseThreat;
    room.threat.baseThreshold = preset.mainScheme.baseThreshold;
    room.threat.current = preset.mainScheme.baseThreat * playerCount;

    // Cargar los villanos únicos correspondientes (1 de cada uno)
    room.villains = preset.villainsList.map((v, index) => ({
      id: `v_${index}_${Date.now()}`,
      name: v.name,
      baseHp: v.baseHp,
      hp: v.baseHp * playerCount
    }));

    io.to(code).emit('update_room', room);
  });

  socket.on('update_players', ({ players }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];
    const newCount = Math.max(1, parseInt(players) || 1);
    room.players = newCount;

    room.villains.forEach(v => {
      v.hp = (v.baseHp || 10) * newCount;
    });

    io.to(code).emit('update_room', room);
  });

  socket.on('update_threat', (data) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];

    if (data.delta !== undefined) {
      room.threat.current = Math.max(0, (room.threat.current || 0) + data.delta);
    }
    if (data.name !== undefined) {
      room.threat.name = data.name;
    }
    if (data.baseThreat !== undefined) {
      room.threat.baseThreat = Math.max(1, parseInt(data.baseThreat) || 1);
    }
    if (data.baseThreshold !== undefined) {
      room.threat.baseThreshold = Math.max(1, parseInt(data.baseThreshold) || 1);
    }

    io.to(code).emit('update_room', room);
  });

  socket.on('update_villain', (data) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];
    const { action, index, delta, name, baseHp } = data;

    switch (action) {
      case 'change_hp':
        if (room.villains[index]) {
          room.villains[index].hp = Math.max(0, room.villains[index].hp + delta);
        }
        break;

      case 'change_base_hp':
        if (room.villains[index]) {
          const newBase = Math.max(1, parseInt(baseHp) || 1);
          room.villains[index].baseHp = newBase;
          room.villains[index].hp = newBase * (room.players || 1);
        }
        break;

      case 'change_name':
        if (room.villains[index]) {
          room.villains[index].name = name;
        }
        break;

      case 'add':
        const newIdx = room.villains.length + 1;
        const defaultBase = 10;
        room.villains.push({
          id: `v_${Date.now()}`,
          name: `Esbirro / Villano ${newIdx}`,
          baseHp: defaultBase,
          hp: defaultBase * (room.players || 1)
        });
        break;

      case 'remove':
        if (room.villains.length > 0 && index >= 0 && index < room.villains.length) {
          room.villains.splice(index, 1);
        }
        break;
    }

    io.to(code).emit('update_room', room);
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (code && rooms[code] && rooms[code].hostId === socket.id) {
      const clients = io.sockets.adapter.rooms.get(code);
      if (clients && clients.size > 0) {
        const newHostId = Array.from(clients)[0];
        rooms[code].hostId = newHostId;
        io.to(newHostId).emit('init_session', { 
          isHost: true, 
          database: Object.values(presetDatabase) 
        });
      } else {
        delete rooms[code];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor iniciado en puerto ${PORT}`));
