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
      baseThreat: 1,     // Amenaza inicial por jugador
      targetBase: 7,     // Umbral por jugador
      baseThreshold: 7,  // Alias para mantener sincronía con el frontend
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

    const threat = rooms[code].threat;
    
    // CORRECCIÓN CLAVE: Respetar el valor actual si ya existe
    const activeThreshold = threat.targetBase !== undefined ? threat.targetBase : (threat.baseThreshold !== undefined ? threat.baseThreshold : 7);
    threat.targetBase = activeThreshold;
    threat.baseThreshold = activeThreshold;
    threat.target = activeThreshold * rooms[code].players;

    io.to(code).emit('update_room', rooms[code]);
  });

  // Cambiar jugadores (Sin límite superior)
  socket.on('update_players', ({ players }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const newPlayers = Math.max(1, parseInt(players) || 1);
    rooms[code].players = newPlayers;

    const threat = rooms[code].threat;
    const thresholdBase = threat.targetBase || threat.baseThreshold || 7;

    // Recalcular Umbral Total y Amenaza Inicial
    threat.target = thresholdBase * newPlayers;
    threat.current = (threat.baseThreat || 1) * newPlayers;

    // Recalcular Vida de Villanos
    rooms[code].villains.forEach(v => {
      v.hp = (v.baseHp || 10) * newPlayers;
    });

    io.to(code).emit('update_room', rooms[code]);
  });

  // Gestor del Plan Principal (Amenaza y Umbral)
  socket.on('update_threat', ({ delta, name, baseThreat, targetBase, baseThreshold }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const threat = rooms[code].threat;
    const players = rooms[code].players || 1;

    // Cambiar Amenaza Base por Jugador
    if (baseThreat !== undefined) {
      const newBase = Math.max(0, parseInt(baseThreat) || 0);
      threat.baseThreat = newBase;
      threat.current = newBase * players;
    }

    // Cambiar Umbral Base por Jugador
    const rawThreshold = targetBase !== undefined ? targetBase : baseThreshold;
    if (rawThreshold !== undefined) {
      const newThreshold = Math.max(1, parseInt(rawThreshold) || 1);
      threat.targetBase = newThreshold;
      threat.baseThreshold = newThreshold;
      threat.target = newThreshold * players;
    }

    // Incrementar / Decrementar amenaza en partida
    if (delta !== undefined) {
      threat.current = Math.max(0, threat.current + delta);
    }

    // Cambiar nombre del plan
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

  // Gestor de Héroes (Límite máximo de 4 héroes)
  socket.on('update_hero', ({ action, index, delta, name }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const heroes = rooms[code].heroes;

    if (action === 'add' && heroes.length < 4) {
      const idx = heroes.length;
      heroes.push({ id: 'h_' + Date.now(), name: `Héroe ${idx + 1}`, hp: 10, maxHp: 10, color: HERO_COLORS[idx % HERO_COLORS.length] });
    } else if (action === 'remove' && heroes.length > 0) {
      heroes.splice(index, 1);
      heroes.forEach((h, i) => h.color = HERO_COLORS[i % HERO_COLORS.length]);
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
