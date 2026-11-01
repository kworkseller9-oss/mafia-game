// Хранилище профилей: PostgreSQL (Neon) при DATABASE_URL, иначе JSON-файл. Данные держим в памяти, пишем с задержкой.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'users.json');
const PERSIST = process.env.NO_PERSIST !== '1';
const DATABASE_URL = process.env.DATABASE_URL || '';

let db = { users: {} };

// ---------- Хранилище: PostgreSQL (Neon) при DATABASE_URL, иначе JSON-файл ----------
/** @type {{kind: string, load: () => Promise<any>, persist: (data: any) => Promise<void>} | null} */
let driver = null;

function fileDriver() {
  const bak = FILE + '.bak';
  return {
    kind: `JSON-файл (${FILE})`,
    async load() {
      for (const f of [FILE, bak]) {
        if (!fs.existsSync(f)) continue;
        try {
          return JSON.parse(fs.readFileSync(f, 'utf8'));
        } catch (e) {
          // битый файл не затираем, а откладываем в сторону — аккаунты можно будет вытащить руками
          console.error(`Не удалось прочитать ${f}: ${e.message}`);
          try {
            fs.renameSync(f, `${f}.corrupt-${Date.now()}`);
          } catch {
            /* ignore */
          }
        }
      }
      return null;
    },
    async persist(data) {
      // атомарная запись: во временный файл, затем rename; предыдущая версия остаётся в .bak
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      if (fs.existsSync(FILE)) fs.copyFileSync(FILE, bak);
      fs.renameSync(tmp, FILE);
    },
  };
}

async function pgDriver() {
  const pg = globalThis.__mafiaPgForTests || (await import('pg')).default; // подмена нужна только тестам
  const noSslParam = !/[?&]sslmode=/.test(DATABASE_URL) && !/@(localhost|127\.0\.0\.1)/.test(DATABASE_URL);
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    ssl: noSslParam ? true : undefined,
  });
  // Neon закрывает простаивающие соединения — без обработчика это роняло бы процесс
  pool.on('error', (e) => console.error('pg pool error:', e.message));

  await pool.query(`CREATE TABLE IF NOT EXISTS mafia_users (
    id text PRIMARY KEY,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL
  )`);
  await pool.query('CREATE TABLE IF NOT EXISTS mafia_meta (key text PRIMARY KEY, value jsonb NOT NULL)');

  let known = new Map(); // id -> JSON последней сохранённой версии (пишем только изменившееся)
  let knownAdmin = null;
  return {
    kind: 'PostgreSQL (DATABASE_URL)',
    async load() {
      const u = await pool.query('SELECT id, data FROM mafia_users');
      const m = await pool.query("SELECT value FROM mafia_meta WHERE key = 'admin'");
      const users = {};
      for (const r of u.rows) {
        users[r.id] = r.data;
        known.set(r.id, JSON.stringify(r.data));
      }
      const admin = m.rows[0]?.value || undefined;
      knownAdmin = admin ? JSON.stringify(admin) : null;
      return { users, admin };
    },
    async persist(data) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const next = new Map();
        for (const [id, u] of Object.entries(data.users)) {
          const js = JSON.stringify(u);
          next.set(id, js);
          if (known.get(id) !== js) {
            await client.query(
              'INSERT INTO mafia_users (id, data, updated_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at',
              [id, js, new Date()],
            );
          }
        }
        for (const id of known.keys()) {
          if (!next.has(id)) await client.query('DELETE FROM mafia_users WHERE id = $1', [id]);
        }
        const adm = data.admin ? JSON.stringify(data.admin) : null;
        if (adm && adm !== knownAdmin) {
          await client.query(
            "INSERT INTO mafia_meta (key, value) VALUES ('admin', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            [adm],
          );
        }
        await client.query('COMMIT');
        known = next;
        knownAdmin = adm;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

let saveTimer = null;
let chain = Promise.resolve();
let dirty = false;

function save() {
  if (!driver) return;
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flush(), 400);
}

