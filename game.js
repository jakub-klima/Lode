/* ══════════════════════════════════════════════════════════════
   LODĚ — Mare Mercatorum
   Hot-seat obchodní hra pro 2–4 kapitány.
   ══════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────── SVĚT ─────────────────────────── */

const W = 1200, H = 720;          // logické rozměry mapy
const SPEED   = 50;               // px za sekundu
const DAY_PX  = 80;               // kolik px plavby je jeden den
const CAPACITY = 20;              // kapacita podpalubí
const START_GOLD = 500;

const PORTS = [
  { name:'Solný Mys',     x:190,  y:165, lx:0,   ly:-96, al:'center', seed:11,
    motto:'Sklady soli a stavebního dřeva' },
  { name:'Zlatá Zátoka',  x:1000, y:130, lx:0,   ly:-98, al:'center', seed:29,
    motto:'Bohaté tkalcovny a rozmařilí kupci' },
  { name:'Rybářov',       x:150,  y:560, lx:0,   ly:102, al:'center', seed:47,
    motto:'Sítě plné, měšce prázdné' },
  { name:'Černý Útes',    x:960,  y:590, lx:0,   ly:104, al:'center', seed:71,
    motto:'Pašerácké doupě — rum téměř zadarmo' },
  { name:'Ostrov Koření', x:580,  y:360, lx:0,   ly:-92, al:'center', seed:97,
    motto:'Muškát, hřebíček a skořice ze zahrad' },
];

const GOODS = [
  { name:'Ryby',    mark:'R', base:12,  mods:[1.15, 1.35, 0.55, 1.15, 1.30] },
  { name:'Dřevo',   mark:'D', base:28,  mods:[0.60, 1.20, 1.15, 0.90, 1.35] },
  { name:'Rum',     mark:'U', base:52,  mods:[1.35, 1.25, 1.05, 0.55, 1.00] },
  { name:'Hedvábí', mark:'H', base:95,  mods:[1.10, 0.70, 1.30, 0.85, 1.15] },
  { name:'Koření',  mark:'K', base:160, mods:[1.30, 1.40, 1.35, 1.30, 0.45] },
];

const COLORS = [
  { hex:'#a8321e', name:'vermilion' },
  { hex:'#2f4b7c', name:'indigo'    },
  { hex:'#3f6b57', name:'verdigris' },
  { hex:'#a9781f', name:'okr'       },
];

const DEFAULT_NAMES = ['Hráč 1', 'Hráč 2', 'Hráč 3', 'Hráč 4'];

const dist = (a, b) => Math.hypot(PORTS[a].x - PORTS[b].x, PORTS[a].y - PORTS[b].y);
const days = (a, b) => Math.max(1, Math.round(dist(a, b) / DAY_PX));
const anchorPrice = (g, p) => GOODS[g].base * GOODS[g].mods[p];
const fmt = n => Math.round(n).toLocaleString('cs-CZ').replace(/ /g, ' ');

/* ─────────────────────────── STAV ─────────────────────────── */

const S = {
  phase: 'setup',          // setup | sailing | port | over
  players: [],
  prices: [],              // prices[port][good] = aktuální kupní cena
  goal: 3500,
  day: 1,
  dayFrac: 0,
  queue: [],               // kapitáni čekající na přístavní kancelář
  current: null,
  pickedDest: null,
  log: [],
  started: false,
};

/* deterministický šum pro kresbu ostrovů */
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ────────────────────────── TRŽIŠTĚ ───────────────────────── */

function seedMarket(){
  S.prices = PORTS.map((_, p) =>
    GOODS.map((_, g) => {
      const a = anchorPrice(g, p);
      return Math.max(1, Math.round(a * (0.9 + Math.random() * 0.2)));
    })
  );
}

/** Ceny se plynule vracejí ke svému kotvícímu bodu a přitom šumí. */
function tickMarket(){
  for (let p = 0; p < PORTS.length; p++){
    for (let g = 0; g < GOODS.length; g++){
      const a = anchorPrice(g, p);
      let v = S.prices[p][g];
      v += (a - v) * 0.28 + a * (Math.random() * 0.26 - 0.13);
      S.prices[p][g] = Math.max(1, Math.round(clamp(v, a * 0.55, a * 1.75)));
    }
  }
}

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const buyPrice  = (p, g) => S.prices[p][g];
const sellPrice = (p, g) => Math.max(1, Math.round(S.prices[p][g] * 0.9));

