import { useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { Icon, Logo } from '../components/ui.jsx';

const RULES = [
  ['Мафия 🔫', 'Ночью выбирает жертву. Побеждает, когда мафии не меньше, чем мирных.'],
  ['Комиссар 🕵️', 'Каждую ночь проверяет одного игрока и узнаёт, мафия он или нет.'],
  ['Доктор 💉', 'Лечит одного игрока за ночь (режим «Ночная мафия»).'],
  ['Мирный житель 🙂', 'Днём обсуждает и голосует, чтобы казнить мафию.'],
];

const FEATURES = [
  ['⚡', 'Моментальный запуск', 'Без скачивания и регистрации — просто открой сайт и играй.'],
  ['👥', 'Игра с друзьями', 'Создавайте комнаты и делитесь кодом или присоединяйтесь к другим.'],
  ['📱', 'Адаптивный дизайн', 'Удобно играть на любом устройстве: телефон, планшет, компьютер.'],
  ['🛡️', 'Безопасность', 'Чистый код, защита данных, никаких лишних разрешений.'],
  ['💬', 'Регулярные обновления', 'Новые роли, режимы и скины.'],
];

export default function Home() {
  const nav = useNavigate();
  const { quick, installEvent, clearInstall, profile } = useApp();

  const install = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice;
    clearInstall();
  };
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;

  return (
    <div className="home">
      <section className="hero card">
        <div className="hero-left">
          <Logo size="lg" />
          <h1>Классика, которая всегда с тобой</h1>
          <p className="muted">
            Мафия Онлайн — это браузерная игра для друзей, в которую можно играть с телефона и компьютера. Без скачиваний. Быстро, удобно, весело!
          </p>
          <div className="row gap">
            <button className="btn btn-red btn-lg" onClick={quick}>
              Играть сейчас <span>›</span>
            </button>
            {installEvent && !standalone && (
              <button className="btn btn-ghost btn-lg" onClick={install}>
                Установить приложение
              </button>
            )}
          </div>
          <div className="tags muted">PWA · Онлайн · С друзьями</div>
          {isIOS && !standalone && <p className="hint">На iPhone: «Поделиться» → «На экран “Домой”», чтобы установить игру как приложение.</p>}
        </div>
        <div className="hero-right">
          <div className="hero-banner">
            <div className="hero-banner-title">Играйте с друзьями прямо сейчас!</div>
            <button className="btn btn-red" onClick={quick}>
              Играть ›
            </button>
          </div>
        </div>
      </section>

      <section className="quick-cards">
        <button className="card quick-card" onClick={quick}>
          <Icon name="bolt" />
          <b>Быстрая игра</b>
          <span className="muted">Присоединяйся за 10 сек</span>
        </button>
        <button className="card quick-card" onClick={() => nav('/create')}>
          <Icon name="plus" />
          <b>Создать комнату</b>
          <span className="muted">Собери свою компанию</span>
        </button>
        <a className="card quick-card" href="#rules">
          <Icon name="book" />
          <b>Как играть</b>
          <span className="muted">Правила и роли</span>
        </a>
      </section>

      <div className="grid-2">
        <section className="card" id="rules">
          <h3>💡 Как это работает?</h3>
          <ol className="steps">
            <li>Открываешь сайт через браузер (Chrome, Safari и т.д.).</li>
            <li>Нажимаешь «Добавить на главный экран» (PWA).</li>
            <li>Создаёшь комнату или присоединяешься к друзьям.</li>
            <li>Играешь в мафию, общаешься, веселишься!</li>
          </ol>
          <h4>Роли</h4>
          <ul className="rules">
            {RULES.map(([t, d]) => (
              <li key={t}>
                <b>{t}</b>
                <span className="muted">{d}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h3>Почему именно PWA?</h3>
          <p className="muted">Устанавливается на телефон как приложение, но не занимает память. Работает офлайн и моментально запускается.</p>
          <ul className="features">
            {FEATURES.map(([i, t, d]) => (
              <li key={t}>
                <span className="feat-ico">{i}</span>
                <div>
                  <b>{t}</b>
                  <div className="muted small">{d}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {profile && <p className="muted small center">Ты играешь как <b>{profile.name}</b> · уровень {profile.level}</p>}
    </div>
  );
}
