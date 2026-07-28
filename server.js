const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static('public'));

const rooms = {};

// Estado base para crear una sala nueva
function createRoomState() {
  return {
    players: 1,
    threat: { name: 'Plan Principal', baseThreat: 1, current: 1 },
    villains: [{ id: 'v1', name: 'Villano Principal', baseHp: 14, hp: 14 }],
    heroes: [
      { id: 'h1', name: 'Héroe 1', hp: 10, maxHp: 10 }
    ]
  };
}

io.on('connection', (socket) => {

  // Unirse a una sala
  socket.on('join_room', ({ roomCode }) => {
    const code = roomCode ? roomCode.toUpperCase() : 'MARV';

    // Salir de salas previas si ya estaba conectado a otra
    if (socket.roomCode) {
      socket.leave(socket.roomCode);
    }

    socket.join(code);
    socket.roomCode = code;

    if (!rooms[code]) {
      rooms[code] = createRoomState();
    }

    // Asegurar compatibilidad de estructura
    if (!rooms[code].heroes) {
      rooms[code].heroes = [{ id: 'h1', name: 'Héroe 1', hp: 10, maxHp: 10 }];
    }
    if (!rooms[code].threat.baseThreat) {
      rooms[code].threat.baseThreat = 1;
    }

    // Notificar el estado actual a todos en la sala
    io.to(code).emit('update_room', rooms[code]);
  });

  // Cambiar Número de Jugadores y recalcular Amenaza/Vida de Villanos
  socket.on('update_players', ({ players }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const newPlayers = Math.max(1, parseInt(players) || 1);
    rooms[code].players = newPlayers;

    // Recalcular Amenaza Total (baseThreat * newPlayers)
    const threat = rooms[code].threat;
    threat.current = (threat.baseThreat || 1) * newPlayers;

    // Recalcular Vida Total de los Villanos (baseHp * newPlayers)
    rooms[code].villains.forEach(v => {
      v.hp = (v.baseHp || 10) * newPlayers;
    });

    // Ajustar número de héroes según cantidad de jugadores
    const currentHeroes = rooms[code].heroes;
    while (currentHeroes.length < newPlayers) {
      currentHeroes.push({
        id: 'h_' + Date.now() + Math.random(),
        name: `Héroe ${currentHeroes.length + 1}`,
        hp: 10,
        maxHp: 10
      });
    }

    io.to(code).emit('update_room', rooms[code]);
  });

  // Gestor del Plan Principal (Amenaza)
  socket.on('update_threat', ({ delta, name, baseThreat }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const threat = rooms[code].threat;
    const players = rooms[code].players || 1;

    if (baseThreat !== undefined) {
      const newBase = Math.max(1, parseInt(baseThreat) || 1);
      threat.baseThreat = newBase;
      threat.current = newBase * players;
    }

    if (delta !== undefined) {
      threat.current = Math.max(0, threat.current + delta);
    }

    if (name !== undefined) {
      threat.name = name;
    }

    io.to(code).emit('update_room', rooms[code]);
  });

  // Gestor de Villanos
  socket.on('update_villain', ({ action, index, delta, name, baseHp }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const villains = rooms[code].villains;
    const players = rooms[code].players || 1;

    if (action === 'add') {
      const defaultBase = 10;
      villains.push({
        id: 'v_' + Date.now(),
        name: `Villano ${villains.length + 1}`,
        baseHp: defaultBase,
        hp: defaultBase * players
      });
    } else if (action === 'remove' && villains.length > 1) {
      villains.splice(index, 1);
    } else if (action === 'change_hp' && villains[index]) {
      villains[index].hp = Math.max(0, villains[index].hp + delta);
    } else if (action === 'change_name' && villains[index]) {
      villains[index].name = name;
    } else if (action === 'change_base_hp' && villains[index]) {
      const newBase = Math.max(1, parseInt(baseHp) || 1);
      villains[index].baseHp = newBase;
      villains[index].hp = newBase * players;
    }

    io.to(code).emit('update_room', rooms[code]);
  });

  // Gestor de Héroes
  socket.on('update_hero', ({ action, index, delta, name, hp, maxHp }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const heroes = rooms[code].heroes;

    if (action === 'add') {
      heroes.push({
        id: 'h_' + Date.now(),
        name: `Héroe ${heroes.length + 1}`,
        hp: 10,
        maxHp: 10
      });
      rooms[code].players = heroes.length;
    } else if (action === 'remove' && heroes.length > 0) {
      heroes.splice(index, 1);
      rooms[code].players = Math.max(1, heroes.length);
    } else if (action === 'change_hp' && heroes[index]) {
      heroes[index].hp = Math.max(0, heroes[index].hp + delta);
    } else if (action === 'change_name' && heroes[index]) {
      heroes[index].name = name;
    } else if (action === 'set_max_hp' && heroes[index]) {
      const newMax = Math.max(1, parseInt(maxHp) || 1);
      heroes[index].maxHp = newMax;
      heroes[index].hp = newMax;
    }

    io.to(code).emit('update_room', rooms[code]);
  });

  // Gestión de desconexión
  socket.on('disconnect', () => {
    console.log(`Cliente desconectado: ${socket.id}`);
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