/** Дождаться записи всех накопленных изменений (вызывается и при остановке сервера). */
export function flush() {
  clearTimeout(saveTimer);
  if (!driver) return Promise.resolve();
  chain = chain.then(async () => {
    if (!dirty) return;
    dirty = false;
    try {
      await driver.persist(db);
    } catch (e) {
      dirty = true;
      console.error('Ошибка сохранения (повторим через 5 с):', e.message);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => flush(), 5000);
    }
  });
  return chain;
}

export const storageKind = () => driver?.kind || 'только память (NO_PERSIST=1)';

export async function init() {
  if (!PERSIST) return;
  driver = DATABASE_URL ? await pgDriver() : fileDriver();
  const loaded = await driver.load();
  if (loaded && typeof loaded === 'object') db = { ...loaded, users: loaded.users || {} };

  // Первый запуск с Postgres: переносим аккаунты из старого users.json, если он есть
  if (DATABASE_URL && Object.keys(db.users).length === 0 && fs.existsSync(FILE)) {
    try {
      const old = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (old?.users && Object.keys(old.users).length) {
        db = { ...old, users: old.users };
        console.log(`Перенесено аккаунтов из ${FILE} в PostgreSQL: ${Object.keys(old.users).length}`);
        dirty = true;
        await flush();
      }
    } catch (e) {
      console.error('Не удалось перенести данные из JSON:', e.message);
    }
  }
}

// ---------- Каталог магазина ----------
export const SKINS = {
  classic: { name: 'Классический', emoji: '🕴️', color: '#3b4a6b' },
  boss: { name: 'Крутой мафиози', emoji: '🎩', color: '#7a1f2b' },
  detective: { name: 'Детектив', emoji: '🕵️', color: '#5b4a2e' },
  ghost: { name: 'Призрак', emoji: '👻', color: '#4a5568' },
  ninja: { name: 'Ниндзя', emoji: '🥷', color: '#2d2d3a' },
  king: { name: 'Король', emoji: '👑', color: '#8a6d1a' },
};

export const SHOP = [
  { id: 'classic', cat: 'skins', name: 'Классический', price: 0, emoji: '🕴️', desc: 'Бесплатно' },
  { id: 'boss', cat: 'skins', name: 'Крутой мафиози', price: 500, emoji: '🎩', desc: 'Шляпа и стиль' },
  { id: 'detective', cat: 'skins', name: 'Детектив', price: 800, emoji: '🕵️', desc: 'Всё видит' },
  { id: 'ghost', cat: 'skins', name: 'Призрак', price: 1200, emoji: '👻', desc: 'Появился из ниоткуда' },
  { id: 'ninja', cat: 'skins', name: 'Ниндзя', price: 1500, emoji: '🥷', desc: 'Тихо и незаметно' },
  { id: 'king', cat: 'skins', name: 'Король', price: 2500, emoji: '👑', desc: 'Для настоящих лидеров' },

  { id: 'e_evil', cat: 'emotes', name: 'Хитрая улыбка', price: 100, emoji: '😈', desc: 'Эмоция в чате' },
  { id: 'e_think', cat: 'emotes', name: 'Сомнение', price: 100, emoji: '🤔', desc: 'Эмоция в чате' },
  { id: 'e_knife', cat: 'emotes', name: 'Нож', price: 150, emoji: '🔪', desc: 'Эмоция в чате' },
  { id: 'e_pray', cat: 'emotes', name: 'Пощади', price: 100, emoji: '🙏', desc: 'Эмоция в чате' },
  { id: 'e_skull', cat: 'emotes', name: 'Череп', price: 150, emoji: '💀', desc: 'Эмоция в чате' },

  { id: 't_commissar', cat: 'roles', name: 'Билет комиссара', price: 200, emoji: '🕵️', desc: 'Следующая игра — комиссар (если роль есть в режиме)' },
  { id: 't_doctor', cat: 'roles', name: 'Билет доктора', price: 200, emoji: '💉', desc: 'Следующая игра — доктор (режим «Ночная мафия»)' },
  { id: 't_mafia', cat: 'roles', name: 'Билет мафии', price: 200, emoji: '🔫', desc: 'Следующая игра — мафия' },

  { id: 'b_coins', cat: 'bonuses', name: 'x2 монеты', price: 300, emoji: '🪙', desc: 'Двойные монеты на 3 игры' },
  { id: 'b_xp', cat: 'bonuses', name: 'x2 опыт', price: 300, emoji: '⭐', desc: 'Двойной опыт на 3 игры' },
];

