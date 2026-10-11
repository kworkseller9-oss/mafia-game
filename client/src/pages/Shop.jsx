import { useEffect, useState } from 'react';
import { SKINS, useApp } from '../store.jsx';
import { Avatar } from '../components/ui.jsx';

const TABS = [
  { id: 'skins', label: 'Скины' },
  { id: 'roles', label: 'Роли' },
  { id: 'emotes', label: 'Эмоции' },
  { id: 'bonuses', label: 'Бонусы' },
];

export default function Shop() {
  const { profile, buy, selectSkin } = useApp();
  const [tab, setTab] = useState('skins');
  const [items, setItems] = useState([]);

  useEffect(() => {
    fetch((import.meta.env.VITE_SERVER_URL || '') + '/api/shop')
      .then((r) => r.json())
      .then(setItems)
      .catch(() => {});
  }, []);

  if (!profile) return null;
  const list = items.filter((i) => i.cat === tab);

  const owned = (i) => (i.cat === 'skins' ? profile.skins.includes(i.id) : i.cat === 'emotes' ? profile.ownedEmoteIds.includes(i.id) : false);
  const count = (i) => (i.cat === 'roles' ? profile.tickets[i.id.replace('t_', '')] : i.id === 'b_coins' ? profile.bonuses.coins : i.id === 'b_xp' ? profile.bonuses.xp : 0);

  return (
    <div>
      <div className="page-head">
        <h2>Магазин</h2>
        <span className="coins big">🪙 {profile.coins}</span>
      </div>
      <div className="pills">
        {TABS.map((t) => (
          <button key={t.id} className={`pill ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'skins' && <h3 className="muted">Скины для персонажей</h3>}
      <div className="shop-grid">
        {list.map((i) => (
          <div className="card shop-item" key={i.id}>
            {i.cat === 'skins' ? <Avatar skin={i.id} size={84} /> : <div className="big-emoji">{i.emoji}</div>}
            <b>{i.name}</b>
            <span className="muted small">{i.price === 0 ? 'Бесплатно' : i.desc}</span>
            {i.price > 0 && <span className="price">🪙 {i.price}</span>}
            {i.cat === 'skins' ? (
              profile.skin === i.id ? (
                <button className="btn btn-ghost" disabled>Выбрано</button>
              ) : owned(i) ? (
                <button className="btn btn-green" onClick={() => selectSkin(i.id)}>Выбрать</button>
              ) : (
                <button className="btn btn-blue" disabled={profile.coins < i.price} onClick={() => buy(i.id)}>Купить</button>
              )
            ) : owned(i) ? (
              <button className="btn btn-ghost" disabled>Куплено</button>
            ) : (
              <button className="btn btn-blue" disabled={profile.coins < i.price} onClick={() => buy(i.id)}>
                Купить{count(i) > 0 ? ` (есть: ${count(i)})` : ''}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
