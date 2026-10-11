import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { beep, ROLES, useApp } from '../store.jsx';
import { Avatar, fmtTime, Icon, useCountdown } from '../components/ui.jsx';
import { shareRoom } from './Friends.jsx';

export default function RoomPage() {
  const { room } = useApp();
  const nav = useNavigate();
  useEffect(() => {
    if (!room) nav('/rooms', { replace: true });
  }, [room, nav]);
  if (!room) return null;
  return room.phase === 'lobby' ? <Lobby room={room} /> : <Game room={room} />;
}

/* ---------------- Чат ---------------- */
function Chat({ room, compact = false }) {
  const { profile, send } = useApp();
  const [text, setText] = useState('');
  const box = useRef(null);
  const me = room.me;
  const canTalk = room.phase === 'lobby' || room.phase === 'end' || !me?.alive || room.phase === 'day' || room.phase === 'vote' || me?.role === 'mafia';
  const placeholder = !canTalk ? 'Ночью говорит только мафия…' : room.phase === 'night' && me?.role === 'mafia' ? 'Чат мафии…' : 'Написать сообщение…';

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [room.chat.length]);

  const submit = async (t) => {
    const v = (t ?? text).trim();
    if (!v) return;
    setText('');
    await send(v);
  };

  return (
    <div className={`chat card ${compact ? 'compact' : ''}`}>
      <div className="chat-log" ref={box}>
        {room.chat.map((m) => (
          <div key={m.id} className={`msg ${m.type}`}>
            {m.type === 'system' ? (
              <span>{m.text}</span>
            ) : (
              <>
                <b>
                  {m.type === 'mafia' && '🔫 '}
                  {m.type === 'dead' && '💀 '}
                  {m.name}:
                </b>{' '}
                <span>{m.text}</span>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="emotes">
        {(profile?.emotes || []).map((e) => (
          <button key={e} disabled={!canTalk} onClick={() => submit(e)}>
            {e}
          </button>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input value={text} maxLength={200} disabled={!canTalk} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-blue icon-btn" disabled={!canTalk || !text.trim()}>
          <Icon name="send" />
        </button>
      </form>
    </div>
  );
}

/* ---------------- Лобби ---------------- */
function Lobby({ room }) {
  const { profile, leave, start, addBot, fillBots, kick, showToast } = useApp();
  const nav = useNavigate();
  const isHost = room.hostId === profile?.id;
  const need = room.min - room.players.length;

  return (
    <div className="lobby">
      <div className="page-head">
        <button className="btn btn-ghost" onClick={async () => { await leave(); nav('/rooms'); }}>
          <Icon name="back" /> Выйти
        </button>
        <h2>
          Комната: {room.name} {room.isPrivate && '❤'}
        </h2>
        <span className="room-count">
          {room.players.length}/{room.max}
        </span>
      </div>

      <div className="card">
        <div className="code-row">
          <div>
            <div className="muted small">Код комнаты · {room.modeLabel}</div>
            <div className="code">{room.id}</div>
          </div>
          <div className="row gap">
            <button className="btn btn-ghost" onClick={() => { navigator.clipboard?.writeText(room.id); showToast('Код скопирован', 'ok'); }}>
              <Icon name="copy" /> Код
            </button>
            <button className="btn btn-blue" onClick={() => shareRoom(room, showToast)}>
              <Icon name="send" /> Пригласить друзей
            </button>
          </div>
        </div>

        <div className="players-row">
          {room.players.map((p) => (
            <div key={p.id} className="lobby-player">
              <Avatar skin={p.skin} size={64} ring={p.isHost ? '#ffcc33' : null} />
              <span className="pname">{p.id === profile?.id ? 'Ты' : p.name}</span>
              {p.isBot && <span className="tag">бот</span>}
              {p.isHost && <span className="tag gold">хозяин</span>}
              {isHost && p.id !== profile?.id && (
                <button className="kick" title="Исключить" onClick={() => kick(p.id)}>✕</button>
              )}
            </div>
          ))}
          {Array.from({ length: Math.max(0, room.max - room.players.length) }).map((_, i) => (
            <div key={'e' + i} className="lobby-player empty">
              <div className="avatar" style={{ width: 64, height: 64 }}>+</div>
            </div>
          ))}
        </div>

        <p className="center muted waiting">
          {need > 0 ? `Ожидание игроков… нужно ещё ${need}` : isHost ? 'Всё готово — можно начинать!' : 'Ждём, пока хозяин начнёт игру…'}
        </p>

        {isHost && (
          <div className="row gap wrap center-row">
            <button className="btn btn-red btn-lg" disabled={need > 0} onClick={start}>
              ▶ Начать игру
            </button>
            <button className="btn btn-ghost" disabled={room.players.length >= room.max} onClick={addBot}>
              🤖 Добавить бота
            </button>
            {need > 0 && (
              <button className="btn btn-ghost" onClick={fillBots}>
                Добавить ботов до минимума
              </button>
            )}
          </div>
        )}
      </div>

      <Chat room={room} compact />
    </div>
  );
}

/* ---------------- Игра ---------------- */
const PHASE_LABEL = { night: '🌙 Ночь', day: '☀️ Обсуждение', vote: '🗳 Голосование', end: '🏁 Конец игры' };

function Game({ room }) {
  const { profile, act, leave, again, sound } = useApp();
  const nav = useNavigate();
  const left = useCountdown(room.timerEnd);
  const me = room.me;
  const role = me?.role;
  const alive = me?.alive;
  const isHost = room.hostId === profile?.id;

  // звуки при смене фазы
  const prevPhase = useRef(room.phase);
  useEffect(() => {
    if (prevPhase.current !== room.phase) {
      beep(room.phase === 'night' ? 300 : room.phase === 'vote' ? 700 : room.phase === 'end' ? 880 : 520, 0.18, sound);
      prevPhase.current = room.phase;
    }
  }, [room.phase, sound]);

  // Какое действие сейчас делается кликом по игроку
  const actionType = useMemo(() => {
    if (!alive) return null;
    if (room.phase === 'vote') return 'vote';
    if (room.phase === 'night') {
      if (role === 'mafia') return 'kill';
      if (role === 'commissar' && !me.checkedTonight) return 'check';
      if (role === 'doctor') return 'heal';
    }
    return null;
  }, [alive, room.phase, role, me?.checkedTonight]);

  const canTarget = (p) => {
    if (!actionType || !p.alive) return false;
    if (actionType === 'kill' && p.role === 'mafia') return false;
    if (actionType === 'check' && p.id === profile.id) return false;
    return true;
  };

  const myChoice = room.phase === 'vote' ? me?.myVote : role === 'mafia' ? me?.myKill : role === 'doctor' ? me?.myHeal : null;

  const voteCount = {};
  Object.values(room.votes || {}).forEach((t) => (voteCount[t] = (voteCount[t] || 0) + 1));

  const prompt = (() => {
    if (room.phase === 'end') return null;
    if (!alive) return 'Вы выбыли из игры и наблюдаете за партией. Можно писать в чат наблюдателей.';
    if (room.phase === 'night') {
      if (role === 'mafia') return 'Выберите жертву и договоритесь с союзниками в чате мафии.';
      if (role === 'commissar') return me.checkedTonight ? 'Проверка выполнена — результат в журнале ниже.' : 'Выберите игрока для проверки.';
      if (role === 'doctor') return 'Выберите, кого вылечить этой ночью.';
      return 'Город спит. Вы мирный житель — ждите утра.';
    }
    if (room.phase === 'day') return 'Обсуждайте! Кто, по вашему мнению, мафия?';
    if (room.phase === 'vote') return 'Нажмите на игрока, чтобы проголосовать за казнь.';
    return '';
  })();

  return (
    <div className={`game phase-${room.phase}`}>
      <div className="game-top card">
        <button className="btn btn-ghost" onClick={async () => { if (room.phase === 'end' || confirm('Выйти из игры? За вас продолжит играть автопилот.')) { await leave(); nav('/rooms'); } }}>
          <Icon name="logout" />
        </button>
        <div className="game-phase">
          <b>
            День {room.day} · {PHASE_LABEL[room.phase]}
          </b>
          {room.phase !== 'end' && <span className={`timer ${left < 6 ? 'urgent' : ''}`}>{fmtTime(left)}</span>}
        </div>
        {role && (
          <div className="role-chip" style={{ borderColor: ROLES[role].color, color: ROLES[role].color }} title={room.roleInfo?.desc}>
            {ROLES[role].emoji} {ROLES[role].name}
          </div>
        )}
      </div>

      {room.roleInfo && room.day === 1 && room.phase === 'night' && (
        <div className="role-banner card" style={{ borderColor: ROLES[role].color }}>
          <b style={{ color: ROLES[role].color }}>
            {ROLES[role].emoji} Ваша роль: {ROLES[role].name}
          </b>
          <span className="muted">{room.roleInfo.desc}</span>
        </div>
      )}

      <div className="game-body">
        <div className="game-main">
          {prompt && <div className="prompt card">{prompt}</div>}

          <div className="players-grid">
            {room.players.map((p) => {
              const target = canTarget(p);
              const chosen = myChoice === p.id;
              const mafiaMark = Object.values(room.mafiaVotes || {}).filter((t) => t === p.id).length;
              return (
                <button
                  key={p.id}
                  className={`pcard ${!p.alive ? 'dead' : ''} ${target ? 'targetable' : ''} ${chosen ? 'chosen' : ''} ${p.id === profile.id ? 'me' : ''}`}
                  disabled={!target}
                  onClick={() => target && act(actionType, p.id)}
                >
                  <Avatar skin={p.skin} size={58} dead={!p.alive} role={p.role} />
                  <span className="pname">{p.id === profile.id ? 'Ты' : p.name}</span>
                  {p.isBot && <span className="tag">бот</span>}
                  {!p.connected && <span className="tag">отключён</span>}
                  {room.phase === 'vote' && voteCount[p.id] > 0 && <span className="votes">🗳 {voteCount[p.id]}</span>}
                  {mafiaMark > 0 && <span className="votes">🎯 {mafiaMark}</span>}
                  {chosen && <span className="votes you">✔ ваш выбор</span>}
                </button>
              );
            })}
          </div>

          <div className="row gap wrap center-row actions">
            {room.phase === 'vote' && alive && (
              <button className={`btn btn-ghost ${me.myVote === 'skip' ? 'active' : ''}`} onClick={() => act('vote', 'skip')}>
                Воздержаться
              </button>
            )}
            {room.phase === 'day' && alive && (
              <button className="btn btn-blue" disabled={me.ready} onClick={() => act('ready')}>
                {me.ready ? 'Ждём остальных…' : 'Готов голосовать'} ({room.readyCount})
              </button>
            )}
          </div>

          {role === 'commissar' && me.checks.length > 0 && (
            <div className="card journal">
              <b>🕵️ Журнал проверок</b>
              {me.checks.map((c, i) => (
                <div key={i}>
                  Ночь {c.day}: {c.name} — {c.isMafia ? <span className="red">МАФИЯ</span> : <span className="green">мирный</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <Chat room={room} />
      </div>

      {room.phase === 'end' && (
        <div className="modal-backdrop">
          <div className="modal card end-modal">
            <h2>{room.winner === 'mafia' ? '🔫 Победила мафия!' : '🏆 Победили мирные жители!'}</h2>
            {room.rewards && (
              <p className={room.rewards.won ? 'green' : 'muted'}>
                {room.rewards.won ? 'Вы победили!' : 'Вы проиграли.'} +{room.rewards.coins} 🪙 · +{room.rewards.xp} XP
              </p>
            )}
            <div className="end-list">
              {room.players.map((p) => (
                <div key={p.id} className="end-row">
                  <Avatar skin={p.skin} size={34} dead={!p.alive} />
                  <span>{p.id === profile.id ? 'Ты' : p.name}</span>
                  <b style={{ color: ROLES[p.role]?.color }}>
                    {ROLES[p.role]?.emoji} {ROLES[p.role]?.name}
                  </b>
                </div>
              ))}
            </div>
            <div className="row gap center-row">
              {isHost ? (
                <button className="btn btn-red" onClick={again}>Сыграть ещё</button>
              ) : (
                <span className="muted small">Ждём, пока хозяин начнёт новую партию…</span>
              )}
              <button className="btn btn-ghost" onClick={async () => { await leave(); nav('/rooms'); }}>
                Выйти
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
