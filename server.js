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
    threat: { name: 'Plan Principal', baseThreat: 1, targetBase: 7, current: 1, target: 7 },
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

  // Solo el Host puede emitir la selección del preset
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

    // Cargar Plan Principal
    room.threat.name = preset.mainScheme.name;
    room.threat.baseThreat = preset.mainScheme.baseThreat;
    room.threat.targetBase = preset.mainScheme.targetBase;
    room.threat.current = preset.mainScheme.baseThreat * (room.heroes.length || 1);
    room.threat.target = preset.mainScheme.targetBase * (room.heroes.length || 1);

    // Cargar Villano Principal
    if (room.villains.length > 0) {
      room.villains[0].name = preset.villainName;
      room.villains[0].baseHp = preset.baseHp;
      room.villains[0].hp = preset.baseHp * (room.heroes.length || 1);
    }

    // Cargar Planes Secundarios disponibles del escenario
    room.sideSchemes = preset.sideSchemes || [];

    io.to(code).emit('update_room', room);
  });

  socket.on('disconnect', () => {
    // Si el host se desconecta, se recalcula el host con otro integrante de la sala
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
