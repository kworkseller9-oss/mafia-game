import { useEffect, useRef } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from './store.jsx';
import Layout from './components/Layout.jsx';
import { Logo } from './components/ui.jsx';
import Home from './pages/Home.jsx';
import Rooms from './pages/Rooms.jsx';
import CreateRoom from './pages/CreateRoom.jsx';
import RoomPage from './pages/Room.jsx';
import Shop from './pages/Shop.jsx';
import Profile from './pages/Profile.jsx';
import Friends from './pages/Friends.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import Admin from './pages/Admin.jsx';

/** Автопереход в комнату при входе / по ссылке-приглашению ?join=CODE */
function Watcher() {
  const { room, ready, joinRoom } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const had = useRef(false);
  const handledInvite = useRef(false);

  useEffect(() => {
    if (room && !had.current && loc.pathname !== '/room') nav('/room');
    had.current = !!room;
  }, [room, loc.pathname, nav]);

  useEffect(() => {
    if (!ready || handledInvite.current) return;
    const code = new URLSearchParams(location.search).get('join');
    if (!code) return;
    handledInvite.current = true;
    history.replaceState(null, '', location.pathname);
    joinRoom(code, '').then((r) => {
      if (r.ok) nav('/room');
      else if (r.needPassword) nav(`/rooms`);
    });
  }, [ready, joinRoom, nav]);

  return null;
}

function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} key={toast.id}>
      {toast.text}
    </div>
  );
}

export default function App() {
  const { ready, auth } = useApp();
  const loc = useLocation();

  // админка живёт отдельно: у неё свой вход по паролю администратора
  if (loc.pathname.startsWith('/admin')) return <Admin />;
  if (auth === 'login') return <Login />;

  if (!ready) {
    return (
      <div className="splash">
        <Logo size="lg" />
        <p className="muted">Подключаемся к серверу…</p>
      </div>
    );
  }

  return (
    <>
      <Watcher />
      <Routes>
        <Route path="/room" element={<div className="room-shell"><RoomPage /></div>} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="rooms" element={<Rooms />} />
          <Route path="create" element={<CreateRoom />} />
          <Route path="friends" element={<Friends />} />
          <Route path="shop" element={<Shop />} />
          <Route path="profile" element={<Profile />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
      <Toast />
    </>
  );
}