export const FREE_EMOTES = ['👍', '😂', '❓'];
export const XP_PER_LEVEL = 300;

const ACHIEVEMENTS = [
  { id: 'first', name: 'Первая игра', emoji: '🏅', check: (u) => u.games >= 1 },
  { id: 'team', name: 'Командный игрок', emoji: '🤝', check: (u) => u.wins >= 3 },
  { id: 'master', name: 'Мастер аргументации', emoji: '🛡️', check: (u) => u.wins >= 10 },
  { id: 'mafioso', name: 'Крёстный отец', emoji: '🎩', check: (u) => (u.winsAsMafia || 0) >= 3 },
  { id: 'streak', name: 'Серия побед', emoji: '🔥', check: (u) => u.bestStreak >= 3 },
];

function randomName() {
  return 'Игрок' + Math.floor(1000 + Math.random() * 9000);
}

export function cleanName(name) {
  const s = String(name ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return s;
}

export function getOrCreateUser(token, name) {
  let user = token ? Object.values(db.users).find((u) => u.token === token) : null;
  if (!user) {
    user = {
      id: randomUUID(),
      token: token || randomUUID(),
      name: cleanName(name) || randomName(),
      coins: 1250,
      xp: 0,
      games: 0,
      wins: 0,
      losses: 0,
      winsAsMafia: 0,
      streak: 0,
      bestStreak: 0,
      skins: ['classic'],
      skin: 'classic',
      emotes: [],
      tickets: { commissar: 0, doctor: 0, mafia: 0 },
      bonuses: { coins: 0, xp: 0 },
      createdAt: Date.now(),
    };
    db.users[user.id] = user;
    save();
  }
  return user;
}

export function getUser(id) {
  return db.users[id] || null;
}

export function publicProfile(u) {
  const level = Math.floor(u.xp / XP_PER_LEVEL) + 1;
  return {
    id: u.id,
    login: u.login || null,
    name: u.name,
    coins: u.coins,
    xp: u.xp,
    level,
    xpInLevel: u.xp % XP_PER_LEVEL,
    xpForLevel: XP_PER_LEVEL,
    games: u.games,
    wins: u.wins,
    losses: u.losses,
    streak: u.streak,
    bestStreak: u.bestStreak,
    skins: u.skins,
    skin: u.skin,
    emotes: [...FREE_EMOTES, ...u.emotes.map((id) => SHOP.find((s) => s.id === id)?.emoji).filter(Boolean)],
    ownedEmoteIds: u.emotes,
    tickets: u.tickets,
    bonuses: u.bonuses,
    achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, emoji: a.emoji, unlocked: a.check(u) })),
  };
}

export function rename(user, name) {
  const n = cleanName(name);
  if (n.length < 2) return { ok: false, error: 'Имя слишком короткое' };
  user.name = n;
  save();
  return { ok: true };
}