/** Zprávy z tržiště — jednorázový cenový otřes v přístavu. */
const NEWS = [
  { d: -0.45, t: g => `Do přístavu vplula flotila s nákladem — <b>${g}</b> je náhle všude a cena padá.` },
  { d: -0.35, t: g => `Letošní úroda předčila očekávání. Kupci se <b>${g.toLowerCase()}m</b> jen hemží.` },
  { d:  0.50, t: g => `Skladiště lehla popelem. Za <b>${g.toLowerCase()}</b> se dnes platí zlatem.` },
  { d:  0.38, t: g => `Guvernér pořádá hostinu — po <b>${g.toLowerCase()}</b> je nebývalá poptávka.` },
  { d:  0.42, t: g => `Bouře uzavřely průliv. <b>${g}</b> do přístavu měsíc nedorazí.` },
];

function rollNews(port){
  if (Math.random() > 0.45) return null;
  const ev = NEWS[Math.floor(Math.random() * NEWS.length)];
  const g  = Math.floor(Math.random() * GOODS.length);
  const a  = anchorPrice(g, port);
  S.prices[port][g] = Math.max(1, Math.round(clamp(S.prices[port][g] * (1 + ev.d), a * 0.4, a * 2.1)));
  return ev.t(GOODS[g].name);
}

/* ─────────────────────────── SETUP ────────────────────────── */

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let nPlayers = 3;

function buildPlayerFields(){
  const box = $('#playerFields');
  box.innerHTML = '';
  for (let i = 0; i < nPlayers; i++){
    const row = document.createElement('div');
    row.className = 'prow';
    row.style.animationDelay = (i * 60) + 'ms';
    row.innerHTML = `
      <span class="flag" style="background:${COLORS[i].hex}"></span>
      <input type="text" maxlength="22" value="${DEFAULT_NAMES[i]}" aria-label="Jméno kapitána ${i+1}">
      <span class="home">domovský přístav: ${PORTS[i].name}</span>`;
    box.appendChild(row);
  }
}

$$('#playerCount button').forEach(b => b.addEventListener('click', () => {
  $$('#playerCount button').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  nPlayers = +b.dataset.n;
  buildPlayerFields();
}));

$$('#goalPick button').forEach(b => b.addEventListener('click', () => {
  $$('#goalPick button').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  S.goal = +b.dataset.g;
}));

$('#startBtn').addEventListener('click', startGame);
$('#againBtn').addEventListener('click', () => location.reload());

function startGame(){
  const names = $$('#playerFields input').map(i => i.value.trim());

  S.players = names.map((nm, i) => ({
    id: i,
    name: nm || DEFAULT_NAMES[i],
    color: COLORS[i].hex,
    gold: START_GOLD,
    cargo: GOODS.map(() => 0),
    at: i,                 // domovský přístav
    from: i, to: i,
    t: 1, legDist: 1,
    docked: true,
    bob: Math.random() * Math.PI * 2,
    known: {},             // portId -> { prices:[...], day }
    trades: 0,
  }));

  seedMarket();
  S.goal = +($('#goalPick button.on').dataset.g);
  $('#goalLabel').textContent = fmt(S.goal);

  $('#setup').hidden = true;
  $('#game').hidden = false;

  resize();
  renderFleet();
  pushLog('Kotvy nahoru. Pět přístavů čeká na své kupce.', '#c9a24a');

  // úvodní kolo: každý kapitán si vybaví loď a zvolí kurz
  S.queue = [...S.players];
  S.phase = 'port';
  nextInQueue();
}

/* ───────────────────────── HERNÍ SMYČKA ───────────────────── */

let last = performance.now();

