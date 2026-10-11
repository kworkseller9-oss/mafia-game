import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import * as store from './store.js';
import { Game, MODES } from './game.js';
import { createAdminRouter, tooMany, fail, ok as clearFail } from './admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

/** @type {Map<string, Game>} */
const rooms = new Map();
/** userId -> Set<socket> */
const userSockets = new Map();
/** userId -> roomId */
const userRoom = new Map();

// ---------- HTTP ----------
app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, online: userSockets.size }));
app.get('/api/shop', (_req, res) => res.json(store.shopCatalog()));
app.get('/api/skins', (_req, res) => res.json(store.SKINS));

// Выкинуть все сессии игрока (блокировка, удаление, смена пароля)
function revokeUser(userId) {
  const set = userSockets.get(userId);
  leaveCurrentRoom(userId);
  if (set) {
    set.forEach((s) => {
      s.emit('auth:revoked');
      s.disconnect(true);
    });
    userSockets.delete(userId);
  }
  broadcastRooms();
}

app.post('/api/login', (req, res) => {
  const key = 'login:' + req.ip;
  if (tooMany(key)) return res.status(429).json({ ok: false, error: 'Слишком много попыток. Подождите 10 минут.' });
  const r = store.verifyLogin(req.body?.login, req.body?.password);
  if (!r.ok) {
    if (!r.blocked) fail(key);
    return res.status(r.blocked ? 403 : 401).json(r);
  }
  clearFail(key);
  res.json(r);
});

app.use('/api/admin', createAdminRouter({ revokeUser, isOnline: (id) => userSockets.has(id) }));

const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

// ---------- helpers ----------
function emitToUser(userId, event, payload) {
  userSockets.get(userId)?.forEach((s) => s.emit(event, payload));
}

function roomsList() {
  return [...rooms.values()].filter((r) => !r.isPrivate).map((r) => r.summary());
}

let listTimer = null;
function broadcastRooms() {
  clearTimeout(listTimer);
  listTimer = setTimeout(() => {
    io.to('lobby').emit('rooms', roomsList());
    io.to('lobby').emit('online', userSockets.size);
  }, 100);
}

function pushRoom(room) {
  for (const p of room.humans()) {
    emitToUser(p.id, 'room:state', room.view(p.id));
  }
}

function pushProfile(userId) {
  const u = store.getUser(userId);
  if (u) emitToUser(userId, 'profile', store.publicProfile(u));
}

function makeRoom(opts) {
  const room = new Game({
    ...opts,
    onChange: (r) => {
      pushRoom(r);
      broadcastRooms();
    },
    onFinish: (r) => {
      for (const p of r.humans()) pushProfile(p.id);
    },
  });
  rooms.set(room.id, room);
  return room;
}

function leaveCurrentRoom(userId) {
  const rid = userRoom.get(userId);
  if (!rid) return;
  userRoom.delete(userId);
  const room = rooms.get(rid);
  if (!room) return;
  room.removePlayer(userId);
  if (room.connectedHumans().length === 0) {
    room.destroy();
    rooms.delete(rid);
  }
  broadcastRooms();
}

function joinRoom(user, room) {
  if (room.byId(user.id)) {
    userRoom.set(user.id, room.id);
    room.reconnect(user.id);
    return { ok: true };
  }
  if (room.phase !== 'lobby') return { ok: false, error: 'Игра уже идёт' };
  if (room.players.length >= room.max) return { ok: false, error: 'Комната заполнена' };
  leaveCurrentRoom(user.id);
  room.addHuman(user);
  userRoom.set(user.id, room.id);
  room.onChange(room);
  return { ok: true };
}