export function buy(user, itemId) {
  const item = SHOP.find((s) => s.id === itemId);
  if (!item) return { ok: false, error: 'Товар не найден' };
  if (item.cat === 'skins' && user.skins.includes(item.id)) return { ok: false, error: 'Уже куплено' };
  if (item.cat === 'emotes' && user.emotes.includes(item.id)) return { ok: false, error: 'Уже куплено' };
  if (user.coins < item.price) return { ok: false, error: 'Недостаточно монет' };
  user.coins -= item.price;
  if (item.cat === 'skins') user.skins.push(item.id);
  else if (item.cat === 'emotes') user.emotes.push(item.id);
  else if (item.cat === 'roles') user.tickets[item.id.replace('t_', '')] += 1;
  else if (item.id === 'b_coins') user.bonuses.coins += 3;
  else if (item.id === 'b_xp') user.bonuses.xp += 3;
  save();
  return { ok: true };
}

export function selectSkin(user, skinId) {
  if (!user.skins.includes(skinId)) return { ok: false, error: 'Скин не куплен' };
  user.skin = skinId;
  save();
  return { ok: true };
}

/** Забрать билет роли (вызывается при раздаче ролей). Возвращает true, если билет был. */
export function consumeTicket(user, role) {
  if ((user.tickets[role] || 0) > 0) {
    user.tickets[role] -= 1;
    save();
    return true;
  }
  return false;
}

export function hasTicket(user, role) {
  return (user.tickets[role] || 0) > 0;
}

export function recordGame(user, { won, role }) {
  let coins = won ? 50 : 15;
  let xp = won ? 30 : 10;
  if (user.bonuses.coins > 0) {
    coins *= 2;
    user.bonuses.coins -= 1;
  }
  if (user.bonuses.xp > 0) {
    xp *= 2;
    user.bonuses.xp -= 1;
  }
  user.coins += coins;
  user.xp += xp;
  user.games += 1;
  if (won) {
    user.wins += 1;
    user.streak += 1;
    user.bestStreak = Math.max(user.bestStreak, user.streak);
    if (role === 'mafia') user.winsAsMafia = (user.winsAsMafia || 0) + 1;
  } else {
    user.losses += 1;
    user.streak = 0;
  }
  save();
  return { coins, xp };
}

// ---------- Аккаунты (закрытая регистрация: создаёт только админ) ----------
export const normLogin = (s) => String(s ?? '').trim().toLowerCase();
const LOGIN_RE = /^[a-z0-9_.-]{3,20}$/;
const PASS_MIN = 6;
const PASS_MAX = 64;

