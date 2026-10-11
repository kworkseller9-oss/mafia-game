import { useEffect, useState } from 'react';
import { ROLES, SKINS } from '../store.jsx';

export function Hat({ size = 64 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="34" r="22" fill="#b3122b" opacity=".85" />
      <ellipse cx="32" cy="38" rx="21" ry="5" fill="#161a26" />
      <path d="M19 38 L21 22 Q32 14 43 22 L45 38 Z" fill="#161a26" />
      <rect x="20" y="31" width="24" height="4" fill="#ff2d4d" />
    </svg>
  );
}

export function Logo({ size = 'md' }) {
  return (
    <div className={`logo logo-${size}`}>
      <Hat size={size === 'lg' ? 96 : size === 'sm' ? 28 : 44} />
      <div className="logo-text">
        <span className="logo-mafia">MAFIA</span>
        <span className="logo-online">ONLINE</span>
      </div>
    </div>
  );
}

export function Avatar({ skin = 'classic', size = 48, dead = false, role = null, ring = null, children }) {
  const s = SKINS[skin] || SKINS.classic;
  return (
    <div
      className={`avatar ${dead ? 'dead' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.5, background: s.color, boxShadow: ring ? `0 0 0 3px ${ring}` : undefined }}
    >
      <span className="avatar-emoji">{s.emoji}</span>
      {dead && <span className="avatar-skull">💀</span>}
      {role && !dead && (
        <span className="avatar-role" style={{ background: ROLES[role]?.color }}>
          {ROLES[role]?.emoji}
        </span>
      )}
      {children}
    </div>
  );
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function useCountdown(endTs) {
  const [left, setLeft] = useState(() => (endTs ? (endTs - Date.now()) / 1000 : 0));
  useEffect(() => {
    if (!endTs) {
      setLeft(0);
      return;
    }
    const tick = () => setLeft(Math.max(0, (endTs - Date.now()) / 1000));
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [endTs]);
  return left;
}

export function Toggle({ checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Icon({ name }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    home: <path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
    rooms: (
      <>
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M8 21h8M12 18v3" />
      </>
    ),
    friends: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
        <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .7 3.5 2.6 3.5 5.5" />
      </>
    ),
    shop: (
      <>
        <path d="M5 8h14l-1 12H6z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </>
    ),
    profile: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
      </>
    ),
    bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    book: (
      <>
        <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
        <path d="M19 19v2H6" />
      </>
    ),
    copy: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V6a2 2 0 0 1 2-2h9" />
      </>
    ),
    send: <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />,
    back: <path d="M15 18l-6-6 6-6" />,
    logout: (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="M16 17l5-5-5-5M21 12H9" />
      </>
    ),
  };
  return <svg {...common}>{paths[name]}</svg>;
}