function loop(now){
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (S.phase === 'sailing'){
    let arrived = [];
    for (const pl of S.players){
      if (pl.docked) continue;
      pl.t += (SPEED * dt) / pl.legDist;
      if (pl.t >= 1){
        pl.t = 1; pl.docked = true; pl.at = pl.to;
        arrived.push(pl);
      }
    }
    S.dayFrac += (SPEED * dt) / DAY_PX;
    while (S.dayFrac >= 1){ S.dayFrac -= 1; S.day++; }
    $('#dayCount').textContent = S.day;

    if (arrived.length){
      S.phase = 'port';
      tickMarket();
      renderFleet();
      for (const pl of arrived){
        pushLog(`<b>${pl.name}</b> přistál v přístavu ${PORTS[pl.at].name}.`, pl.color);
      }
      S.queue = arrived;
      nextInQueue();
    }
  }

  draw(now / 1000);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function nextInQueue(){
  if (!S.queue.length){
    S.phase = 'sailing';
    S.current = null;
    $('#portScreen').hidden = true;
    renderFleet();
    return;
  }
  S.current = S.queue.shift();
  openPort(S.current);
}

/* ────────────────────── PŘÍSTAVNÍ KANCELÁŘ ────────────────── */

function openPort(pl){
  const port = pl.at;
  S.pickedDest = null;

  // zapamatuj si zdejší ceny
  pl.known[port] = { prices: S.prices[port].slice(), day: S.day };

  $('#portName').textContent = PORTS[port].name;
  $('#captainName').textContent = pl.name;
  $('#captainFlag').style.background = pl.color;

  const news = S.started ? rollNews(port) : null;
  const nb = $('#newsBanner');
  if (news){ nb.hidden = false; nb.innerHTML = '„' + news + '“'; }
  else nb.hidden = true;

  $('#portScreen').hidden = false;
  $('.port-sheet').scrollTop = 0;
  refreshPort();
  renderFleet();
}

function refreshPort(){
  const pl = S.current, port = pl.at;
  const held = pl.cargo.reduce((a, b) => a + b, 0);

  /* ── tržnice ── */
  const rows = GOODS.map((gd, g) => {
    const bp = buyPrice(port, g), sp = sellPrice(port, g);
    const a  = anchorPrice(g, port);
    const rel = bp / a;
    const trend = rel > 1.12 ? '<span class="trend up">▲</span>'
                : rel < 0.9  ? '<span class="trend down">▼</span>' : '';
    const canBuy = n => pl.gold >= bp * n && held + n <= CAPACITY;
    const maxBuy = Math.min(Math.floor(pl.gold / bp), CAPACITY - held);
    const own = pl.cargo[g];

    return `<tr>
      <td class="c-good"><span class="good">
        <span class="mark">${gd.mark}</span><span class="gname">${gd.name}</span></span></td>
      <td class="c-num"><span class="price">${fmt(bp)}${trend}</span></td>
      <td class="c-num"><span class="price">${fmt(sp)}</span></td>
      <td class="c-num"><span class="qty ${own ? 'has' : ''}">${own}</span></td>
      <td class="c-act">
        <button class="tbtn" data-g="${g}" data-n="1"  ${canBuy(1) ? '' : 'disabled'}>+1</button>
        <button class="tbtn" data-g="${g}" data-n="5"  ${canBuy(5) ? '' : 'disabled'}>+5</button>
        <button class="tbtn" data-g="${g}" data-n="${maxBuy}" ${maxBuy > 0 ? '' : 'disabled'}>max</button>
        <span class="tsep"></span>
        <button class="tbtn sell" data-g="${g}" data-n="-1" ${own >= 1 ? '' : 'disabled'}>−1</button>
        <button class="tbtn sell" data-g="${g}" data-n="-5" ${own >= 5 ? '' : 'disabled'}>−5</button>
        <button class="tbtn sell" data-g="${g}" data-n="${-own}" ${own > 0 ? '' : 'disabled'}>vše</button>
      </td></tr>`;
  }).join('');
  $('#marketRows').innerHTML = rows;
  $$('#marketRows .tbtn').forEach(b =>
    b.addEventListener('click', () => trade(+b.dataset.g, +b.dataset.n)));

  /* ── lodní deník ── */
  $('#statGold').textContent  = fmt(pl.gold);
  $('#statCargo').textContent = `${held} / ${CAPACITY}`;
  $('#holdFill').style.width  = (held / CAPACITY * 100) + '%';

  const hl = GOODS.map((gd, g) => pl.cargo[g]
      ? `<li><span>${gd.name}</span><span>${pl.cargo[g]} ks · ${fmt(sellPrice(port, g) * pl.cargo[g])} zl.</span></li>`
      : '').join('');
  $('#holdList').innerHTML = hl || '<li class="empty">podpalubí je prázdné</li>';

  const cargoVal = GOODS.reduce((s, _, g) => s + pl.cargo[g] * sellPrice(port, g), 0);
  $('#netWorth').innerHTML = `Jmění při dnešním kurzu: <b>${fmt(pl.gold + cargoVal)}</b> zl.
    &nbsp;—&nbsp; do cíle zbývá ${fmt(Math.max(0, S.goal - pl.gold))} zl. v hotovosti.`;

  renderDest();

  /* ── tlačítko ── */
  const btn = $('#sailBtn');
  if (pl.gold >= S.goal){
    btn.disabled = false;
    btn.textContent = 'Zakotvit a vyhlásit vítězství ⚑';
    btn.onclick = () => endGame(pl);
  } else {
    btn.onclick = confirmSail;
    btn.disabled = S.pickedDest === null;
    btn.textContent = S.pickedDest === null
      ? 'Zvol cílový přístav'
      : `Vyplout do přístavu ${PORTS[S.pickedDest].name} ⚓`;
  }
}

function trade(g, n){
  const pl = S.current, port = pl.at;
  if (n > 0){
    const cost = buyPrice(port, g) * n;
    const held = pl.cargo.reduce((a, b) => a + b, 0);
    if (cost > pl.gold || held + n > CAPACITY) return;
    pl.gold -= cost; pl.cargo[g] += n;
  } else {
    const q = Math.min(-n, pl.cargo[g]);
    if (q <= 0) return;
    pl.gold += sellPrice(port, g) * q; pl.cargo[g] -= q;
  }
  pl.trades++;
  refreshPort();
  renderFleet();
}

function renderDest(){
  const pl = S.current, port = pl.at;
  const grid = $('#destGrid');
  grid.innerHTML = '';

  PORTS.forEach((pt, d) => {
    if (d === port) return;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'dest' + (S.pickedDest === d ? ' on' : '');
    card.innerHTML = `
      <span class="d-name">${pt.name}</span>
      <span class="d-dist">${days(port, d)} dní plavby · ${Math.round(dist(port, d))} mil</span>
      <span class="d-tip">${destTip(pl, port, d)}</span>`;
    card.addEventListener('click', () => {
      S.pickedDest = d;
      refreshPort();
    });
    grid.appendChild(card);
  });
}

/** Co kapitán o cílovém přístavu ví z dřívějších plaveb. */
function destTip(pl, from, to){
  const k = pl.known[to];
  if (!k) return '<i>neprozkoumáno — mapy mlčí</i>';

  const held = GOODS.map((_, g) => g).filter(g => pl.cargo[g] > 0);
  const age = S.day - k.day;
  const stamp = age <= 0 ? '' : ` <i style="opacity:.6">(zprávy staré ${age} dní)</i>`;

  if (held.length){
    const lines = held.slice(0, 3).map(g => {
      const there = Math.max(1, Math.round(k.prices[g] * 0.9));
      const here  = sellPrice(from, g);
      const arrow = there > here ? '<span class="up">▲</span>' : there < here ? '<span class="down">▼</span>' : '·';
      return `<span class="good-tip">${GOODS[g].name} ${arrow} ${fmt(there)} zl.</span>`;
    }).join('');
    return `Prodej dle posledních zpráv:${stamp}${lines}`;
  }

  // prázdné podpalubí → doporuč nejlevnější zboží
  let best = 0, bestRel = Infinity;
  GOODS.forEach((_, g) => {
    const rel = k.prices[g] / anchorPrice(g, to);
    if (rel < bestRel){ bestRel = rel; best = g; }
  });
  return `Levně tam pořídíš <b>${GOODS[best].name}</b> — ${fmt(k.prices[best])} zl.${stamp}`;
}

function confirmSail(){
  const pl = S.current, d = S.pickedDest;
  if (d === null) return;

  pl.from = pl.at; pl.to = d;
  pl.legDist = dist(pl.from, pl.to);
  pl.t = 0; pl.docked = false; pl.at = null;

  pushLog(`<b>${pl.name}</b> vyplouvá k přístavu ${PORTS[d].name}.`, pl.color);
  S.started = true;
  nextInQueue();
}

/* ─────────────────────────── KONEC ────────────────────────── */

function endGame(winner){
  S.phase = 'over';
  $('#portScreen').hidden = true;
  $('#endScreen').hidden = false;
  $('#winnerName').textContent = winner.name;
  $('#winnerLine').innerHTML =
    `Po ${S.day} dnech na moři skládá v přístavu ${PORTS[winner.at].name} <b>${fmt(winner.gold)}</b> zlatých.
     Gilda mu uděluje pečeť prvního kupce.`;

  const board = [...S.players].sort((a, b) => b.gold - a.gold);
  $('#finalBoard').innerHTML = board.map((p, i) => `
    <li style="animation-delay:${i * 90}ms">
      <span class="rank">${['I','II','III','IV'][i]}</span>
      <span class="flag" style="background:${p.color}"></span>
      <span class="nm">${p.name}</span>
      <span class="gl">${fmt(p.gold)} zl.</span>
    </li>`).join('');
}

/* ──────────────────────── HUD & ZÁZNAM ────────────────────── */

function renderFleet(){
  $('#fleetStrip').innerHTML = S.players.map(p => {
    const where = p.docked
      ? `kotví · ${PORTS[p.at].name}`
      : `na moři · ${PORTS[p.to].name} (${Math.max(1, Math.round((1 - p.t) * p.legDist / DAY_PX))} d)`;
    const held = p.cargo.reduce((a, b) => a + b, 0);
    const cls = 'fleet-card' + (S.current === p ? ' active' : p.docked ? '' : ' sailing');
    return `<div class="${cls}" style="--c:${p.color}">
      <div><div class="fc-name">${p.name}</div><div class="fc-meta">${where} · ${held}/${CAPACITY}</div></div>
      <div class="fc-gold">${fmt(p.gold)}</div></div>`;
  }).join('');
}

function pushLog(html, color){
  S.log.unshift({ html, color });
  S.log = S.log.slice(0, 5);
  $('#log').innerHTML = S.log.map((l, i) =>
    `<div class="log-line ${i > 1 ? 'fade' : ''}" style="--c:${l.color}">${l.html}</div>`).join('');
}

/* ═══════════════════════ KRESBA MAPY ══════════════════════════ */

const cv  = $('#map');
const ctx = cv.getContext('2d');
let view = { s:1, ox:0, oy:0 };

function resize(){
  const wrap = $('#mapWrap');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = wrap.clientWidth, h = wrap.clientHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const s = Math.min(w / W, h / H);
  view = { s: s * dpr, ox: (w - W * s) / 2 * dpr, oy: (h - H * s) / 2 * dpr };
}
window.addEventListener('resize', resize);

/* předpočítané ostrovy */
const ISLANDS = PORTS.map(p => {
  const rnd = mulberry32(p.seed);
  const n = 18, pts = [];
  for (let i = 0; i < n; i++){
    const a = i / n * Math.PI * 2;
    const r = 62 + rnd() * 34 + Math.sin(a * 3 + p.seed) * 9;
    pts.push({ x: p.x + Math.cos(a) * r * 1.18, y: p.y + Math.sin(a) * r * 0.82 });
  }
  return pts;
});

function blob(pts, shrink, cx, cy){
  ctx.beginPath();
  const P = shrink
    ? pts.map(q => ({ x: cx + (q.x - cx) * shrink, y: cy + (q.y - cy) * shrink }))
    : pts;
  ctx.moveTo((P[0].x + P[P.length-1].x)/2, (P[0].y + P[P.length-1].y)/2);
  for (let i = 0; i < P.length; i++){
    const a = P[i], b = P[(i + 1) % P.length];
    ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x)/2, (a.y + b.y)/2);
  }
  ctx.closePath();
}

