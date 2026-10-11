import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { Icon } from '../components/ui.jsx';

export function inviteLink(code) {
  return `${location.origin}/?join=${code}`;
}

export async function shareRoom(room, showToast) {
  const url = inviteLink(room.id);
  const text = `Го в мафию! Комната «${room.name}», код: ${room.id}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Mafia Online', text, url });
      return;
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    showToast('Ссылка-приглашение скопирована', 'ok');
  } catch {
    /* пользователь закрыл окно */
  }
}

export default function Friends() {
  const { room, joinRoom, createRoom, showToast } = useApp();
  const nav = useNavigate();
  const [code, setCode] = useState('');

  const join = async () => {
    const r = await joinRoom(code.trim(), '');
    if (r.ok) nav('/room');
  };
  const createPrivate = async () => {
    const r = await createRoom({ name: 'Друзья', mode: 'friends', max: 8, isPrivate: true });
    if (r.ok) nav('/room');
  };

  return (
    <div>
      <div className="page-head">
        <h2>Играть с друзьями</h2>
      </div>
      <div className="grid-2">
        <div className="card">
          <h3>1. Создай приватную комнату</h3>
          <p className="muted">Она не попадает в общий список — зайти можно только по коду или ссылке.</p>
          <button className="btn btn-red" onClick={createPrivate}>
            <Icon name="plus" /> Создать комнату для друзей
          </button>
          {room && (
            <div className="invite-box">
              <div className="muted small">Ваша текущая комната</div>
              <div className="code">{room.id}</div>
              <div className="row gap">
                <button className="btn btn-ghost" onClick={() => shareRoom(room, showToast)}>
                  <Icon name="send" /> Поделиться
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    navigator.clipboard?.writeText(room.id);
                    showToast('Код скопирован', 'ok');
                  }}
                >
                  <Icon name="copy" /> Код
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="card">
          <h3>2. Или зайди по коду</h3>
          <p className="muted">Попроси у друга код из 6 символов или открой его ссылку-приглашение.</p>
          <div className="row gap">
            <input value={code} maxLength={6} placeholder="A1B2C3" onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button className="btn btn-blue" disabled={code.length < 4} onClick={join}>
              Войти
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
