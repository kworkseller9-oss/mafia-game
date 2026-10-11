import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, MODE_LIST, SKINS } from '../store.jsx';

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'classic', label: 'Классика' },
  { id: 'quick', label: 'Быстрая игра' },
  { id: 'night', label: 'Ночная' },
];

export default function Rooms() {
  const { rooms, joinRoom, quick } = useApp();
  const nav = useNavigate();
  const [filter, setFilter] = useState('all');
  const [code, setCode] = useState('');
  const [pwFor, setPwFor] = useState(null);
  const [pw, setPw] = useState('');

  const list = rooms.filter((r) => filter === 'all' || r.mode === filter);

  const join = async (id, password) => {
    const r = await joinRoom(id, password);
    if (r.needPassword) setPwFor(id);
    else if (r.ok) nav('/room');
  };

  return (
    <div>
      <div className="page-head">
        <h2>Выбор комнаты</h2>
        <div className="row gap">
          <button className="btn btn-ghost" onClick={quick}>⚡ Быстрая игра</button>
          <button className="btn btn-red" onClick={() => nav('/create')}>＋ Создать</button>
        </div>
      </div>

      <div className="pills">
        {FILTERS.map((f) => (
          <button key={f.id} className={`pill ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="room-list">
        {list.length === 0 && (
          <div className="empty card">
            <p>Открытых комнат пока нет.</p>
            <p className="muted">Создайте свою или нажмите «Быстрая игра» — мы подберём ботов, чтобы можно было сыграть сразу.</p>
          </div>
        )}
        {list.map((r) => (
          <div className="room-row card" key={r.id}>
            <div className="avatar" style={{ width: 44, height: 44, background: SKINS.classic.color }}>
              <span className="avatar-emoji">{r.mode === 'quick' ? '⚡' : r.mode === 'night' ? '🌙' : '🎩'}</span>
            </div>
            <div className="room-info">
              <b>
                {r.name} {r.hasPassword && '🔒'}
              </b>
              <span className="muted small">
                {r.modeLabel} · хозяин: {r.host}
              </span>
            </div>
            <span className="room-count">
              {r.count}/{r.max}
            </span>
            <button className="btn btn-blue" disabled={r.phase !== 'lobby' || r.count >= r.max} onClick={() => join(r.id)}>
              {r.phase !== 'lobby' ? 'Идёт игра' : 'Войти'}
            </button>
          </div>
        ))}
      </div>

      <div className="card join-code">
        <b>Есть код комнаты?</b>
        <div className="row gap">
          <input value={code} maxLength={6} placeholder="Например: A1B2C3" onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button className="btn btn-blue" disabled={code.length < 4} onClick={() => join(code)}>
            Войти по коду
          </button>
        </div>
      </div>

      {pwFor && (
        <div className="modal-backdrop" onClick={() => setPwFor(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h3>Комната защищена паролем</h3>
            <input autoFocus type="password" value={pw} placeholder="Пароль" onChange={(e) => setPw(e.target.value)} />
            <div className="row gap">
              <button className="btn btn-ghost" onClick={() => setPwFor(null)}>Отмена</button>
              <button
                className="btn btn-blue"
                onClick={async () => {
                  const id = pwFor;
                  const r = await joinRoom(id, pw);
                  if (r.ok) {
                    setPwFor(null);
                    setPw('');
                    nav('/room');
                  }
                }}
              >
                Войти
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
