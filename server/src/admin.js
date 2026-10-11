import express from 'express';
import { randomBytes } from 'node:crypto';
import * as store from './store.js';

// ---- простая защита от подбора пароля: 8 неудач за 10 минут с одного адреса — блок ----
const fails = new Map();
const WINDOW = 10 * 60 * 1000;
export function tooMany(key) {
  const f = fails.get(key);
  return !!f && f.n >= 8 && Date.now() < f.until;
}
export function fail(key) {
  const now = Date.now();
  const f = fails.get(key);
  if (!f || now > f.until) fails.set(key, { n: 1, until: now + WINDOW });
  else f.n += 1;
}
export function ok(key) {
  fails.delete(key);
}

export function createAdminRouter({ revokeUser, isOnline }) {
  const r = express.Router();
  const sessions = new Map(); // токен → срок действия
  const TTL = 12 * 3600 * 1000;

  r.post('/login', (req, res) => {
    const key = 'admin:' + req.ip;
    if (tooMany(key)) return res.status(429).json({ ok: false, error: 'Слишком много попыток. Подождите 10 минут.' });
    if (!store.adminCheck(req.body?.password)) {
      fail(key);
      return res.status(401).json({ ok: false, error: 'Неверный пароль администратора' });
    }
    ok(key);
    const token = randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + TTL);
    res.json({ ok: true, token });
  });

  const tokenOf = (req) => (req.headers.authorization || '').replace(/^Bearer /, '');
  r.use((req, res, next) => {
    const t = tokenOf(req);
    const exp = sessions.get(t);
    if (!exp || exp < Date.now()) {
      sessions.delete(t);
      return res.status(401).json({ ok: false, error: 'Нужно войти заново' });
    }
    next();
  });

  r.post('/logout', (req, res) => {
    sessions.delete(tokenOf(req));
    res.json({ ok: true });
  });

  r.get('/users', (_req, res) => {
    res.json({ ok: true, users: store.adminList().map((u) => ({ ...u, online: isOnline(u.id) })) });
  });

  r.post('/users', (req, res) => {
    const out = store.createAccount(req.body || {});
    if (!out.ok) return res.status(400).json(out);
    res.json({ ok: true, id: out.user.id, login: out.user.login });
  });

  r.patch('/users/:id', (req, res) => {
    const out = store.adminUpdate(req.params.id, req.body || {});
    if (!out.ok) return res.status(400).json(out);
    if (out.revoke) revokeUser(req.params.id);
    res.json({ ok: true });
  });

  r.delete('/users/:id', (req, res) => {
    const id = req.params.id;
    const out = store.adminDelete(id);
    if (!out.ok) return res.status(400).json(out);
    revokeUser(id);
    res.json({ ok: true });
  });

  return r;
}
