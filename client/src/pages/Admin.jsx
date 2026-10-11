import { useCallback, useEffect, useState } from 'react';
import { API } from '../store.jsx';
import { Logo } from '../components/ui.jsx';

const KEY = 'mafia.admin';
const getTok = () => {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const setTok = (t) => {
  try {
    if (t) sessionStorage.setItem(KEY, t);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};

function genPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => chars[n % chars.length]).join('');
}

const fmt = (ts) =>
  ts ? new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export default function Admin() {
  const [token, setToken] = useState(getTok);
  const [pw, setPw] = useState('');
  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState('');
  const [creds, setCreds] = useState(null);
  const [form, setForm] = useState({ login: '', password: '', name: '', coins: '' });
  const [busy, setBusy] = useState(false);

  const request = useCallback(
    async (path, method = 'GET', body) => {
      try {
        const r = await fetch(API + '/api/admin' + path, {
          method,
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await r.json().catch(() => ({}));
        if (r.status === 401 && token) {
          setTok(null);
          setToken(null);
        }
        return { ...data, ok: r.ok && data.ok !== false };
      } catch {
        return { ok: false, error: 'Нет связи с сервером' };
      }
    },
    [token],
  );

  const load = useCallback(async () => {
    const r = await request('/users');
    if (r.ok) setUsers(r.users);
    else if (r.error) setMsg(r.error);
  }, [request]);

  useEffect(() => {
    if (!token) return undefined;
    load();
    const t = setInterval(load, 10000); // статус «онлайн» обновляется сам
    return () => clearInterval(t);
  }, [token, load]);

  const login = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    const r = await request('/login', 'POST', { password: pw });
    setBusy(false);
    if (r.ok) {
      setTok(r.token);
      setToken(r.token);
      setPw('');
    } else setMsg(r.error || 'Ошибка входа');
  };

  const logout = async () => {
    await request('/logout', 'POST');
    setTok(null);
    setToken(null);
    setUsers([]);
    setCreds(null);
  };

  const share = (login, password) => ({
    login,
    password,
    text: `Mafia Online\nСсылка: ${location.origin}\nЛогин: ${login}\nПароль: ${password}`,
  });

  const create = async (e) => {
    e.preventDefault();
    setMsg('');
    const r = await request('/users', 'POST', { ...form, login: form.login.trim() });
    if (!r.ok) return setMsg(r.error || 'Не удалось создать аккаунт');
    setCreds(share(r.login, form.password));
    setForm({ login: '', password: '', name: '', coins: '' });
    load();
  };

  const patch = async (id, body, okMsg) => {
    setMsg('');
    const r = await request('/users/' + id, 'PATCH', body);
    if (!r.ok) setMsg(r.error || 'Ошибка');
    else if (okMsg) setMsg(okMsg);
    load();
    return r;
  };

  const resetPassword = async (u) => {
    const p = prompt(`Новый пароль для «${u.login}» (минимум 6 символов):`, genPassword());
    if (!p) return;
    const r = await patch(u.id, { password: p });
    if (r.ok) setCreds(share(u.login, p));
  };
  const addCoins = async (u) => {
    const v = prompt(`Сколько монет добавить «${u.login}»? (можно отрицательное число)`, '500');
    if (v === null || v.trim() === '') return;
    const n = Number(v);
    if (!Number.isFinite(n)) return setMsg('Введите число');
    patch(u.id, { addCoins: n }, `Монеты обновлены: ${u.login}`);
  };
  const toggleBlock = (u) => {
    if (!u.blocked && !confirm(`Заблокировать «${u.login}»? Он сразу вылетит из игры.`)) return;
    patch(u.id, { blocked: !u.blocked }, u.blocked ? `«${u.login}» разблокирован` : `«${u.login}» заблокирован`);
  };
  const remove = async (u) => {
    if (!confirm(`Удалить аккаунт «${u.login}» навсегда? Монеты и статистика пропадут.`)) return;
    setMsg('');
    const r = await request('/users/' + u.id, 'DELETE');
    setMsg(r.ok ? `«${u.login}» удалён` : r.error || 'Ошибка');
    load();
  };
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg('Скопировано — отправь другу');
    } catch {
      setMsg('Не удалось скопировать — выдели текст и скопируй вручную');
    }
  };

  /* ---------- вход админа ---------- */
  if (!token) {
    return (
      <div className="login-page">
        <form className="card login-card" onSubmit={login}>
          <div className="login-logo">
            <Logo size="md" />
          </div>
          <h2>Админ-панель</h2>
          {msg && <div className="alert">{msg}</div>}
          <label>
            Пароль администратора
            <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
          </label>
          <button className="btn btn-blue btn-lg" disabled={busy || !pw}>
            Войти
          </button>
        </form>
      </div>
    );
  }

  /* ---------- панель ---------- */
  const online = users.filter((u) => u.online).length;
  return (
    <div className="admin">
      <div className="admin-head">
        <Logo size="sm" />
        <h2>Админ-панель</h2>
        <span className="muted small">
          Аккаунтов: {users.length} · онлайн: {online}
        </span>
        <button className="btn btn-ghost" onClick={logout}>
          Выйти
        </button>
      </div>

      {msg && (
        <div className="alert" onClick={() => setMsg('')}>
          {msg}
        </div>
      )}

      {creds && (
        <div className="card creds">
          <b>Данные для друга</b>
          <pre>{creds.text}</pre>
          <div className="row gap wrap">
            <button className="btn btn-blue" onClick={() => copy(creds.text)}>
              Скопировать
            </button>
            <button className="btn btn-ghost" onClick={() => setCreds(null)}>
              Скрыть
            </button>
          </div>
          <span className="muted small">Пароль виден только сейчас — на сервере хранится только его хеш.</span>
        </div>
      )}

      <form className="card admin-create" onSubmit={create}>
        <h3>Создать аккаунт</h3>
        <div className="admin-fields">
          <label>
            Логин
            <input value={form.login} placeholder="например: ali" autoCapitalize="none" onChange={(e) => setForm({ ...form, login: e.target.value })} />
          </label>
          <label>
            Пароль
            <div className="row gap">
              <input value={form.password} placeholder="минимум 6 символов" onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <button type="button" className="btn btn-ghost" title="Сгенерировать" onClick={() => setForm({ ...form, password: genPassword() })}>
                🎲
              </button>
            </div>
          </label>
          <label>
            Имя в игре (необязательно)
            <input value={form.name} maxLength={16} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Стартовые монеты (по умолч. 1250)
            <input type="number" min="0" value={form.coins} onChange={(e) => setForm({ ...form, coins: e.target.value })} />
          </label>
        </div>
        <button className="btn btn-red" disabled={!form.login.trim() || form.password.length < 6}>
          ＋ Создать
        </button>
      </form>

      <div className="card table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Логин</th>
              <th>Имя</th>
              <th>Ур.</th>
              <th>🪙</th>
              <th>Игры (П/П)</th>
              <th>Статус</th>
              <th>Вход</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan="8" className="muted center">
                  Пока нет аккаунтов — создайте первый выше.
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className={u.blocked ? 'blocked' : ''}>
                <td>
                  <b>{u.login}</b>
                </td>
                <td>{u.name}</td>
                <td data-label="Ур.">{u.level}</td>
                <td data-label="🪙">{u.coins}</td>
                <td data-label="Игры">
                  {u.games} ({u.wins}/{u.losses})
                </td>
                <td>{u.blocked ? <span className="badge bad">заблокирован</span> : u.online ? <span className="badge good">онлайн</span> : <span className="badge">офлайн</span>}</td>
                <td className="small muted" data-label="Вход">{fmt(u.lastLogin)}</td>
                <td className="actions">
                  <button className="btn btn-ghost" onClick={() => resetPassword(u)}>
                    Пароль
                  </button>
                  <button className="btn btn-ghost" onClick={() => addCoins(u)}>
                    ＋🪙
                  </button>
                  <button className="btn btn-ghost" onClick={() => toggleBlock(u)}>
                    {u.blocked ? 'Разблок.' : 'Блок'}
                  </button>
                  <button className="btn btn-ghost danger" onClick={() => remove(u)}>
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
