import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { Avatar } from '../components/ui.jsx';

export default function Profile() {
  const { profile, rename } = useApp();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  if (!profile) return null;
  const pct = Math.round((profile.xpInLevel / profile.xpForLevel) * 100);

  const save = async () => {
    const r = await rename(name);
    if (r.ok) setEditing(false);
  };

  return (
    <div>
      <div className="card profile-head">
        <Avatar skin={profile.skin} size={84} />
        <div className="profile-info">
          {editing ? (
            <div className="row gap">
              <input autoFocus value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
              <button className="btn btn-blue" onClick={save}>OK</button>
            </div>
          ) : (
            <h2 onClick={() => { setName(profile.name); setEditing(true); }} title="Нажмите, чтобы изменить имя" style={{ cursor: 'pointer' }}>
              {profile.name} ✎
            </h2>
          )}
          <div className="muted">Уровень {profile.level}</div>
          <div className="xp">
            <div className="xp-bar"><i style={{ width: pct + '%' }} /></div>
            <span className="small muted">{profile.xpInLevel} / {profile.xpForLevel} XP</span>
          </div>
        </div>
        <div className="coins big">🪙 {profile.coins}</div>
      </div>

      <div className="stats">
        <div className="card stat"><b>{profile.wins}</b><span className="muted">Побед</span></div>
        <div className="card stat"><b>{profile.losses}</b><span className="muted">Поражений</span></div>
        <div className="card stat"><b>{profile.streak}</b><span className="muted">Подряд</span></div>
        <div className="card stat"><b>{profile.games}</b><span className="muted">Всего игр</span></div>
      </div>

      <h3>Достижения</h3>
      <div className="achievements">
        {profile.achievements.map((a) => (
          <div key={a.id} className={`card ach ${a.unlocked ? '' : 'locked'}`}>
            <div className="ach-ico">{a.emoji}</div>
            <span>{a.name}</span>
          </div>
        ))}
      </div>
      <p className="center"><Link to="/settings" className="muted">Настройки →</Link></p>
    </div>
  );
}
