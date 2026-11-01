// Самотест: прогоняет много партий ботов во всех режимах и проверяет инварианты.
process.env.NO_PERSIST = '1';
const { Game, MODES, roleSetup } = await import('./game.js');
const store = await import('./store.js');

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('FAIL:', msg);
  }
};

// раздача ролей
for (const mode of Object.keys(MODES)) {
  for (let n = MODES[mode].min; n <= MODES[mode].max; n++) {
    const r = roleSetup(n, mode);
    assert(r.length === n, `${mode}/${n}: длина ролей`);
    assert(r.filter((x) => x === 'mafia').length >= 1, `${mode}/${n}: есть мафия`);
    assert(r.filter((x) => x === 'mafia').length < n / 2, `${mode}/${n}: мафия меньше половины`);
    assert(r.filter((x) => x === 'commissar').length === 1, `${mode}/${n}: один комиссар`);
  }
}

function playOne(mode, n) {
  return new Promise((resolve) => {
    const room = new Game({
      name: 't',
      mode,
      max: n,
      fastBots: true,
      onChange: () => {},
      onFinish: (r) => resolve(r),
    });
    while (room.players.length < n) room.addBot();
    const res = room.start();
    assert(res.ok, `start ${mode}/${n}`);
    setTimeout(() => {
      if (room.phase !== 'end') {
        failures++;
        console.error('FAIL: игра не завершилась', mode, n, room.phase, room.day);
        room.destroy();
        resolve(room);
      }
    }, 8000);
  });
}

const stats = { mafia: 0, civilians: 0 };
const jobs = [];
for (let i = 0; i < 40; i++) {
  for (const mode of Object.keys(MODES)) {
    const n = MODES[mode].min + Math.floor(Math.random() * (MODES[mode].max - MODES[mode].min + 1));
    jobs.push(playOne(mode, n));
  }
}
const results = await Promise.all(jobs);
for (const r of results) {
  assert(r.phase === 'end', 'phase end');
  assert(r.winner === 'mafia' || r.winner === 'civilians', 'есть победитель');
  stats[r.winner]++;
  const alive = r.players.filter((p) => p.alive);
  const mafia = alive.filter((p) => p.role === 'mafia').length;
  if (r.winner === 'mafia') assert(mafia >= alive.length - mafia, 'победа мафии корректна');
  else assert(mafia === 0, 'победа мирных корректна');
  r.destroy();
}

// проверка приватности view(): обычный игрок не видит чужие роли
{
  const u1 = store.getOrCreateUser('t1', 'Alice');
  const room = new Game({ name: 'v', mode: 'classic', max: 6, host: u1, fastBots: true, onChange: () => {}, onFinish: () => {} });
  while (room.players.length < 6) room.addBot();
  room.start();
  const v = room.view(u1.id);
  const me = room.byId(u1.id);
  const leaked = v.players.filter((p) => p.id !== u1.id && p.role && !(me.role === 'mafia' && p.role === 'mafia'));
  assert(leaked.length === 0, 'чужие роли не утекают в view()');
  assert(v.me.role === me.role, 'своя роль видна');
  room.destroy();
}

// магазин
{
  const u = store.getOrCreateUser('t2', 'Bob');
  assert(store.buy(u, 'boss').ok, 'покупка скина');
  assert(!store.buy(u, 'boss').ok, 'повторная покупка запрещена');
  assert(store.selectSkin(u, 'boss').ok, 'выбор скина');
  assert(!store.selectSkin(u, 'ninja').ok, 'нельзя выбрать некупленный скин');
  assert(store.buy(u, 't_commissar').ok, 'покупка билета');
  assert(u.tickets.commissar === 1, 'билет добавлен');
}

