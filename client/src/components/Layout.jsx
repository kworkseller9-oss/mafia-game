import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { Avatar, Icon, Logo } from './ui.jsx';

const NAV = [
  { to: '/', label: 'Главная', icon: 'home', end: true },
  { to: '/rooms', label: 'Комнаты', icon: 'rooms' },
  { to: '/friends', label: 'Друзья', icon: 'friends' },
  { to: '/shop', label: 'Магазин', icon: 'shop' },
  { to: '/settings', label: 'Настройки', icon: 'settings', desktopOnly: true },
  { to: '/profile', label: 'Профиль', icon: 'profile', mobileOnly: true },
];

export default function Layout() {
  const { profile, online, connected, room } = useApp();
  const nav = useNavigate();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div onClick={() => nav('/')} style={{ cursor: 'pointer' }}>
          <Logo size="sm" />
        </div>
        <nav>
          {NAV.filter((n) => !n.mobileOnly).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon name={n.icon} /> {n.label}
            </NavLink>
          ))}
        </nav>
        {room && (
          <button className="btn btn-ghost" onClick={() => nav('/room')}>
            ↩ Вернуться в игру
          </button>
        )}
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-logo" onClick={() => nav('/')}>
            <Logo size="sm" />
          </div>
          <div className="topbar-right">
            <span className={`online ${connected ? '' : 'off'}`}>
              <i /> {connected ? `Онлайн: ${online}` : 'Нет связи'}
            </span>
            {profile && (
              <button className="profile-chip" onClick={() => nav('/profile')}>
                <span className="coins">🪙 {profile.coins}</span>
                <Avatar skin={profile.skin} size={34} />
              </button>
            )}
          </div>
        </header>
        {!connected && <div className="offline-banner">Нет соединения с сервером — пробуем переподключиться…</div>}
        {room && (
          <button className="resume-banner" onClick={() => nav('/room')}>
            Вы в комнате «{room.name}» — вернуться →
          </button>
        )}
        <main className="content">
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav">
        {NAV.filter((n) => !n.desktopOnly).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `bn-item ${isActive ? 'active' : ''}`}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
