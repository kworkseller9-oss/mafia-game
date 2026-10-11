import { useState } from 'react';
import { useApp } from '../store.jsx';
import { Toggle } from '../components/ui.jsx';

export default function Settings() {
  const { profile, rename, sound, setSound, installEvent, clearInstall, logout } = useApp();
  const [name, setName] = useState(profile?.name || '');

  const install = async () => {
    installEvent.prompt();
    await installEvent.userChoice;
    clearInstall();
  };

  return (
    <div className="card form">
      <h2>Настройки</h2>
      <label>
        Имя игрока
        <div className="row gap">
          <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-blue" disabled={name.trim() === profile?.name} onClick={() => rename(name)}>
            Сохранить
          </button>
        </div>
      </label>
      <div className="switch-row">
        <span>Звуки</span>
        <Toggle checked={sound} onChange={setSound} />
      </div>
      {installEvent && (
        <button className="btn btn-ghost" onClick={install}>
          📲 Установить как приложение
        </button>
      )}
      {profile?.login && <p className="muted small">Вы вошли как <b>{profile.login}</b></p>}
      <button className="btn btn-ghost" onClick={logout}>
        Выйти из аккаунта
      </button>
      <p className="muted small">Ваш профиль привязан к вашему аккаунту — монеты и прогресс сохраняются на сервере. Забыли пароль — попросите администратора выдать новый.</p>
    </div>
  );
}
