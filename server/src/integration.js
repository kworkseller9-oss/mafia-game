// Интеграционный тест: поднимает настоящий сервер и играет по сокетам. Запуск: npm run test:int
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mafia-int-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`);
  if (!cond) failed++;
};

const srv = spawn('node', [path.join(dir, 'index.js')], {
  env: { ...process.env, PORT, ADMIN_PASSWORD: 'test-admin', DATA_FILE: path.join(tmp, 'users.json'), DATABASE_URL: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
srv.stdout.on('data', (d) => (serverLog += d));
srv.stderr.on('data', (d) => (serverLog += d));
let exited = false;
srv.on('exit', () => (exited = true));

const api = async (p, method = 'GET', body, token) => {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const call = (s, ev, ...a) => new Promise((res) => { const t = setTimeout(() => res({ timeout: true }), 3000); s.emit(ev, ...a, (r) => { clearTimeout(t); res(r); }); });

async function client(login, password) {
  const r = await api('/api/login', 'POST', { login, password });
  const s = io(BASE, { transports: ['websocket'], forceNew: true });
  await new Promise((res) => s.on('connect', res));
  const h = await call(s, 'hello', { token: r.token });
  s.states = [];
  s.on('room:state', (st) => s.states.push(st));
  return { s, hello: h, token: r.token };
}

try {
  for (let i = 0; i < 50 && !serverLog.includes('Админ-панель'); i++) await sleep(100);
  check(serverLog.includes('Админ-панель'), 'сервер стартовал');

  const adm = await api('/api/admin/login', 'POST', { password: 'test-admin' });
  check(adm.ok, 'вход админа');
  for (const l of ['alice', 'bob', 'carol']) {
    const r = await api('/api/admin/users', 'POST', { login: l, password: 'secret123' }, adm.token);
    check(r.ok, `создан аккаунт ${l}`);
  }

  // --- 1. кривые события не валят сервер ---
  const a = await client('alice', 'secret123');
  check(a.hello.ok, 'alice вошла по токену');
  const bad = io(BASE, { transports: ['websocket'], forceNew: true });
  await new Promise((r) => bad.on('connect', r));
  bad.emit('hello', null);
  bad.emit('hello', 'x', 'not-a-function');
  bad.emit('room:join', null);
  bad.emit('room:join', 5, 'oops');
  a.s.emit('room:join', null, 'oops');
  a.s.emit('game:act', null);
  a.s.emit('room:kick', {}, 7);
  a.s.emit('chat:send', { a: 1 });
  a.s.emit('profile:rename', null);
  await sleep(300);
  check(!exited, 'сервер жив после мусорных событий (null, не-функция вместо callback)');
  bad.close();

  // --- 2. полная партия с человеком, выходом из партии и наградами ---
  const b = await client('bob', 'secret123');
  const c = await client('carol', 'secret123');
  const cr = await call(a.s, 'room:create', { name: 'T', mode: 'friends', max: 4 });
  check(cr.ok, 'комната создана');
  const code = cr.room.id;
  check((await call(b.s, 'room:join', { id: code })).ok, 'bob вошёл');
  check((await call(c.s, 'room:join', { id: code })).ok, 'carol вошла');
  check((await call(a.s, 'room:addBot')).ok, 'бот добавлен');
  const st = await call(a.s, 'room:start');
  check(st.ok, 'игра началась (4 игрока)');
  await sleep(200);

  // эксплойт: чужие роли не видны
  const lastB = b.s.states.at(-1);
  const others = lastB.players.filter((p) => p.id !== lastB.me.id && p.role);
  check(lastB.me.role && others.every((p) => lastB.me.role === 'mafia' ? p.role === 'mafia' : false), 'клиент видит только свою роль (и союзников-мафию)');
  check(lastB.timerLeft > 0 && lastB.timerEnd === undefined, 'сервер шлёт timerLeft (без рассинхрона часов)');

  // carol выходит из партии -> ей больше не шлют состояние
  const before = c.s.states.length;
  await call(c.s, 'room:leave');
  await sleep(150);
  const mid = c.s.states.length;
  await sleep(1500);
  check(c.s.states.length === mid, `вышедшему игроку больше не приходят room:state (до выхода ${before}, после ${mid}, позже ${c.s.states.length})`);

  // --- 3. брутфорс кода комнаты ограничен ---
  let blocked = false;
  for (let i = 0; i < 12; i++) {
    const r = await call(b.s, 'room:join', { id: 'ZZZ' + i });
    if (/много/i.test(r.error || '')) blocked = true;
  }
  check(blocked, 'перебор кодов комнат ограничивается');

  // --- 4. rate limit на сокет ---
  let limited = 0;
  await Promise.all(Array.from({ length: 80 }, async () => { const r = await call(a.s, 'rooms:list'); if (/часто/.test(r.error || '')) limited++; }));
  check(limited > 0, 'спам событиями режется');

  // --- 5. блокировка выкидывает игрока ---
  const users = (await api('/api/admin/users', 'GET', null, adm.token)).users;
  const bobId = users.find((u) => u.login === 'bob').id;
  let revoked = false;
  b.s.on('auth:revoked', () => (revoked = true));
  await api('/api/admin/users/' + bobId, 'PATCH', { blocked: true }, adm.token);
  await sleep(300);
  check(revoked, 'блокировка мгновенно выкидывает игрока');
  const lr = await api('/api/login', 'POST', { login: 'bob', password: 'secret123' });
  check(lr.status === 403, 'заблокированный не может войти');

  // --- 6. заголовки / 404 ---
  const h = await fetch(BASE + '/api/health');
  check(h.headers.get('x-content-type-options') === 'nosniff' && !h.headers.get('x-powered-by'), 'защитные заголовки');

  // --- 7. данные пережили перезапуск (файл, атомарная запись) ---
  srv.kill('SIGTERM');
  await sleep(800);
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'users.json'), 'utf8'));
  check(Object.values(saved.users).filter((u) => u.login).length === 3, 'аккаунты сохранены на диск при остановке (SIGTERM)');
} catch (e) {
  console.error(e);
  failed++;
} finally {
  srv.kill('SIGKILL');
  fs.rmSync(tmp, { recursive: true, force: true });
  if (failed) console.log('\n--- лог сервера ---\n' + serverLog);
  console.log(failed ? `\nПРОВАЛЕНО проверок: ${failed}` : '\nOK — интеграционные проверки пройдены');
  process.exit(failed ? 1 : 0);
}