const scrypt = (password, salt) => scryptSync(String(password), salt, 64);
function makeHash(password) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scrypt(password, salt).toString('hex') };
}
function matches(password, rec) {
  const a = scrypt(password, rec.salt);
  const b = Buffer.from(rec.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
const DUMMY = makeHash('dummy-password'); // чтобы время ответа не выдавало, существует ли логин

const passwordError = (p) => (String(p ?? '').length < PASS_MIN || String(p).length > PASS_MAX ? `Пароль: от ${PASS_MIN} до ${PASS_MAX} символов` : null);

export function findByLogin(login) {
  const l = normLogin(login);
  return Object.values(db.users).find((u) => u.login === l) || null;
}

export function getUserByToken(token) {
  if (!token) return null;
  return Object.values(db.users).find((u) => u.login && u.token === token) || null;
}

export function createAccount({ login, password, name, coins } = {}) {
  const l = normLogin(login);
  if (!LOGIN_RE.test(l)) return { ok: false, error: 'Логин: 3–20 символов, латиница, цифры, _ . -' };
  const pe = passwordError(password);
  if (pe) return { ok: false, error: pe };
  if (findByLogin(l)) return { ok: false, error: 'Такой логин уже занят' };
  let startCoins = null;
  if (coins !== undefined && coins !== '' && coins !== null) {
    startCoins = Math.floor(Number(coins));
    if (!Number.isFinite(startCoins) || startCoins < 0 || startCoins > 1e9) return { ok: false, error: 'Монеты: число от 0' };
  }
  const user = getOrCreateUser(null, cleanName(name) || l.slice(0, 16));
  user.login = l;
  user.pass = makeHash(password);
  user.blocked = false;
  user.lastLogin = 0;
  if (startCoins !== null) user.coins = startCoins;
  save();
  return { ok: true, user };
}

export function verifyLogin(login, password) {
  const u = findByLogin(login);
  const good = matches(password, u?.pass || DUMMY);
  if (!u || !u.pass || !good) return { ok: false, error: 'Неверный логин или пароль' };
  if (u.blocked) return { ok: false, blocked: true, error: 'Аккаунт заблокирован администратором' };
  u.lastLogin = Date.now();
  save();
  return { ok: true, token: u.token };
}

export function adminList() {
  return Object.values(db.users)
    .filter((u) => u.login)
    .map((u) => ({
      id: u.id,
      login: u.login,
      name: u.name,
      coins: u.coins,
      level: Math.floor(u.xp / XP_PER_LEVEL) + 1,
      games: u.games,
      wins: u.wins,
      losses: u.losses,
      blocked: !!u.blocked,
      createdAt: u.createdAt,
      lastLogin: u.lastLogin || 0,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Возвращает { ok, revoke } — revoke=true, если нужно выкинуть активные сессии игрока. */
export function adminUpdate(id, p = {}) {
  const u = db.users[id];
  if (!u || !u.login) return { ok: false, error: 'Пользователь не найден' };
  // сначала проверяем всё, потом меняем — чтобы не применить половину правки
  if (p.password !== undefined) {
    const pe = passwordError(p.password);
    if (pe) return { ok: false, error: pe };
  }
  let setCoins = null;
  let addCoins = null;
  if (p.coins !== undefined) {
    setCoins = Math.floor(Number(p.coins));
    if (!Number.isFinite(setCoins) || setCoins < 0 || setCoins > 1e9) return { ok: false, error: 'Монеты: число от 0' };
  }
  if (p.addCoins !== undefined) {
    addCoins = Math.floor(Number(p.addCoins));
    if (!Number.isFinite(addCoins) || Math.abs(addCoins) > 1e9) return { ok: false, error: 'Некорректное число монет' };
  }
  let newName = null;
  if (p.name !== undefined) {
    newName = cleanName(p.name);
    if (newName.length < 2) return { ok: false, error: 'Имя слишком короткое' };
  }

  let revoke = false;
  if (p.password !== undefined) {
    u.pass = makeHash(p.password);
    u.token = randomUUID();
    revoke = true;
  }
  if (typeof p.blocked === 'boolean') {
    u.blocked = p.blocked;
    if (p.blocked) {
      u.token = randomUUID();
      revoke = true;
    }
  }
  if (setCoins !== null) u.coins = setCoins;
  if (addCoins !== null) u.coins = Math.max(0, u.coins + addCoins);
  if (newName !== null) u.name = newName;
  save();
  return { ok: true, revoke };
}

export function adminDelete(id) {
  if (!db.users[id]?.login) return { ok: false, error: 'Пользователь не найден' };
  delete db.users[id];
  save();
  return { ok: true };
}

// ---------- Пароль администратора ----------
// Приоритет: переменная ADMIN_PASSWORD. Иначе при первом запуске генерируется случайный пароль,
// в базе хранится только его хеш, а сам пароль печатается в консоль один раз.
let generatedAdminPassword = null;
export function ensureAdmin() {
  if (process.env.ADMIN_PASSWORD) return { source: 'env' };
  if (!db.admin) {
    generatedAdminPassword = randomBytes(9).toString('base64url');
    db.admin = makeHash(generatedAdminPassword);
    save();
    return { source: 'generated', password: generatedAdminPassword };
  }
  return { source: 'saved' };
}

const sha = (x) => createHash('sha256').update(String(x ?? '')).digest();
export function adminCheck(password) {
  if (process.env.ADMIN_PASSWORD) return timingSafeEqual(sha(password), sha(process.env.ADMIN_PASSWORD));
  if (!db.admin) return false;
  return matches(password ?? '', db.admin);
}

export function shopCatalog() {
  return SHOP;
}
