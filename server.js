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

        let code = card.set_code.toLowerCase().trim();

        // Agrupación especial para El Grupo de Demolición (Wrecking Crew)
        if (['wrecker', 'thunderball', 'piledriver', 'bulldozer'].includes(code)) {
          code = 'wrecking_crew';
        }

        if (!sets[code]) sets[code] = { set_code: code, villainsMap: new Map(), schemesList: [] };

        const tipo = (card.tipo_carta || card.type_code || '').toLowerCase();

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
        else if ((tipo.includes('plan principal') || tipo.includes('main_scheme'))) {
          sets[code].schemesList.push(card);
        }
      });

      const parseNumeric = (val, fallback) => {
        if (val === undefined || val === null) return fallback;
        const match = String(val).match(/\d+/);
        return match ? parseInt(match[0], 10) : fallback;
      };

      Object.values(sets).forEach(set => {
        const villainsList = Array.from(set.villainsMap.values());

        if (villainsList.length > 0) {
          const schemes = set.schemesList || [];

          const hasValidThreat = (s) => {
            const max = String(s.threat_maxima || '');
            const base = String(s.base_threat || '');
            const esc = String(s.escalation_threat || '');
            return (max.match(/\d+/) && !max.includes('-1')) || base.match(/\d+/) || esc.match(/\d+/);
          };

          let selectedSchemes = [];

          if (set.set_code === 'wrecking_crew') {
            selectedSchemes = schemes.filter(s => hasValidThreat(s) || String(s.stage || '').toUpperCase().includes('B'));
          }

          if (selectedSchemes.length === 0) {
            let validScheme = null;
            for (let stageNum = 1; stageNum <= 5; stageNum++) {
              const candidate = schemes.find(s => {
                const stageStr = String(s.stage || s.stage_code || '').toUpperCase();
                return stageStr === `${stageNum}B` || stageStr === `${stageNum}`;
              });
              if (candidate && hasValidThreat(candidate)) {
                validScheme = candidate;
                break;
              }
            }

            if (!validScheme) {
              validScheme = schemes.find(s => hasValidThreat(s));
            }

            if (!validScheme) {
              validScheme = schemes.find(s => String(s.stage || '').toUpperCase().includes('B')) || schemes[0] || {};
            }
            selectedSchemes = [validScheme];
          }

          const formattedSchemes = selectedSchemes.map(mainScheme => {
            const rawBaseThreat = mainScheme.base_threat !== undefined 
              ? mainScheme.base_threat 
              : (mainScheme.threat !== undefined ? mainScheme.threat : mainScheme.starting_threat);
            const threatBase = parseNumeric(rawBaseThreat, 1);

            let rawThreshold = undefined;
            const possibleThresholdKeys = [
              'threat_maxima', 'escalation_threat', 'base_threat_fixed', 
              'threat_fixed', 'max_threat', 'target', 'target_base', 
              'threshold', 'fixed_threat', 'threat_star', 'threat_target'
            ];

            for (const key of possibleThresholdKeys) {
              if (mainScheme[key] !== undefined && mainScheme[key] !== null && String(mainScheme[key]).match(/\d+/)) {
                rawThreshold = mainScheme[key];
                break;
              }
            }

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

            return {
              name: mainScheme.name || 'Plan Principal',
              stage: mainScheme.stage || mainScheme.stage_code || '',
              baseThreat: threatBase,
              baseThreshold: threatMax,
              current: threatBase
            };
          });

          presetDatabase[set.set_code] = {
            key: set.set_code,
            villainName: villainsList[0].name,
            villainsList: villainsList,
            mainSchemes: formattedSchemes
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
    schemes: [{ name: 'Plan Principal', stage: '', baseThreat: 1, baseThreshold: 7, current: 1 }],
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

    // Cargar todos los planes principales del preset
    room.schemes = (preset.mainSchemes || []).map(s => ({
      name: s.name,
      stage: s.stage,
      baseThreat: s.baseThreat,
      baseThreshold: s.baseThreshold,
      current: s.baseThreat * playerCount
    }));

    // Cargar los villanos
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

  socket.on('update_scheme', (data) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];
    const { action, index, delta, name, baseThreat, baseThreshold } = data;

    switch (action) {
      case 'change_threat':
        if (room.schemes[index]) {
          room.schemes[index].current = Math.max(0, (room.schemes[index].current || 0) + delta);
        }
        break;
      case 'change_base_threat':
        if (room.schemes[index]) {
          room.schemes[index].baseThreat = Math.max(1, baseThreat);
        }
        break;
      case 'change_threshold':
        if (room.schemes[index]) {
          room.schemes[index].baseThreshold = Math.max(1, baseThreshold);
        }
        break;
      case 'change_name':
        if (room.schemes[index]) {
          room.schemes[index].name = name;
        }
        break;
      case 'add':
        room.schemes.push({
          name: 'Plan Principal',
          stage: '',
          baseThreat: 1,
          baseThreshold: 7,
          current: 1 * (room.players || 1)
        });
        break;
      case 'remove':
        if (room.schemes.length > 1 && index >= 0 && index < room.schemes.length) {
          room.schemes.splice(index, 1);
        }
        break;
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
        if (room.villains.length > 1 && index >= 0 && index < room.villains.length) {
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
