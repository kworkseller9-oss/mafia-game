import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, MODE_LIST } from '../store.jsx';
import { Toggle } from '../components/ui.jsx';

export default function CreateRoom() {
  const { createRoom, profile } = useApp();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [mode, setMode] = useState('classic');
  const [max, setMax] = useState(8);
  const [priv, setPriv] = useState(false);
  const [usePw, setUsePw] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const cfg = MODE_LIST.find((m) => m.id === mode);
  const sizes = [4, 6, 8, 10, 12].filter((n) => n >= cfg.min && n <= cfg.max);

  useEffect(() => {
    if (!sizes.includes(max)) setMax(sizes.includes(8) ? 8 : sizes[sizes.length - 1]);
    if (mode === 'friends') setPriv(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await createRoom({ name: name.trim() || `Комната ${profile?.name || ''}`, mode, max, isPrivate: priv || mode === 'friends', password: usePw ? password : '' });
    setBusy(false);
    if (r.ok) nav('/room');
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Создать комнату</h2>

      <label>
        Название комнаты
        <input value={name} maxLength={24} placeholder="Например: Друзья" onChange={(e) => setName(e.target.value)} />
      </label>

      <label>
        Режим игры
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          {MODE_LIST.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} ({m.min}–{m.max} игроков)
            </option>
          ))}
        </select>
      </label>

      <div>
        <div className="label">Количество игроков</div>
        <div className="segmented">
          {sizes.map((n) => (
            <button type="button" key={n} className={max === n ? 'active' : ''} onClick={() => setMax(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="switch-row">
        <span>С друзьями (приватная)</span>
        <Toggle checked={priv || mode === 'friends'} onChange={(v) => mode !== 'friends' && setPriv(v)} />
      </div>
      <div className="switch-row">
        <span>Пароль (по желанию)</span>
        <Toggle checked={usePw} onChange={setUsePw} />
      </div>
      {usePw && <input value={password} maxLength={16} placeholder="Придумайте пароль" onChange={(e) => setPassword(e.target.value)} />}

      <button className="btn btn-blue btn-lg" disabled={busy}>
        Создать
      </button>
    </form>
  );
}