// ---------- сокеты ----------
io.on('connection', (socket) => {
  /** @type {import('./store.js').getUser} */
  let user = null;

  const need = (cb) => {
    if (!user) {
      cb?.({ ok: false, error: 'Не авторизован' });
      return false;
    }
    const cur = store.getUser(user.id);
    if (!cur || cur.blocked) {
      cb?.({ ok: false, error: 'Доступ закрыт' });
      return false;
    }
    return true;
  };
  const myRoom = () => rooms.get(userRoom.get(user?.id));

  socket.on('hello', ({ token, name } = {}, cb) => {
    // Регистрации нет: войти можно только в аккаунт, который создал админ.
    // ALLOW_GUESTS=1 возвращает старое поведение (гостевой вход) — нужно только для тестов.
    let u = store.getUserByToken(token);
    if (!u && process.env.ALLOW_GUESTS === '1') u = store.getOrCreateUser(token, name);
    if (!u) return cb?.({ ok: false, needLogin: true });
    if (u.blocked) return cb?.({ ok: false, needLogin: true, error: 'Аккаунт заблокирован администратором' });
    user = u;
    socket.join('lobby');
    if (!userSockets.has(user.id)) userSockets.set(user.id, new Set());
    userSockets.get(user.id).add(socket);

    // возврат в текущую партию
    const room = myRoom();
    if (room) {
      room.reconnect(user.id);
      room.onChange(room);
    }
    cb?.({
      ok: true,
      token: user.token,
      profile: store.publicProfile(user),
      rooms: roomsList(),
      online: userSockets.size,
      room: room ? room.view(user.id) : null,
    });
    broadcastRooms();
  });

  socket.on('rooms:list', (cb) => need(cb) && cb?.({ ok: true, rooms: roomsList() }));

  socket.on('room:create', (data = {}, cb) => {
    if (!need(cb)) return;
    const mode = MODES[data.mode] ? data.mode : 'classic';
    leaveCurrentRoom(user.id);
    const room = makeRoom({
      name: String(data.name || '').replace(/[<>]/g, '').trim().slice(0, 24) || `Комната ${user.name}`,
      mode,
      max: Number(data.max) || MODES[mode].max,
      isPrivate: !!data.isPrivate || mode === 'friends',
      password: String(data.password || '').slice(0, 16),
      host: user,
    });
    userRoom.set(user.id, room.id);
    room.onChange(room);
    cb?.({ ok: true, room: room.view(user.id) });
  });

  socket.on('room:join', ({ id, password } = {}, cb) => {
    if (!need(cb)) return;
    const room = rooms.get(String(id || '').toUpperCase().trim());
    if (!room) return cb?.({ ok: false, error: 'Комната не найдена' });
    if (room.password && room.password !== password && !room.byId(user.id)) {
      return cb?.({ ok: false, error: 'Неверный пароль', needPassword: true });
    }
    const r = joinRoom(user, room);
    cb?.({ ...r, room: r.ok ? room.view(user.id) : null });
  });

  // «Быстрая игра»: вход в открытую комнату или создание новой с ботами
  socket.on('room:quick', (cb) => {
    if (!need(cb)) return;
    let room = [...rooms.values()].find(
      (r) => !r.isPrivate && !r.password && r.phase === 'lobby' && r.players.length < r.max && !r.byId(user.id) && r.humans().length > 0,
    );
    if (room) {
      const r = joinRoom(user, room);
      return cb?.({ ...r, room: r.ok ? room.view(user.id) : null });
    }
    leaveCurrentRoom(user.id);
    room = makeRoom({ name: `Быстрая ${user.name}`, mode: 'quick', max: 6, isPrivate: false, host: user });
    while (room.players.length < 6) room.addBot();
    userRoom.set(user.id, room.id);
    room.start();
    cb?.({ ok: true, room: room.view(user.id) });
  });

  socket.on('room:leave', (cb) => {
    if (!need(cb)) return;
    leaveCurrentRoom(user.id);
    cb?.({ ok: true });
  });

  socket.on('room:addBot', (cb) => {
    if (!need(cb)) return;
    const room = myRoom();
    if (!room || room.hostId !== user.id || room.phase !== 'lobby') return cb?.({ ok: false });
    if (room.players.length >= room.max) return cb?.({ ok: false, error: 'Комната заполнена' });
    room.addBot();
    room.onChange(room);
    cb?.({ ok: true });
  });

  socket.on('room:fillBots', (cb) => {
    if (!need(cb)) return;
    const room = myRoom();
    if (!room || room.hostId !== user.id || room.phase !== 'lobby') return cb?.({ ok: false });
    while (room.players.length < room.cfg.min) room.addBot();
    room.onChange(room);
    cb?.({ ok: true });
  });

  socket.on('room:kick', (targetId, cb) => {
    if (!need(cb)) return;
    const room = myRoom();
    if (!room || room.hostId !== user.id || room.phase !== 'lobby' || targetId === user.id) return cb?.({ ok: false });
    const t = room.byId(targetId);
    if (!t) return cb?.({ ok: false });
    if (!t.isBot) {
      userRoom.delete(targetId);
      emitToUser(targetId, 'room:kicked');
    }
    room.removePlayer(targetId);
    cb?.({ ok: true });
  });

  socket.on('room:start', (cb) => {
    if (!need(cb)) return;
    const room = myRoom();
    if (!room || room.hostId !== user.id) return cb?.({ ok: false, error: 'Только хозяин комнаты' });
    cb?.(room.start());
  });

  socket.on('room:again', (cb) => {
    if (!need(cb)) return;
    const room = myRoom();
    if (!room || room.hostId !== user.id) return cb?.({ ok: false, error: 'Только хозяин комнаты' });
    cb?.(room.again());
  });

  socket.on('game:act', (data, cb) => {
    if (!need(cb)) return;
    const room = myRoom();
    if (!room) return cb?.({ ok: false, error: 'Вы не в комнате' });
    cb?.(room.act(user.id, data || {}));
  });

  socket.on('chat:send', (text, cb) => {
    if (!need(cb)) return;
    const room = myRoom();
    if (!room) return cb?.({ ok: false });
    cb?.(room.say(user.id, text));
  });

  // профиль / магазин
  socket.on('profile:rename', (name, cb) => {
    if (!need(cb)) return;
    const r = store.rename(user, name);
    pushProfile(user.id);
    cb?.(r);
  });
  socket.on('shop:buy', (itemId, cb) => {
    if (!need(cb)) return;
    const r = store.buy(user, itemId);
    pushProfile(user.id);
    cb?.(r);
  });
  socket.on('shop:selectSkin', (skinId, cb) => {
    if (!need(cb)) return;
    const r = store.selectSkin(user, skinId);
    const room = myRoom();
    const p = room?.byId(user.id);
    if (r.ok && p && room.phase === 'lobby') {
      p.skin = user.skin;
      room.onChange(room);
    }
    pushProfile(user.id);
    cb?.(r);
  });

  socket.on('disconnect', () => {
    if (!user) return;
    const set = userSockets.get(user.id);
    set?.delete(socket);
    if (set && set.size === 0) {
      userSockets.delete(user.id);
      const room = myRoom();
      if (room) {
        // небольшая пауза на случай перезагрузки страницы
        const uid = user.id;
        setTimeout(() => {
          if (userSockets.has(uid)) return;
          const rid = userRoom.get(uid);
          const r = rooms.get(rid);
          if (!r) return;
          if (r.phase === 'lobby' || r.phase === 'end') leaveCurrentRoom(uid);
          else {
            r.removePlayer(uid);
            if (r.connectedHumans().length === 0) {
              r.destroy();
              rooms.delete(rid);
              userRoom.delete(uid);
            }
          }
          broadcastRooms();
        }, 4000);
      }
    }
    broadcastRooms();
  });
});

const adm = store.ensureAdmin();
server.listen(PORT, () => {
  console.log(`Mafia Online server: http://localhost:${PORT}`);
  console.log(`Админ-панель:        http://localhost:${PORT}/admin`);
  if (adm.password) console.log(`\nПАРОЛЬ АДМИНИСТРАТОРА (показан один раз): ${adm.password}\nЧтобы задать свой — запустите с переменной ADMIN_PASSWORD.\n`);
  else if (adm.source === 'saved') console.log('Пароль администратора сохранён с первого запуска (задать новый: переменная ADMIN_PASSWORD).');
});

export { io, rooms };
