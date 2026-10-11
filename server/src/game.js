import { randomUUID } from 'node:crypto';
import * as store from './store.js';

export const MODES = {
  classic: { label: 'Классическая мафия', sub: 'Опытные игроки', min: 6, max: 12, t: { night: 30, day: 60, vote: 30 }, doctor: false },
  quick: { label: 'Быстрая игра', sub: 'На 10 минут', min: 5, max: 8, t: { night: 15, day: 30, vote: 15 }, doctor: false },
  night: { label: 'Ночная мафия', sub: 'Сложный режим', min: 6, max: 12, t: { night: 25, day: 45, vote: 25 }, doctor: true },
  friends: { label: 'С друзьями', sub: 'Своя компания', min: 4, max: 12, t: { night: 30, day: 60, vote: 30 }, doctor: false },
};

export const ROLE_INFO = {
  mafia: { name: 'Мафия', desc: 'Убивает ночью. Победа — когда мафии не меньше, чем мирных.' },
  commissar: { name: 'Комиссар', desc: 'Проверяет игрока ночью и узнаёт, мафия ли он.' },
  doctor: { name: 'Доктор', desc: 'Лечит ночью одного игрока — спасает от убийства.' },
  civilian: { name: 'Мирный житель', desc: 'Пытается выжить и вычислить мафию на голосовании.' },
};

const BOT_NAMES = ['Artem', 'Sofi', 'Dima', 'Lera', 'Bek', 'Nodir', 'Kamila', 'Timur', 'Alina', 'Rustam', 'Madina', 'Oleg', 'Zarina', 'Max'];
const SKIN_IDS = ['classic', 'boss', 'detective', 'ghost', 'ninja', 'king'];

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rnd = (min, max) => min + Math.random() * (max - min);

export function roleSetup(n, mode) {
  const mafia = n >= 10 ? 3 : n >= 7 ? 2 : 1;
  const roles = Array(mafia).fill('mafia');
  roles.push('commissar');
  if (MODES[mode].doctor && n >= 6) roles.push('doctor');
  while (roles.length < n) roles.push('civilian');
  return roles;
}

export class Game {
  /**
   * @param {object} opts
   * @param {(room: Game) => void} opts.onChange  — вызывается при любом изменении состояния
   * @param {(room: Game) => void} opts.onFinish  — игра окончена
   */
  constructor({ name, mode, max, isPrivate, password, host, onChange, onFinish, fastBots = false }) {
    this.id = randomUUID().slice(0, 6).toUpperCase();
    this.name = name;
    this.mode = mode;
    this.cfg = MODES[mode];
    this.max = Math.min(Math.max(max || this.cfg.max, this.cfg.min), this.cfg.max);
    this.isPrivate = !!isPrivate;
    this.password = password || '';
    this.players = [];
    this.hostId = null;
    this.phase = 'lobby';
    this.day = 0;
    this.timerEnd = 0;
    this.chat = [];
    this.winner = null;
    this.rewards = {};
    this.votes = {};
    this.night = this.freshNight();
    this.ready = new Set();
    this.claims = new Map(); // комиссар-бот -> кого объявил мафией
    this.suspicion = {}; // playerId -> очки подозрительности (для ботов)
    this.timer = null;
    this.botTimers = [];
    this.lastChatAt = {};
    this.onChange = onChange || (() => {});
    this.onFinish = onFinish || (() => {});
    this.fastBots = fastBots; // для тестов — боты думают мгновенно
    this.createdAt = Date.now();
    if (host) this.addHuman(host);
  }

  freshNight() {
    return { mafia: {}, check: null, heal: null };
  }

  // ---------- игроки ----------
  addHuman(user) {
    const p = {
      id: user.id,
      name: user.name,
      isBot: false,
      connected: true,
      alive: true,
      role: null,
      skin: user.skin,
      revealed: false,
      checks: [],
    };
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    this.sys(`${p.name} вошёл в комнату`);
    return p;
  }

