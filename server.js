const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

// Ruta a tu archivo JSON de villanos y planes en la raíz del proyecto
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

      // Agrupación flexible de cartas por set_code para emparejar Villano y Plan Principal
      cards.forEach(card => {
        if (!card.set_code) return;

        const code = card.set_code.toLowerCase().trim();
        if (!sets[code]) sets[code] = { set_code: code };

        const tipo = (card.tipo_carta || card.type_code || '').toLowerCase();

        // Asignar villano si aún no existe para este set
        if ((tipo.includes('villano') || tipo.includes('villain')) && !sets[code].villain) {
          sets[code].villain = card;
        } 
        // Asignar plan principal si aún no existe para este set
        else if ((tipo.includes('plan principal') || tipo.includes('main_scheme')) && !sets[code].mainScheme) {
          sets[code].mainScheme = card;
        }
      });

      // Procesamos y estructuramos cada escenario encontrado de forma robusta
      Object.values(sets).forEach(set => {
        if (set.villain) {
          const healthMatch = set.villain.health ? String(set.villain.health).match(/\d+/) : null;
          const baseHp = healthMatch ? parseInt(healthMatch[0], 10) : (parseInt(set.villain.health, 10) || 10);

          const mainScheme = set.mainScheme || {};
          const threatBase = parseInt(mainScheme.base_threat, 10) || 1;
          const threatMax = parseInt(mainScheme.threat_maxima, 10) || parseInt(mainScheme.escalation_threat, 10) || 7;

          presetDatabase[set.set_code] = {
            key: set.set_code,
            villainName: set.villain.name || 'Villano Sin Nombre',
            baseHp: baseHp,
            mainScheme: {
              name: mainScheme.name || 'Plan Principal',
              baseThreat: threatBase,
              baseThreshold: threatMax
            }
          };
        }
      });

      console.log(`Base de datos cargada: ${Object.keys(presetDatabase).length} escenarios estructurados.`);
    } else {
      console.warn('No se encontró el archivo villanos_y_planes en la ruta principal.');
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

    room.threat.name = preset.mainScheme.name;
    room.threat.baseThreat = preset.mainScheme.baseThreat || 1;
    room.threat.baseThreshold = preset.mainScheme.baseThreshold || 7;
    room.threat.current = room.threat.baseThreat * playerCount;

    if (room.villains.length > 0) {
      room.villains[0].name = preset.villainName;
      room.villains[0].baseHp = preset.baseHp;
      room.villains[0].hp = preset.baseHp * playerCount;
    }

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
          id: `v${Date.now()}`,
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
