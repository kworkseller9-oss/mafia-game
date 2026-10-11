import { useState } from 'react';
import { useApp } from '../store.jsx';
import { Logo } from '../components/ui.jsx';

export default function Login() {
  const { login, authMsg } = useApp();
  const [l, setL] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const r = await login(l, p);
    setBusy(false);
    if (!r.ok) setErr(r.error);
  };

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <div className="login-logo">
          <Logo size="lg" />
        </div>
        <h2>Вход</h2>
        <p className="muted small">Аккаунты выдаёт администратор. Если у вас ещё нет логина и пароля — попросите их у него.</p>

        {(err || authMsg) && <div className="alert">{err || authMsg}</div>}

        <label>
          Логин
          <input value={l} autoCapitalize="none" autoCorrect="off" autoComplete="username" onChange={(e) => setL(e.target.value)} />
        </label>
        <label>
          Пароль
          <input type="password" value={p} autoComplete="current-password" onChange={(e) => setP(e.target.value)} />
        </label>
        <button className="btn btn-red btn-lg" disabled={busy || !l.trim() || !p}>
          {busy ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
