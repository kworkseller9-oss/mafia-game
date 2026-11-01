// Проверка хранилищ: JSON-файл (атомарная запись, восстановление) и PostgreSQL (pg-mem вместо Neon).
// Запуск: npm run test:store
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
let failed = 0;
const check = (c, m) => { console.log(`${c ? '  ok  ' : ' FAIL '} ${m}`); if (!c) failed++; };

if (!mode) {
  // оркестратор: каждый сценарий в отдельном процессе со своим окружением
  const self = fileURLToPath(import.meta.url);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mafia-store-'));
  let bad = 0;
  for (const sc of ['file', 'pg']) {
    const r = spawnSync('node', [self, sc], { env: { ...process.env, DATA_FILE: path.join(tmp, 'users.json'), DATABASE_URL: sc === 'pg' ? 'postgres://test@localhost/test' : '', TMPD: tmp }, stdio: 'inherit' });
    if (r.status !== 0) bad++;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(bad ? 1 : 0);
}

const FILE = process.env.DATA_FILE;
const fresh = () => import('./store.js?x=' + Math.random());

if (mode === 'file') {
  console.log('JSON-файл:');
  let s = await fresh();
  await s.init();
  s.createAccount({ login: 'user1', password: 'secret1', coins: 10 });
  await s.flush();
  check(fs.existsSync(FILE) && !fs.existsSync(FILE + '.tmp'), 'файл записан атомарно (без .tmp)');
  s.createAccount({ login: 'user2', password: 'secret1' });
  await s.flush();
  check(fs.existsSync(FILE + '.bak'), 'предыдущая версия сохранена в .bak');

  // битый основной файл -> восстановление из .bak, а не пустая база
  fs.writeFileSync(FILE, '{"users": {broken');
  s = await fresh();
  await s.init();
  check(s.adminList().length >= 1, 'битый users.json: аккаунты восстановлены из .bak');
  check(fs.readdirSync(path.dirname(FILE)).some((f) => f.includes('.corrupt-')), 'битый файл отложен в сторону, а не затёрт');
  process.exit(failed ? 1 : 0);
}

if (mode === 'pg') {
  console.log('PostgreSQL (pg-mem):');
  const { newDb } = await import('pg-mem');
  const mem = newDb();
  const realPg = mem.adapters.createPg();
  // pg-mem не умеет повторный CREATE TABLE IF NOT EXISTS по уже существующей таблице (в настоящем Postgres это штатно)
  class Pool extends realPg.Pool {
    async query(sql, ...a) {
      try {
        return await super.query(sql, ...a);
      } catch (e) {
        if (/CREATE TABLE IF NOT EXISTS/i.test(String(sql)) && /Not supported/.test(e.message)) return { rows: [] };
        throw e;
      }
    }
  }
  globalThis.__mafiaPgForTests = { ...realPg, Pool };
  // старые данные из JSON переезжают в БД при первом запуске
  fs.writeFileSync(FILE, JSON.stringify({ users: { old1: { id: 'old1', login: 'legacy', name: 'Legacy', coins: 5, xp: 0, games: 0, wins: 0, losses: 0, token: 't-old', emotes: [], skins: ['classic'], tickets: {}, bonuses: {}, createdAt: 1 } } }));
  let s = await fresh();
  await s.init();
  check(s.storageKind().startsWith('PostgreSQL'), 'используется PostgreSQL');
  check(s.adminList().some((u) => u.login === 'legacy'), 'аккаунты из users.json перенесены в БД');
  const c = s.createAccount({ login: 'pgfriend', password: 'secret1', coins: 99 });
  const ens = s.ensureAdmin();
  await s.flush();
  const rows = await mem.public.many('select id, data from mafia_users');
  check(rows.length === 2, 'пользователи лежат в таблице mafia_users');
  check(!!(await mem.public.many("select * from mafia_meta where key='admin'")).length, 'хеш пароля админа сохранён в mafia_meta');

  // «перезапуск»: новый экземпляр модуля читает то же самое из БД
  fs.rmSync(FILE);
  s = await fresh();
  await s.init();
  check(s.adminList().length === 2 && s.verifyLogin('pgfriend', 'secret1').ok, 'после перезапуска аккаунты и пароли на месте');
  check(s.adminCheck(ens.password), 'пароль админа пережил перезапуск');
  s.adminUpdate(c.user.id, { addCoins: 1 });
  s.adminDelete(s.adminList().find((u) => u.login === 'legacy').id);
  await s.flush();
  check((await mem.public.many('select id from mafia_users')).length === 1, 'удаление и правки доходят до БД');
  process.exit(failed ? 1 : 0);
}
