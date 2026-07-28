const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));

const rooms = {};

const HERO_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706'];

function createRoomState() {
  return {
    players: 1,
    threat: { 
      name: 'Plan Principal', 
      baseThreat: 1,  // Amenaza inicial por jugador
      targetBase: 7,  // Umbral inicial por jugador (ej: 7 por defecto)
      current: 1, 
      target: 7 
    },
    villains: [{ id: 'v1', name: 'Villano Principal', baseHp: 14, hp: 14 }],
    heroes: [{ id: 'h1', name: 'Héroe 1', hp: 10, maxHp: 10, color: HERO_COLORS[0] }]
  };
}

io.on('connection', (socket) => {

  socket.on('join_room', ({ roomCode }) => {
    const code = roomCode ? roomCode.toUpperCase() : 'MARV';
    if (socket.roomCode) socket.leave(socket.roomCode);
    
    socket.join(code);
    socket.roomCode = code;

    if (!rooms[code]) rooms[code] = createRoomState();

    // Asegurar estructura
    const threat = rooms[code].threat;
    if (!threat.targetBase) threat.targetBase = 7;
    if (!threat.target) threat.target = threat.targetBase * rooms[code].players;

    io.to(code).emit('update_room', rooms[code]);
  });

  socket.on('update_players', ({ players }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const newPlayers = Math.min(4, Math.max(1, parseInt(players) || 1));
    rooms[code].players = newPlayers;

    // Recalcular Umbral Total de Amenaza y Vida de Villanos
    const threat = rooms[code].threat;
    threat.target = (threat.targetBase || 7) * newPlayers;

    rooms[code].villains.forEach(v => {
      v.hp = (v.baseHp || 10) * newPlayers;
    });

    const currentHeroes = rooms[code].heroes;
    while (currentHeroes.length < newPlayers && currentHeroes.length < 4) {
      const heroIndex = currentHeroes.length;
      currentHeroes.push({
        id: 'h_' + Date.now() + Math.random(),
        name: `Héroe ${heroIndex + 1}`,
        hp: 10,
        maxHp: 10,
        color: HERO_COLORS[heroIndex % HERO_COLORS.length]
      });
    }

    io.to(code).emit('update_room', rooms[code]);
  });

  // Gestor del Plan Principal (Amenaza y Umbral)
  socket.on('update_threat', ({ delta, name, baseThreat, targetBase }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const threat = rooms[code].threat;
    const players = rooms[code].players || 1;

    // Cambiar Amenaza Base Inicial por Jugador
    if (baseThreat !== undefined) {
      const newBase = Math.max(0, parseInt(baseThreat) || 0);
      threat.baseThreat = newBase;
      threat.current = newBase * players;
    }

    // Cambiar Umbral Base por Jugador
    if (targetBase !== undefined) {
      const newTargetBase = Math.max(1, parseInt(targetBase) || 1);
      threat.targetBase = newTargetBase;
      threat.target = newTargetBase * players;
    }

    if (delta !== undefined) {
      threat.current = Math.max(0, threat.current + delta);
    }

    if (name !== undefined) {
      threat.name = name;
    }

    io.to(code).emit('update_room', rooms[code]);
  });

  // Gestor de Villanos y Héroes (Mantiene tu lógica limpia)
  socket.on('update_villain', ({ action, index, delta, name, baseHp }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const villains = rooms[code].villains;
    const players = rooms[code].players || 1;

    if (action === 'add') {
      villains.push({ id: 'v_' + Date.now(), name: `Villano ${villains.length + 1}`, baseHp: 10, hp: 10 * players });
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

  socket.on('update_hero', ({ action, index, delta, name, maxHp }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const heroes = rooms[code].heroes;

    if (action === 'add' && heroes.length < 4) {
      const idx = heroes.length;
      heroes.push({ id: 'h_' + Date.now(), name: `Héroe ${idx + 1}`, hp: 10, maxHp: 10, color: HERO_COLORS[idx % HERO_COLORS.length] });
      rooms[code].players = heroes.length;
    } else if (action === 'remove' && heroes.length > 0) {
      heroes.splice(index, 1);
      heroes.forEach((h, i) => h.color = HERO_COLORS[i % HERO_COLORS.length]);
      rooms[code].players = Math.max(1, heroes.length);
    } else if (action === 'change_hp' && heroes[index]) {
      heroes[index].hp = Math.max(0, heroes[index].hp + delta);
    } else if (action === 'change_name' && heroes[index]) {
      heroes[index].name = name;
    }

    io.to(code).emit('update_room', rooms[code]);
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