function draw(time){
  if (!S.players.length) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.setTransform(view.s, 0, 0, view.s, view.ox, view.oy);

  drawParchment();
  drawRhumbLines();
  drawWaves(time);
  drawSeaLanes();
  ISLANDS.forEach((pts, i) => drawIsland(pts, i, time));
  drawWakes(time);
  PORTS.forEach((p, i) => drawPortLabel(p, i, time));
  S.players.forEach(p => drawShip(p, time));
  drawCompass(time);
  drawCartouche();
  drawScale();
  drawFrame();
}

function drawParchment(){
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0,   '#e9dcbc');
  g.addColorStop(.45, '#e2d2ac');
  g.addColorStop(1,   '#d3bf94');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // stařecké skvrny
  ctx.save();
  const rnd = mulberry32(5);
  for (let i = 0; i < 26; i++){
    const x = rnd() * W, y = rnd() * H, r = 40 + rnd() * 150;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(150,116,66,${0.03 + rnd() * 0.05})`);
    rg.addColorStop(1, 'rgba(150,116,66,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

function drawRhumbLines(){
  const nodes = [{ x: 600, y: 360 }, { x: 210, y: 250 }, { x: 990, y: 470 }];
  ctx.save();
  ctx.lineWidth = 0.5;
  nodes.forEach((n, k) => {
    for (let i = 0; i < 16; i++){
      const a = i / 16 * Math.PI * 2;
      ctx.strokeStyle = i % 4 === 0 ? 'rgba(122,52,36,.18)' : 'rgba(72,54,34,.11)';
      ctx.beginPath();
      ctx.moveTo(n.x, n.y);
      ctx.lineTo(n.x + Math.cos(a) * 1500, n.y + Math.sin(a) * 1500);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(122,52,36,.22)';
    ctx.beginPath(); ctx.arc(n.x, n.y, 118 + k * 14, 0, Math.PI * 2); ctx.stroke();
  });
  ctx.restore();
}

function drawWaves(time){
  ctx.save();
  ctx.strokeStyle = 'rgba(60,84,92,.20)';
  ctx.lineWidth = 1;
  const rnd = mulberry32(3);
  for (let i = 0; i < 90; i++){
    const x = rnd() * W, y = rnd() * H;
    // nekresli vlnky přes ostrovy
    if (PORTS.some(p => Math.hypot(p.x - x, p.y - y) < 130)) continue;
    const ph = rnd() * 6.28;
    const w = 9 + rnd() * 7;
    const yy = y + Math.sin(time * 0.9 + ph) * 1.6;
    ctx.beginPath();
    ctx.moveTo(x - w, yy);
    ctx.quadraticCurveTo(x - w/2, yy - 3.2, x, yy);
    ctx.quadraticCurveTo(x + w/2, yy + 3.2, x + w, yy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSeaLanes(){
  ctx.save();
  ctx.setLineDash([2, 7]);
  ctx.strokeStyle = 'rgba(72,54,34,.24)';
  ctx.lineWidth = 0.9;
  for (let i = 0; i < PORTS.length; i++)
    for (let j = i + 1; j < PORTS.length; j++){
      ctx.beginPath();
      ctx.moveTo(PORTS[i].x, PORTS[i].y);
      ctx.lineTo(PORTS[j].x, PORTS[j].y);
      ctx.stroke();
    }
  ctx.restore();
}

function drawIsland(pts, i, time){
  const p = PORTS[i];
  ctx.save();

  // stín / mělčina
  ctx.save();
  ctx.strokeStyle = 'rgba(60,84,92,.22)';
  ctx.lineWidth = 1.1;
  for (let k = 1; k <= 3; k++){
    blob(pts, 1 + k * 0.055, p.x, p.y);
    ctx.stroke();
  }
  ctx.restore();

  // pevnina
  blob(pts, 1, p.x, p.y);
  const g = ctx.createRadialGradient(p.x - 20, p.y - 24, 6, p.x, p.y, 110);
  g.addColorStop(0, '#d9c08a');
  g.addColorStop(.6, '#c4a771');
  g.addColorStop(1, '#a9884f');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(48,32,16,.75)';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // vrstevnice + šrafura kopců
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(90,64,32,.30)';
  ctx.lineWidth = 0.8;
  blob(pts, 0.68, p.x, p.y); ctx.stroke();
  blob(pts, 0.42, p.x, p.y); ctx.stroke();
  const rnd = mulberry32(p.seed + 5);
  ctx.strokeStyle = 'rgba(80,56,28,.42)';
  for (let k = 0; k < 34; k++){
    const a = rnd() * 6.28, r = rnd() * 52;
    const x = p.x + Math.cos(a) * r * 1.1, y = p.y + Math.sin(a) * r * 0.8;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 3, y - 6); ctx.lineTo(x + 6, y);
    ctx.stroke();
  }
  ctx.restore();

  // kotviště
  const anyone = S.players.find(pl => pl.docked && pl.at === i);
  ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#2b1d10'; ctx.fill();
  ctx.beginPath(); ctx.arc(p.x, p.y, 10.5, 0, Math.PI * 2);
  ctx.strokeStyle = '#2b1d10'; ctx.lineWidth = 1.3; ctx.stroke();

  if (anyone){
    const pulse = (Math.sin(time * 2.2) + 1) / 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 15 + pulse * 9, 0, Math.PI * 2);
    ctx.strokeStyle = anyone.color;
    ctx.globalAlpha = 0.75 - pulse * 0.5;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawPortLabel(p, i, time){
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const x = p.x + p.lx, y = p.y + p.ly;

  const label = p.name.toUpperCase();
  ctx.font = '19px "IM Fell English SC", Georgia, serif';
  const w = ctx.measureText(label).width;

  // pergamenový štítek
  ctx.fillStyle = 'rgba(240,229,201,.86)';
  ctx.strokeStyle = 'rgba(72,54,34,.55)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.rect(x - w/2 - 12, y - 15, w + 24, 30);
  ctx.fill(); ctx.stroke();

  ctx.fillStyle = '#2b1d10';
  ctx.fillText(label, x, y + 1);

  // ceny: nejlevnější zdejší zboží (vodítko pro hráče)
  if (S.prices.length){
    let best = 0, rel = Infinity;
    GOODS.forEach((_, g) => {
      const r = S.prices[i][g] / anchorPrice(g, i);
      if (r < rel){ rel = r; best = g; }
    });
    ctx.font = '11px "Cutive Mono", monospace';
    ctx.fillStyle = 'rgba(122,52,36,.85)';
    ctx.fillText(`${GOODS[best].name.toLowerCase()} ${fmt(S.prices[i][best])} zl.`, x, y + 26);
  }
  ctx.restore();
}

function shipPos(pl){
  if (pl.docked) return { x: PORTS[pl.at].x, y: PORTS[pl.at].y, a: 0 };
  const a = PORTS[pl.from], b = PORTS[pl.to];
  return {
    x: a.x + (b.x - a.x) * pl.t,
    y: a.y + (b.y - a.y) * pl.t,
    a: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

function drawWakes(time){
  ctx.save();
  for (const pl of S.players){
    if (pl.docked) continue;
    const a = PORTS[pl.from], b = PORTS[pl.to];

    // celá trasa slabě
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -time * 12;
    ctx.strokeStyle = pl.color + '44';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

    // ujetá část výrazně
    const p = shipPos(pl);
    ctx.setLineDash([]);
    ctx.strokeStyle = pl.color;
    ctx.globalAlpha = .55;
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawShip(pl, time){
  const p = shipPos(pl);
  const bob = Math.sin(time * 2.1 + pl.bob);
  ctx.save();
  ctx.translate(p.x, p.y + bob * 1.3);
  ctx.rotate(pl.docked ? -0.06 : p.a + Math.PI / 2 + bob * 0.045);
  ctx.scale(1.45, 1.45);

  // stín na hladině
  ctx.save();
  ctx.globalAlpha = .16; ctx.fillStyle = '#1c2b2e';
  ctx.beginPath(); ctx.ellipse(2, 6, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // trup
  ctx.beginPath();
  ctx.moveTo(-11, 4);
  ctx.quadraticCurveTo(0, 15, 11, 4);
  ctx.quadraticCurveTo(6, 8, 0, 8.5);
  ctx.quadraticCurveTo(-6, 8, -11, 4);
  ctx.closePath();
  ctx.fillStyle = '#33210f';
  ctx.fill();

  // stěžeň
  ctx.strokeStyle = '#33210f'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, -18); ctx.stroke();

  // plachty
  ctx.fillStyle = pl.color;
  ctx.strokeStyle = 'rgba(28,18,8,.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-1.5, -16); ctx.quadraticCurveTo(-12, -6, -1.5, 2); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(1.5, -14); ctx.quadraticCurveTo(10, -5, 1.5, 1); ctx.closePath();
  ctx.globalAlpha = .8; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();

  // vlajka
  ctx.fillStyle = pl.color;
  ctx.beginPath();
  ctx.moveTo(0, -18); ctx.lineTo(9 + bob, -20.5); ctx.lineTo(0, -22.5); ctx.closePath();
  ctx.fill();

  ctx.restore();

  // jmenovka
  ctx.save();
  ctx.font = '12px "IM Fell English", Georgia, serif';
  ctx.textAlign = 'center';
  const t = pl.name.length > 14 ? pl.name.slice(0, 13) + '…' : pl.name;
  const w = ctx.measureText(t).width;
  ctx.fillStyle = 'rgba(240,229,201,.8)';
  ctx.fillRect(p.x - w/2 - 4, p.y - 52, w + 8, 15);
  ctx.strokeStyle = pl.color; ctx.lineWidth = 1;
  ctx.strokeRect(p.x - w/2 - 4, p.y - 52, w + 8, 15);
  ctx.fillStyle = '#2b1d10';
  ctx.fillText(t, p.x, p.y - 41);
  ctx.restore();
}

function drawCompass(time){
  const cx = 600, cy = 645, r = 50;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.sin(time * 0.35) * 0.012);

  ctx.strokeStyle = 'rgba(72,54,34,.6)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2); ctx.stroke();

  for (let i = 0; i < 32; i++){
    const a = i / 32 * Math.PI * 2;
    const l = i % 4 === 0 ? 9 : 4.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.lineTo(Math.cos(a) * (r - l), Math.sin(a) * (r - l));
    ctx.stroke();
  }

  // osmicípá růžice
  for (let i = 0; i < 8; i++){
    const a = i / 8 * Math.PI * 2 - Math.PI / 2;
    const len = i % 2 === 0 ? r * 0.74 : r * 0.46;
    const wdt = i % 2 === 0 ? 9 : 6;
    const ax = Math.cos(a), ay = Math.sin(a);
    const px = -ay, py = ax;
    ctx.beginPath();
    ctx.moveTo(ax * len, ay * len);
    ctx.lineTo(px * wdt, py * wdt);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = i === 0 ? '#a8321e' : 'rgba(43,29,16,.82)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(ax * len, ay * len);
    ctx.lineTo(-px * wdt, -py * wdt);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = i === 0 ? 'rgba(168,50,30,.45)' : 'rgba(43,29,16,.35)';
    ctx.fill();
  }

  ctx.fillStyle = '#2b1d10';
  ctx.font = '13px "IM Fell English SC", Georgia, serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('S', 0, -r - 11);
  ctx.fillText('J', 0,  r + 11);
  ctx.fillText('Z', -r - 11, 0);
  ctx.fillText('V',  r + 11, 0);
  ctx.restore();
}

function drawCartouche(){
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(43,29,16,.72)';
  ctx.font = '22px "IM Fell English SC", Georgia, serif';
  ctx.fillText('M A R E   M E R C A T O R V M', 600, 58);
  ctx.font = 'italic 13px "IM Fell English", Georgia, serif';
  ctx.fillStyle = 'rgba(122,52,36,.72)';
  ctx.fillText('❦   pět přístavů, jeden příliv   ❦', 600, 82);
  ctx.restore();
}

function drawScale(){
  ctx.save();
  ctx.translate(72, 682);
  ctx.strokeStyle = 'rgba(43,29,16,.7)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(160, 0); ctx.stroke();
  for (let i = 0; i <= 2; i++){
    const x = i * 80;
    ctx.beginPath(); ctx.moveTo(x, -4); ctx.lineTo(x, 4); ctx.stroke();
    if (i < 2){
      ctx.fillStyle = i % 2 ? 'rgba(43,29,16,.75)' : 'rgba(43,29,16,.25)';
      ctx.fillRect(x, -3, 80, 6);
    }
  }
  ctx.fillStyle = 'rgba(43,29,16,.7)';
  ctx.font = '11px "Cutive Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('0', -2, 18); ctx.fillText('2 dny plavby', 66, 18);
  ctx.restore();
}

function drawFrame(){
  ctx.save();
  // vinětace
  const g = ctx.createRadialGradient(W/2, H/2, H*0.3, W/2, H/2, H*0.95);
  g.addColorStop(0, 'rgba(60,40,20,0)');
  g.addColorStop(1, 'rgba(50,32,14,.34)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(43,29,16,.75)'; ctx.lineWidth = 2;
  ctx.strokeRect(14, 14, W - 28, H - 28);
  ctx.strokeStyle = 'rgba(43,29,16,.4)'; ctx.lineWidth = 1;
  ctx.strokeRect(21, 21, W - 42, H - 42);
  ctx.restore();
}

/* ─────────────────────────── START ────────────────────────── */

buildPlayerFields();
window.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !$('#setup').hidden) startGame();
});
