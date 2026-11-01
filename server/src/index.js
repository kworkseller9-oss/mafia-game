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
// За прокси хостинга (Render/Railway/Fly…) req.ip иначе будет адресом прокси, и лимит попыток входа
// заблокирует сразу всех. Число прыжков задаётся TRUST_PROXY (по умолчанию 1 в production).
const tp = process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? '1' : '');
if (tp) app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? true : tp);
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  next();
});
const CORS_ORIGIN = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((x) => x.trim()) : '*';
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '20kb' }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS_ORIGIN }, maxHttpBufferSize: 1e4 });

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
  app.use(
    express.static(dist, {
      setHeaders: (res, file) => {
        // имена файлов в /assets содержат хеш — можно кэшировать надолго; остальное всегда перепроверяем
        if (file.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
        else res.set('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    // несуществующий файл (js/css/png…) — честный 404, а не index.html, иначе после обновления «ломается» старый кэш
    if (path.extname(req.path)) return res.status(404).end();
    res.set('Cache-Control', 'no-cache');
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
    // вышедший из партии игрок остаётся в списке (за него играет автопилот), но обновления ему больше не шлём
    if (userRoom.get(p.id) !== room.id) continue;
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
  dropRoomIfEmpty(room);
  broadcastRooms();
}

function dropRoomIfEmpty(room) {
  if (room.connectedHumans().length > 0) return;
  room.destroy();
  rooms.delete(room.id);
  for (const p of room.humans()) if (userRoom.get(p.id) === room.id) userRoom.delete(p.id);
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
  /** @type {ReturnType<typeof store.getUser>} */
  let user = null;

  // Ограничение частоты событий: всплеск до 40, дальше ~15 событий/сек
  let bucket = 40;
  let last = Date.now();
  const allow = () => {
    const now = Date.now();
    bucket = Math.min(40, bucket + ((now - last) / 1000) * 15);
    last = now;
    if (bucket < 1) return false;
    bucket -= 1;
    return true;
  };

  /**
   * Безопасная регистрация обработчика: кривые данные или не-функция вместо callback
   * не должны ронять весь сервер (раньше socket.emit('room:join', null) валил процесс).
   */
  const on = (event, fn, hasData = true) =>
    socket.on(event, (...args) => {
      const lastArg = args[args.length - 1];
      const cb = typeof lastArg === 'function' ? lastArg : undefined;
      const data = hasData && typeof args[0] !== 'function' ? args[0] : undefined;
      try {
        if (!allow()) return cb?.({ ok: false, error: 'Слишком часто, подождите секунду' });
        if (hasData) fn(data, cb);
        else fn(cb);
      } catch (e) {
        console.error(`[socket:${event}]`, e);
        cb?.({ ok: false, error: 'Ошибка сервера' });
      }
    });

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
  const obj = (d) => (d && typeof d === 'object' ? d : {});

  on('hello', (data, cb) => {
    const { token, name } = obj(data);
    // Регистрации нет: войти можно только в аккаунт, который создал админ.
    // ALLOW_GUESTS=1 возвращает старое поведение (гостевой вход) — нужно только для тестов.
    let u = typeof token === 'string' ? store.getUserByToken(token) : null;
    if (!u && process.env.ALLOW_GUESTS === '1') u = store.getOrCreateUser(token, name);
    if (!u) return cb?.({ ok: false, needLogin: true });
    if (u.blocked) return cb?.({ ok: false, needLogin: true, error: 'Аккаунт заблокирован администратором' });
    // этот же сокет раньше мог принадлежать другому аккаунту (смена пользователя без переподключения)
    if (user && user.id !== u.id) userSockets.get(user.id)?.delete(socket);
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

  on('rooms:list', (cb) => need(cb) && cb?.({ ok: true, rooms: roomsList() }), false);

  on('room:create', (data, cb) => {
    if (!need(cb)) return;
    const d = obj(data);
    const mode = MODES[d.mode] ? d.mode : 'classic';
    leaveCurrentRoom(user.id);
    const room = makeRoom({
      name: String(d.name || '').replace(/[<>]/g, '').trim().slice(0, 24) || `Комната ${user.name}`,
      mode,
      max: Number(d.max) || MODES[mode].max,
      isPrivate: !!d.isPrivate || mode === 'friends',
      password: String(d.password || '').slice(0, 16),
      host: user,
    });
    userRoom.set(user.id, room.id);
    room.onChange(room);
    cb?.({ ok: true, room: room.view(user.id) });
  });

  on('room:join', (data, cb) => {
    if (!need(cb)) return;
    const { id, password } = obj(data);
    // защита от перебора кодов комнат и паролей
    const key = 'join:' + user.id;
    if (tooMany(key)) return cb?.({ ok: false, error: 'Слишком много неудачных попыток. Подождите немного.' });
    const room = rooms.get(String(id || '').toUpperCase().trim());
    if (!room) {
      fail(key);
      return cb?.({ ok: false, error: 'Комната не найдена' });
    }
    if (room.password && room.password !== String(password ?? '') && !room.byId(user.id)) {
      fail(key);
      return cb?.({ ok: false, error: 'Неверный пароль', needPassword: true });
    }
    clearFail(key);
    const r = joinRoom(user, room);
    cb?.({ ...r, room: r.ok ? room.view(user.id) : null });
  });

  // «Быстрая игра»: вход в открытую комнату или создание новой с ботами
  on(
    'room:quick',
    (cb) => {
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
    },
    false,
  );

  on(
    'room:leave',
    (cb) => {
      if (!need(cb)) return;
      leaveCurrentRoom(user.id);
      cb?.({ ok: true });
    },
    false,
  );

  on(
    'room:addBot',
    (cb) => {
      if (!need(cb)) return;
      const room = myRoom();
      if (!room || room.hostId !== user.id || room.phase !== 'lobby') return cb?.({ ok: false });
      if (room.players.length >= room.max) return cb?.({ ok: false, error: 'Комната заполнена' });
      room.addBot();
      room.onChange(room);
      cb?.({ ok: true });
    },
    false,
  );

  on(
    'room:fillBots',
    (cb) => {
      if (!need(cb)) return;
      const room = myRoom();
      if (!room || room.hostId !== user.id || room.phase !== 'lobby') return cb?.({ ok: false });
      while (room.players.length < room.cfg.min) room.addBot();
      room.onChange(room);
      cb?.({ ok: true });
    },
    false,
  );

  on('room:kick', (targetId, cb) => {
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

  on(
    'room:start',
    (cb) => {
      if (!need(cb)) return;
      const room = myRoom();
      if (!room || room.hostId !== user.id) return cb?.({ ok: false, error: 'Только хозяин комнаты' });
      cb?.(room.start());
    },
    false,
  );

  on(
    'room:again',
    (cb) => {
      if (!need(cb)) return;
      const room = myRoom();
      if (!room || room.hostId !== user.id) return cb?.({ ok: false, error: 'Только хозяин комнаты' });
      cb?.(room.again());
    },
    false,
  );

  on('game:act', (data, cb) => {
    if (!need(cb)) return;
    const room = myRoom();
    if (!room) return cb?.({ ok: false, error: 'Вы не в комнате' });
    const d = obj(data);
    cb?.(room.act(user.id, { type: String(d.type || ''), target: d.target == null ? undefined : String(d.target) }));
  });

  on('chat:send', (text, cb) => {
    if (!need(cb)) return;
    const room = myRoom();
    if (!room) return cb?.({ ok: false });
    cb?.(room.say(user.id, text));
  });

  // профиль / магазин
  on('profile:rename', (name, cb) => {
    if (!need(cb)) return;
    const r = store.rename(user, name);
    if (r.ok) myRoom()?.renameHuman(user.id, user.name);
    pushProfile(user.id);
    cb?.(r);
  });
  on('shop:buy', (itemId, cb) => {
    if (!need(cb)) return;
    const r = store.buy(user, itemId);
    pushProfile(user.id);
    cb?.(r);
  });
  on('shop:selectSkin', (skinId, cb) => {
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
    const uid = user.id;
    const set = userSockets.get(uid);
    set?.delete(socket);
    if (set && set.size === 0) {
      userSockets.delete(uid);
      if (myRoom()) {
        // небольшая пауза на случай перезагрузки страницы / кратковременного обрыва связи
        setTimeout(() => {
          if (userSockets.has(uid)) return;
          const r = rooms.get(userRoom.get(uid));
          if (!r) return;
          if (r.phase === 'lobby' || r.phase === 'end') leaveCurrentRoom(uid);
          else {
            // в партии игрок остаётся «отключённым»: за него играет автопилот, вернуться можно по hello
            r.removePlayer(uid);
            dropRoomIfEmpty(r);
          }
          broadcastRooms();
        }, 4000);
      }
    }
    broadcastRooms();
  });
});

// Сервер не должен падать из-за одной необработанной ошибки в партии
process.on('uncaughtException', (e) => console.error('uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

async function main() {
  await store.init();
  const adm = store.ensureAdmin();
  server.listen(PORT, () => {
    console.log(`Mafia Online server: http://localhost:${PORT}`);
    console.log(`Админ-панель:        http://localhost:${PORT}/admin`);
    console.log(`Хранилище:           ${store.storageKind()}`);
    if (adm.password) console.log(`\nПАРОЛЬ АДМИНИСТРАТОРА (показан один раз): ${adm.password}\nЧтобы задать свой — запустите с переменной ADMIN_PASSWORD.\n`);
    else if (adm.source === 'saved') console.log('Пароль администратора сохранён с первого запуска (задать новый: переменная ADMIN_PASSWORD).');
  });
}

// при остановке (деплой, Ctrl+C) дописываем несохранённые изменения
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await store.flush();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch((e) => {
  console.error('Не удалось запустить сервер:', e);
  process.exit(1);
});

export { io, rooms };
