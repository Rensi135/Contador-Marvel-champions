const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

const dbPath = path.join(__dirname, 'data', 'database.json');
let presetDatabase = {};

function loadDatabase() {
  try {
    if (fs.existsSync(dbPath)) {
      presetDatabase = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      console.log(`Base de datos cargada: ${Object.keys(presetDatabase).length} escenarios disponibles.`);
    }
  } catch (e) {
    console.error('Error cargando database.json:', e);
  }
}
loadDatabase();

const rooms = {};
const HERO_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706'];

function createRoomState(hostSocketId) {
  return {
    hostId: hostSocketId, // Guardamos el ID del creador de la sala
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

  // 1. UNIRSE A LA SALA
  socket.on('join_room', ({ roomCode }) => {
    const code = roomCode ? roomCode.toUpperCase() : 'MARV';
    if (socket.roomCode) socket.leave(socket.roomCode);
    
    socket.join(code);
    socket.roomCode = code;

    let isHost = false;

    // Si la sala no existe, el usuario actual pasa a ser el Host
    if (!rooms[code]) {
      rooms[code] = createRoomState(socket.id);
      isHost = true;
    } else if (rooms[code].hostId === socket.id) {
      isHost = true;
    }

    const room = rooms[code];

    // Enviar al cliente si es el anfitrión y el catálogo para la modal
    socket.emit('init_session', { 
      isHost: isHost, 
      database: isHost ? Object.values(presetDatabase) : [] 
    });

    // Notificar actualización de estado global de la sala
    io.to(code).emit('update_room', room);
  });

  // 2. SELECCIÓN DE PRESET DE ESCENARIO
  socket.on('select_preset', ({ presetKey }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];

    // Control de seguridad: Verificar que quien envía la orden sea el Host
    if (room.hostId !== socket.id) {
      return socket.emit('error_message', 'Solo el anfitrión de la sala puede seleccionar el villano.');
    }

    const preset = presetDatabase[presetKey];
    if (!preset) return;

    room.selectedVillain = presetKey;
    const playerCount = room.players || 1;

    // Cargar Plan Principal
    room.threat.name = preset.mainScheme.name;
    room.threat.baseThreat = preset.mainScheme.baseThreat || 1;
    room.threat.baseThreshold = preset.mainScheme.baseThreshold || preset.mainScheme.targetBase || 7;
    room.threat.current = room.threat.baseThreat * playerCount;

    // Cargar Villano Principal
    if (room.villains.length > 0) {
      room.villains[0].name = preset.villainName;
      room.villains[0].baseHp = preset.baseHp;
      room.villains[0].hp = preset.baseHp * playerCount;
    }

    // Cargar Planes Secundarios disponibles del escenario
    room.sideSchemes = preset.sideSchemes || [];

    io.to(code).emit('update_room', room);
  });

  // 3. CAMBIO EN EL NÚMERO DE JUGADORES
  socket.on('update_players', ({ players }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];
    const newCount = Math.max(1, parseInt(players) || 1);
    room.players = newCount;

    // Recalcular vida de los villanos en función del nuevo número de jugadores
    room.villains.forEach(v => {
      v.hp = (v.baseHp || 10) * newCount;
    });

    io.to(code).emit('update_room', room);
  });

  // 4. ACTUALIZACIÓN DEL PLAN PRINCIPAL (AMENAZA)
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

  // 5. GESTIÓN Y MODIFICACIÓN DE VILLANOS
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

  // 6. DESCONEXIÓN
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