// аккаунты
{
  assert(!store.createAccount({ login: 'ab', password: 'secret1' }).ok, 'короткий логин отклонён');
  assert(!store.createAccount({ login: 'Bad Login', password: 'secret1' }).ok, 'пробел в логине отклонён');
  assert(!store.createAccount({ login: 'friend1', password: '123' }).ok, 'короткий пароль отклонён');
  const c = store.createAccount({ login: 'Friend1', password: 'secret1', name: 'Али', coins: 777 });
  assert(c.ok && c.user.login === 'friend1' && c.user.coins === 777, 'аккаунт создан, логин в нижнем регистре');
  assert(!store.createAccount({ login: 'FRIEND1', password: 'secret2' }).ok, 'дубликат логина отклонён');
  assert(!JSON.stringify(store.publicProfile(c.user)).includes('hash'), 'профиль не содержит хеш пароля');
  assert(!JSON.stringify(store.adminList()).includes('hash'), 'список админа не содержит хеш пароля');

  const bad = store.verifyLogin('friend1', 'wrong');
  assert(!bad.ok && !bad.token, 'неверный пароль не пускает');
  assert(!store.verifyLogin('nobody', 'secret1').ok, 'несуществующий логин не пускает');
  const good = store.verifyLogin('FRIEND1', 'secret1');
  assert(good.ok && store.getUserByToken(good.token)?.id === c.user.id, 'вход и токен работают');
  assert(store.getUserByToken('garbage') === null, 'левый токен не принимается');

  const oldToken = good.token;
  const r1 = store.adminUpdate(c.user.id, { password: 'newpass9' });
  assert(r1.ok && r1.revoke, 'смена пароля просит отозвать сессии');
  assert(store.getUserByToken(oldToken) === null, 'старый токен после смены пароля недействителен');
  assert(!store.verifyLogin('friend1', 'secret1').ok, 'старый пароль не работает');
  assert(store.verifyLogin('friend1', 'newpass9').ok, 'новый пароль работает');

  assert(store.adminUpdate(c.user.id, { addCoins: 100 }).ok && c.user.coins === 877, 'начисление монет');
  assert(store.adminUpdate(c.user.id, { addCoins: -5000 }).ok && c.user.coins === 0, 'монеты не уходят в минус');
  assert(!store.adminUpdate(c.user.id, { coins: 'abc' }).ok, 'мусор вместо монет отклонён');
  assert(!store.adminUpdate(c.user.id, { password: '1', coins: 50 }).ok && c.user.coins === 0, 'ошибка в правке — ничего не применяется');

  const t2 = store.verifyLogin('friend1', 'newpass9').token;
  const bl = store.adminUpdate(c.user.id, { blocked: true });
  assert(bl.ok && bl.revoke, 'блокировка отзывает сессии');
  const blocked = store.verifyLogin('friend1', 'newpass9');
  assert(!blocked.ok && blocked.blocked, 'заблокированный не входит');
  assert(store.getUserByToken(t2) === null, 'токен заблокированного недействителен');
  assert(store.adminUpdate(c.user.id, { blocked: false }).ok && store.verifyLogin('friend1', 'newpass9').ok, 'разблокировка');

  assert(store.adminDelete(c.user.id).ok && !store.verifyLogin('friend1', 'newpass9').ok, 'удаление аккаунта');
  assert(!store.adminDelete('nope').ok, 'удаление несуществующего');

  process.env.ADMIN_PASSWORD = 'adm-test-pass';
  assert(store.adminCheck('adm-test-pass') && !store.adminCheck('adm-test-pas') && !store.adminCheck(''), 'пароль админа из env');
  delete process.env.ADMIN_PASSWORD;
  const gen = store.ensureAdmin();
  assert(gen.password && store.adminCheck(gen.password) && !store.adminCheck('x'), 'сгенерированный пароль админа');
}

// билеты ролей: конфликт двух билетов на одну роль не должен «съедать» билет без роли
{
  let broken = 0;
  let granted = 0;
  for (let i = 0; i < 300; i++) {
    const a = store.getOrCreateUser('tk-a' + i, 'A');
    const b = store.getOrCreateUser('tk-b' + i, 'B');
    a.tickets.commissar = 1;
    b.tickets.commissar = 1;
    const room = new Game({ name: 'tk', mode: 'classic', max: 6, host: a, fastBots: true, onChange: () => {}, onFinish: () => {} });
    room.addHuman(b);
    while (room.players.length < 6) room.addBot();
    room.start();
    const pa = room.byId(a.id);
    const pb = room.byId(b.id);
    const spent = (1 - a.tickets.commissar) + (1 - b.tickets.commissar);
    const have = [pa, pb].filter((p) => p.role === 'commissar').length;
    granted += have;
    // каждый списанный билет обязан соответствовать реально выданной роли комиссара
    if (spent !== have || have > 1) broken++;
    room.destroy();
  }
  assert(broken === 0, `билеты: списано ровно столько, сколько выдано ролей (нарушений: ${broken})`);
  assert(granted > 0, 'билет комиссара срабатывает');
}

// вернувшийся человек не получает «автоходов», запланированных на время отсутствия
{
  const u = store.getOrCreateUser('rt1', 'Back');
  const room = new Game({ name: 'rt', mode: 'classic', max: 6, host: u, fastBots: true, onChange: () => {}, onFinish: () => {} });
  while (room.players.length < 6) room.addBot();
  room.start();
  room.removePlayer(u.id); // ушёл на автопилот: запланированы ходы
  room.reconnect(u.id); // тут же вернулся
  await new Promise((r) => setTimeout(r, 50));
  const me = room.byId(u.id);
  const acted = room.night.mafia[u.id] || (me.role === 'commissar' && room.night.check) || (me.role === 'doctor' && room.night.heal);
  assert(!acted, 'автопилот не ходит за вернувшегося игрока');
  assert(!room.chat.some((m) => m.from === u.id && m.type !== 'system'), 'автопилот не пишет в чат за вернувшегося игрока');
  room.destroy();
}

// ушедший из партии не получает награду
{
  const u = store.getOrCreateUser('lv1', 'Leaver');
  const finished = new Promise((resolve) => {
    const room = new Game({ name: 'lv', mode: 'quick', max: 6, host: u, fastBots: true, onChange: () => {}, onFinish: resolve });
    while (room.players.length < 6) room.addBot();
    room.start();
    room.removePlayer(u.id); // ушёл сразу
  });
  const r = await finished;
  assert(!r.rewards[u.id] && u.games === 0 && u.coins === 1250, 'ушедший из партии не получает монеты и статистику');
  r.destroy();
}

// нельзя голосовать за себя
{
  const u = store.getOrCreateUser('sv1', 'Self');
  const room = new Game({ name: 'sv', mode: 'classic', max: 6, host: u, onChange: () => {}, onFinish: () => {} });
  while (room.players.length < 6) room.addBot();
  room.start();
  room.startVote();
  assert(!room.act(u.id, { type: 'vote', target: u.id }).ok, 'голос за себя отклоняется');
  room.destroy();
}

console.log(`Партий: ${results.length}, победы мафии: ${stats.mafia}, мирных: ${stats.civilians}`);
if (failures) {
  console.error(`Провалено проверок: ${failures}`);
  process.exit(1);
}
console.log('OK — все проверки пройдены');
process.exit(0);