  addBot() {
    const used = new Set(this.players.map((p) => p.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    const p = {
      id: 'bot-' + randomUUID().slice(0, 8),
      name: free.length ? pick(free) : 'Bot' + Math.floor(Math.random() * 99),
      isBot: true,
      connected: true,
      alive: true,
      role: null,
      skin: pick(SKIN_IDS),
      revealed: false,
      checks: [],
    };
    this.players.push(p);
    return p;
  }

  removePlayer(id) {
    const p = this.byId(id);
    if (!p) return;
    if (this.phase === 'lobby' || this.phase === 'end') {
      this.players = this.players.filter((x) => x.id !== id);
      if (this.phase === 'lobby') this.sys(`${p.name} вышел из комнаты`);
      if (this.hostId === id) {
        const next = this.players.find((x) => !x.isBot);
        this.hostId = next ? next.id : null;
      }
    } else {
      // во время партии игрок становится «автопилотом»
      p.connected = false;
      this.sys(`${p.name} отключился — за него играет автопилот`);
      if (this.hostId === id) {
        const next = this.players.find((x) => !x.isBot && x.connected);
        this.hostId = next ? next.id : this.hostId;
      }
      this.scheduleBots();
      this.checkAdvanceEarly();
    }
    this.onChange(this);
  }

  reconnect(id) {
    const p = this.byId(id);
    if (p && !p.connected) {
      p.connected = true;
      this.sys(`${p.name} вернулся в игру`);
      this.onChange(this);
    }
  }

  byId(id) {
    return this.players.find((p) => p.id === id);
  }
  isAuto(p) {
    return p.isBot || !p.connected;
  }
  humans() {
    return this.players.filter((p) => !p.isBot);
  }
  connectedHumans() {
    return this.players.filter((p) => !p.isBot && p.connected);
  }
  alive() {
    return this.players.filter((p) => p.alive);
  }

  // ---------- чат ----------
  sys(text) {
    this.pushChat({ type: 'system', text });
  }
  pushChat(m) {
    this.chat.push({ id: randomUUID().slice(0, 8), ts: Date.now(), ...m });
    if (this.chat.length > 200) this.chat.shift();
  }

  say(userId, text) {
    const p = this.byId(userId);
    if (!p) return { ok: false, error: 'Вы не в комнате' };
    text = String(text || '').replace(/[<>]/g, '').trim().slice(0, 200);
    if (!text) return { ok: false };
    const now = Date.now();
    if (!p.isBot && now - (this.lastChatAt[userId] || 0) < 400) return { ok: false, error: 'Слишком часто' };
    this.lastChatAt[userId] = now;

    if (this.phase === 'lobby' || this.phase === 'end') {
      this.pushChat({ type: 'chat', from: p.id, name: p.name, text });
    } else if (!p.alive) {
      this.pushChat({ type: 'dead', from: p.id, name: p.name, text });
    } else if (this.phase === 'day' || this.phase === 'vote') {
      this.pushChat({ type: 'chat', from: p.id, name: p.name, text });
    } else if (this.phase === 'night') {
      if (p.role !== 'mafia') return { ok: false, error: 'Ночью говорит только мафия' };
      this.pushChat({ type: 'mafia', from: p.id, name: p.name, text });
    }
    this.onChange(this);
    return { ok: true };
  }

  // ---------- старт ----------
  canStart() {
    return this.phase === 'lobby' && this.players.length >= this.cfg.min;
  }

  start() {
    if (!this.canStart()) return { ok: false, error: `Нужно минимум ${this.cfg.min} игроков (можно добавить ботов)` };
    this.assignRoles();
    this.day = 0;
    this.winner = null;
    this.rewards = {};
    this.chat = [];
    this.claims = new Map();
    this.suspicion = {};
    this.sys('Игра началась! Город засыпает…');
    this.startNight();
    return { ok: true };
  }

  assignRoles() {
    const roles = shuffle(roleSetup(this.players.length, this.mode));
    const ps = shuffle(this.players);
    ps.forEach((p, i) => {
      p.role = roles[i];
      p.alive = true;
      p.revealed = false;
      p.checks = [];
    });
    // Билеты ролей: меняемся ролью с тем, у кого нужная роль, если он без билета на неё
    for (const p of ps) {
      if (p.isBot) continue;
      const u = store.getUser(p.id);
      if (!u) continue;
      for (const want of ['commissar', 'doctor', 'mafia']) {
        if (!store.hasTicket(u, want)) continue;
        if (!roles.includes(want)) continue; // роли нет в этом режиме
        if (p.role !== want) {
          const holder = ps.find((x) => x.role === want);
          if (holder) {
            [holder.role, p.role] = [p.role, holder.role];
          }
        }
        if (p.role === want) store.consumeTicket(u, want);
        break;
      }
    }
  }

  // ---------- фазы ----------
  clearTimers() {
    clearTimeout(this.timer);
    this.botTimers.forEach(clearTimeout);
    this.botTimers = [];
  }

  setPhase(phase) {
    this.clearTimers();
    this.phase = phase;
    const dur = this.cfg.t[phase];
    this.timerEnd = Date.now() + dur * 1000;
    this.timer = setTimeout(() => this.onTimeout(), dur * 1000);
    this.onChange(this);
    this.scheduleBots();
  }

  onTimeout() {
    if (this.phase === 'night') this.endNight();
    else if (this.phase === 'day') this.startVote();
    else if (this.phase === 'vote') this.endVote();
  }

  startNight() {
    this.day += 1;
    this.night = this.freshNight();
    this.votes = {};
    this.sys(`🌙 Ночь ${this.day}. Мафия выбирает жертву…`);
    this.setPhase('night');
  }

  endNight() {
    // Убийство
    const tally = {};
    Object.values(this.night.mafia).forEach((t) => (tally[t] = (tally[t] || 0) + 1));
    let victim = null;
    const entries = Object.entries(tally);
    if (entries.length) {
      const max = Math.max(...entries.map((e) => e[1]));
      victim = pick(entries.filter((e) => e[1] === max))[0];
    }
    let text;
    if (!victim) {
      text = '☀️ Наступило утро. Этой ночью никто не погиб.';
    } else if (victim === this.night.heal) {
      text = '☀️ Наступило утро. Мафия стреляла, но доктор спас жертву — никто не погиб!';
    } else {
      const v = this.byId(victim);
      v.alive = false;
      v.revealed = true;
      text = `☀️ Наступило утро. Этой ночью убит ${v.name} — он был: ${ROLE_INFO[v.role].name}.`;
    }
    this.sys(text);
    if (this.checkWin()) return;
    this.ready = new Set();
    this.sys('Обсуждение: говорите, кто, по вашему мнению, мафия?');
    this.setPhase('day');
  }

  startVote() {
    this.votes = {};
    this.sys('🗳 Голосование! Выберите, кого казнить.');
    this.setPhase('vote');
  }

  endVote() {
    const tally = {};
    for (const [voter, target] of Object.entries(this.votes)) {
      if (!this.byId(voter)?.alive) continue;
      if (target === 'skip') continue;
      tally[target] = (tally[target] || 0) + 1;
    }
    const entries = Object.entries(tally);
    let executed = null;
    if (entries.length) {
      const max = Math.max(...entries.map((e) => e[1]));
      const top = entries.filter((e) => e[1] === max);
      if (top.length === 1) executed = top[0][0];
    }
    if (executed) {
      const p = this.byId(executed);
      p.alive = false;
      p.revealed = true;
      // боты запоминают, кто голосовал за казнённого
      for (const [voter, target] of Object.entries(this.votes)) {
        if (target !== executed) continue;
        this.suspicion[voter] = (this.suspicion[voter] || 0) + (p.role === 'mafia' ? -2 : 1);
      }
      this.sys(`⚖️ Город казнил ${p.name} — он был: ${ROLE_INFO[p.role].name}.`);
    } else {
      this.sys('⚖️ Голоса разделились — никто не казнён.');
    }
    if (this.checkWin()) return;
    this.startNight();
  }

  checkWin() {
    const alive = this.alive();
    const mafia = alive.filter((p) => p.role === 'mafia').length;
    const rest = alive.length - mafia;
    let winner = null;
    if (mafia === 0) winner = 'civilians';
    else if (mafia >= rest) winner = 'mafia';
    if (!winner) return false;
    this.finish(winner);
    return true;
  }

  finish(winner) {
    this.clearTimers();
    this.winner = winner;
    this.phase = 'end';
    this.timerEnd = 0;
    this.sys(winner === 'mafia' ? '🏆 Победа мафии!' : '🏆 Победа мирных жителей!');
    this.rewards = {};
    for (const p of this.players) {
      if (p.isBot) continue;
      const u = store.getUser(p.id);
      if (!u) continue;
      const won = (p.role === 'mafia') === (winner === 'mafia');
      this.rewards[p.id] = { won, ...store.recordGame(u, { won, role: p.role }) };
    }
    this.onChange(this);
    this.onFinish(this);
  }

  again() {
    if (this.phase !== 'end') return { ok: false };
    this.clearTimers();
    this.players = this.players.filter((p) => p.isBot || p.connected);
    this.players.forEach((p) => {
      p.alive = true;
      p.role = null;
      p.revealed = false;
      p.checks = [];
    });
    this.phase = 'lobby';
    this.day = 0;
    this.winner = null;
    this.rewards = {};
    this.chat = [];
    this.sys('Новая партия! Ждём игроков.');
    this.onChange(this);
    return { ok: true };
  }

  // ---------- действия игроков ----------
  act(userId, { type, target }) {
    const p = this.byId(userId);
    if (!p || !p.alive) return { ok: false, error: 'Вы не можете действовать' };
    const t = target && target !== 'skip' ? this.byId(target) : null;

    if (type === 'kill') {
      if (this.phase !== 'night' || p.role !== 'mafia') return { ok: false, error: 'Сейчас нельзя' };
      if (!t || !t.alive) return { ok: false, error: 'Выберите живого игрока' };
      if (t.role === 'mafia') return { ok: false, error: 'Нельзя стрелять в своих' };
      this.night.mafia[p.id] = t.id;
    } else if (type === 'check') {
      if (this.phase !== 'night' || p.role !== 'commissar') return { ok: false, error: 'Сейчас нельзя' };
      if (this.night.check) return { ok: false, error: 'Вы уже проверяли этой ночью' };
      if (!t || !t.alive || t.id === p.id) return { ok: false, error: 'Выберите другого живого игрока' };
      this.night.check = t.id;
      p.checks.push({ targetId: t.id, name: t.name, isMafia: t.role === 'mafia', day: this.day });
    } else if (type === 'heal') {
      if (this.phase !== 'night' || p.role !== 'doctor') return { ok: false, error: 'Сейчас нельзя' };
      if (!t || !t.alive) return { ok: false, error: 'Выберите живого игрока' };
      this.night.heal = t.id;
    } else if (type === 'vote') {
      if (this.phase !== 'vote') return { ok: false, error: 'Сейчас не голосование' };
      if (target === 'skip') this.votes[p.id] = 'skip';
      else {
        if (!t || !t.alive) return { ok: false, error: 'Выберите живого игрока' };
        this.votes[p.id] = t.id;
      }
    } else if (type === 'ready') {
      if (this.phase !== 'day') return { ok: false, error: 'Сейчас нельзя' };
      this.ready.add(p.id);
    } else {
      return { ok: false, error: 'Неизвестное действие' };
    }
    this.onChange(this);
    this.checkAdvanceEarly();
    return { ok: true };
  }

  /** Все, кто должен был сходить, сходили — не ждём таймер. */
  checkAdvanceEarly() {
    if (this.phase === 'night') {
      const alive = this.alive();
      const mafia = alive.filter((p) => p.role === 'mafia');
      const mafiaDone = mafia.every((m) => this.night.mafia[m.id]);
      const com = alive.find((p) => p.role === 'commissar');
      const doc = alive.find((p) => p.role === 'doctor');
      const comDone = !com || this.night.check;
      const docDone = !doc || this.night.heal;
      if (mafiaDone && comDone && docDone) this.later(() => this.phase === 'night' && this.endNight(), 1500);
    } else if (this.phase === 'day') {
      const alive = this.alive();
      if (alive.every((p) => this.isAuto(p) || this.ready.has(p.id))) {
        this.later(() => this.phase === 'day' && this.startVote(), 1000);
      }
    } else if (this.phase === 'vote') {
      const alive = this.alive();
      if (alive.every((p) => this.votes[p.id])) this.later(() => this.phase === 'vote' && this.endVote(), 1500);
    }
  }

  later(fn, ms) {
    const t = setTimeout(fn, this.fastBots ? 0 : ms);
    this.botTimers.push(t);
  }

  // ---------- боты ----------
  scheduleBots() {
    const phase = this.phase;
    const dur = this.cfg.t[phase] * 1000;
    const at = (min, max, fn) => {
      const delay = this.fastBots ? 0 : Math.min(rnd(min, max), dur * 0.8);
      this.botTimers.push(setTimeout(() => this.phase === phase && fn(), delay));
    };
    const alive = this.alive();
    const autos = alive.filter((p) => this.isAuto(p));

    if (phase === 'night') {
      const mafia = alive.filter((p) => p.role === 'mafia');
      for (const b of autos) {
        if (b.role === 'mafia') {
          at(2500, 8000, () => {
            const targets = this.alive().filter((x) => x.role !== 'mafia');
            const claimers = targets.filter((x) => this.claims.has(x.id));
            if (targets.length) this.act(b.id, { type: 'kill', target: pick(claimers.length ? claimers : targets).id });
          });
        } else if (b.role === 'commissar') {
          at(3000, 9000, () => {
            const known = new Set(b.checks.map((c) => c.targetId));
            const targets = this.alive().filter((x) => x.id !== b.id && !known.has(x.id));
            if (targets.length) this.act(b.id, { type: 'check', target: pick(targets).id });
            else this.night.check = this.night.check || 'none';
            this.checkAdvanceEarly();
          });
        } else if (b.role === 'doctor') {
          at(3000, 9000, () => this.act(b.id, { type: 'heal', target: pick(this.alive()).id }));
        }
      }
      void mafia;
    } else if (phase === 'day') {
      for (const b of autos) {
        const lines = Math.floor(rnd(1, 4));
        for (let i = 0; i < lines; i++) {
          at(3000 + i * 9000, 9000 + i * 12000, () => {
            if (!this.byId(b.id)?.alive) return;
            this.say(b.id, this.botLine(b));
          });
        }
        at(dur * 0.45, dur * 0.7, () => this.act(b.id, { type: 'ready' }));
      }
    } else if (phase === 'vote') {
      for (const b of autos) {
        at(2500, 10000, () => {
          const target = this.botVoteTarget(b);
          this.act(b.id, { type: 'vote', target });
        });
      }
    }
  }

  botVoteTarget(b) {
    const others = this.alive().filter((x) => x.id !== b.id);
    if (!others.length) return 'skip';
    if (b.role === 'commissar') {
      const m = b.checks.find((c) => c.isMafia && this.byId(c.targetId)?.alive);
      if (m) return m.targetId;
    }
    if (b.role === 'mafia') {
      const civ = others.filter((x) => x.role !== 'mafia');
      const claimers = civ.filter((x) => this.claims.has(x.id));
      if (claimers.length) return pick(claimers).id;
      if (civ.length) return pick(civ).id;
    }
    // мирные боты верят заявке живого комиссара
    for (const [claimer, target] of this.claims) {
      if (this.byId(claimer)?.alive && this.byId(target)?.alive && target !== b.id && Math.random() < 0.8) return target;
    }
    const scored = others.filter((x) => (this.suspicion[x.id] || 0) > 0);
    if (scored.length && Math.random() < 0.65) {
      const top = Math.max(...scored.map((x) => this.suspicion[x.id]));
      return pick(scored.filter((x) => this.suspicion[x.id] === top)).id;
    }
    if (Math.random() < 0.1) return 'skip';
    return pick(others).id;
  }

  botLine(b) {
    if (b.role === 'commissar') {
      const found = b.checks.find((c) => c.isMafia && this.byId(c.targetId)?.alive);
      if (found) {
        this.claims.set(b.id, found.targetId);
        return `Я комиссар! ${found.name} — мафия, голосуем против него!`;
      }
    }
    const others = this.alive().filter((x) => x.id !== b.id);
    const who = others.length ? pick(others).name : 'кто-то';
    const generic = [
      'Хм…', 'Я мирный, клянусь', 'Давайте не будем спешить', 'Кто-то подозрительно молчит',
      `${who}, почему ты молчишь?`, `Мне кажется, это ${who}`, `Я думаю, это ${who}`, 'Нужно слушать внимательнее',
      `Голосую против ${who}`, 'ок', 'Ночью было тихо…', `${who} странно себя ведёт`,
    ];
    return pick(generic);
  }

  // ---------- представление для клиента ----------
  summary() {
    return {
      id: this.id,
      name: this.name,
      mode: this.mode,
      modeLabel: this.cfg.label,
      modeSub: this.cfg.sub,
      count: this.players.length,
      max: this.max,
      isPrivate: this.isPrivate,
      hasPassword: !!this.password,
      phase: this.phase,
      host: this.byId(this.hostId)?.name || '—',
    };
  }

  view(userId) {
    const me = this.byId(userId);
    const end = this.phase === 'end';
    const iMafia = me?.role === 'mafia';
    const players = this.players.map((p) => {
      const showRole = end || p.id === userId || p.revealed || (iMafia && p.role === 'mafia');
      return {
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        connected: p.connected,
        alive: p.alive,
        skin: p.skin,
        isHost: p.id === this.hostId,
        role: this.phase === 'lobby' ? null : showRole ? p.role : null,
      };
    });

    const chat = this.chat.filter((m) => {
      if (m.type === 'mafia') return end || iMafia;
      if (m.type === 'dead') return end || (me && !me.alive);
      return true;
    });

    const meView = me
      ? {
          id: me.id,
          role: this.phase === 'lobby' ? null : me.role,
          alive: me.alive,
          checks: me.checks,
          myVote: this.votes[me.id] || null,
          myKill: this.phase === 'night' ? this.night.mafia[me.id] || null : null,
          myHeal: this.phase === 'night' && me.role === 'doctor' ? this.night.heal : null,
          checkedTonight: me.role === 'commissar' ? !!this.night.check : false,
          ready: this.ready.has(me.id),
        }
      : null;

    return {
      id: this.id,
      name: this.name,
      mode: this.mode,
      modeLabel: this.cfg.label,
      min: this.cfg.min,
      max: this.max,
      isPrivate: this.isPrivate,
      hostId: this.hostId,
      phase: this.phase,
      day: this.day,
      timerEnd: this.timerEnd,
      winner: this.winner,
      rewards: this.rewards[userId] || null,
      players,
      me: meView,
      votes: this.phase === 'vote' ? this.votes : {},
      mafiaVotes: iMafia && this.phase === 'night' ? this.night.mafia : {},
      readyCount: this.phase === 'day' ? this.ready.size : 0,
      chat,
      roleInfo: me?.role && this.phase !== 'lobby' ? ROLE_INFO[me.role] : null,
    };
  }

  destroy() {
    this.clearTimers();
  }
}
