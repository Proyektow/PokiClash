import { CARD_DATABASE } from './cards.js';

const $ = sel => document.querySelector(sel);
const canvas = $('#arena');
const ctx = canvas.getContext('2d');
const bottomNav = $('#bottom-nav');
const ghost = $('#drag-ghost');

const W = 400, H = 660, MID = H / 2;
const laneXs = [116, 284];
const STORAGE_KEY = 'pokiclash.v2.names';
const TROPHIES_KEY = 'pokiclash.trophies.v1';
const defaultDeck = CARD_DATABASE.map(c => c.id);

let customNames = {};
try { customNames = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch {}

// SISTEMA DE TROFEOS PERSISTENTE (Comienza en 0)
let userTrophies = parseInt(localStorage.getItem(TROPHIES_KEY) || '0', 10);
if (isNaN(userTrophies) || userTrophies < 0) userTrophies = 0;

function updateTrophyDisplay() {
  $('#trophy-count').textContent = userTrophies;
  const leagueTag = $('#arena-league-tag');
  const leagueName = $('#arena-name-text');

  if (userTrophies < 100) {
    leagueTag.textContent = 'ARENA 1';
    leagueName.textContent = 'Estadio de Kanto';
  } else if (userTrophies < 300) {
    leagueTag.textContent = 'ARENA 2';
    leagueName.textContent = 'Valle Johto';
  } else {
    leagueTag.textContent = 'ARENA 3';
    leagueName.textContent = 'Cima Campeones';
  }
}

let scale = 1;
let frameId = 0;
let dragState = null;
let state = null;
let deferredPrompt = null;

// SINTETIZADOR DE AUDIO ARCADE
let audioCtx = null;
function playSound(type) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    if (type === 'spawn') {
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(480, now + 0.1);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'hit') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(160, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'boom') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(100, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.35);
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'win') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(392, now);
      osc.frequency.setValueAtTime(523, now + 0.12);
      osc.frequency.setValueAtTime(659, now + 0.24);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    }
  } catch {}
}

// CACHÉ DE IMÁGENES
const imageCache = new Map();
function getCachedImage(src) {
  if (!src) return null;
  if (imageCache.has(src)) return imageCache.get(src);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  imageCache.set(src, img);
  return img;
}

async function preloadAssets() {
  const progressBar = $('#splash-progress');
  const urls = [];
  CARD_DATABASE.forEach(c => {
    if (c.sprite) urls.push(c.sprite);
    if (c.staticIcon) urls.push(c.staticIcon);
  });

  let count = 0;
  for (const url of urls) {
    await new Promise(res => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { count++; res(); };
      img.onerror = () => { count++; res(); };
      img.src = url;
      imageCache.set(url, img);
      progressBar.style.width = Math.floor((count / urls.length) * 100) + '%';
    });
  }
  setTimeout(() => $('#splash-screen').classList.add('fade-out'), 300);
}

// GESTIÓN DE INSTALACIÓN PWA (Ocultar botón si ya está instalada)
const pwaBtn = $('#pwa-install-btn');
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

if (isStandalone) {
  pwaBtn.remove();
} else {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    pwaBtn.hidden = false;
    pwaBtn.onclick = async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') pwaBtn.style.display = 'none';
      deferredPrompt = null;
    };
  });

  window.addEventListener('appinstalled', () => {
    pwaBtn.style.display = 'none';
    deferredPrompt = null;
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// DIBUJO REALISTA DEL ESTADIO EN EL MENÚ (Preview de Kanto)
function renderStadiumPreview() {
  const pCanvas = $('#stadium-preview-canvas');
  if (!pCanvas) return;
  const pctx = pCanvas.getContext('2d');
  const pw = pCanvas.width;
  const ph = pCanvas.height;

  // Fondo gradas y público
  const bgGrad = pctx.createLinearGradient(0, 0, 0, ph);
  bgGrad.addColorStop(0, '#10221e');
  bgGrad.addColorStop(0.4, '#1b3831');
  bgGrad.addColorStop(1, '#2c594c');
  pctx.fillStyle = bgGrad;
  pctx.fillRect(0, 0, pw, ph);

  // Reflectores de estadio
  pctx.fillStyle = 'rgba(255, 255, 200, 0.15)';
  pctx.beginPath();
  pctx.moveTo(20, 0); pctx.lineTo(80, ph); pctx.lineTo(0, ph); pctx.fill();
  pctx.beginPath();
  pctx.moveTo(pw - 20, 0); pctx.lineTo(pw, ph); pctx.lineTo(pw - 80, ph); pctx.fill();

  // Césped del campo a rayas
  const grassTop = 45;
  const stripeH = (ph - grassTop) / 5;
  for (let i = 0; i < 5; i++) {
    pctx.fillStyle = i % 2 === 0 ? '#437a40' : '#4d8a4a';
    pctx.fillRect(20, grassTop + i * stripeH, pw - 40, stripeH);
  }

  // Río central
  pctx.fillStyle = '#22829e';
  pctx.fillRect(20, ph / 2 + 5, pw - 40, 16);
  pctx.fillStyle = 'rgba(255,255,255,0.4)';
  pctx.fillRect(20, ph / 2 + 10, pw - 40, 2);

  // Puentes de piedra
  [pw * 0.32, pw * 0.68].forEach(bx => {
    pctx.fillStyle = '#7f8c8d';
    pctx.fillRect(bx - 14, ph / 2 - 2, 28, 30);
    pctx.fillStyle = '#bdc3c7';
    pctx.fillRect(bx - 11, ph / 2, 22, 26);
  });

  // Torres miniatura
  pctx.fillStyle = '#c0392b';
  pctx.fillRect(pw * 0.5 - 12, grassTop + 4, 24, 18);
  pctx.fillStyle = '#2980b9';
  pctx.fillRect(pw * 0.5 - 12, ph - 26, 24, 18);
}

// PESTAÑAS
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view-tab').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    $(`#${btn.dataset.target}`).classList.add('active');
  });
});

function cardById(id) { return CARD_DATABASE.find(c => c.id === id); }
function displayName(card) { return customNames[card.id] || card.name; }

function renderManager() {
  $('#manager-grid').innerHTML = CARD_DATABASE.map(c => `
    <div class="manager-card">
      <img class="manager-thumb" src="${c.staticIcon || c.sprite}" alt="${c.name}">
      <div class="manager-info">
        <input maxlength="18" data-name-id="${c.id}" value="${displayName(c)}">
        <div class="manager-meta">
          <span>💧 ${c.costElixir}</span>
          <span>❤️ ${c.hp}</span>
        </div>
      </div>
    </div>
  `).join('');
}

$('#manager-grid').addEventListener('input', e => {
  const input = e.target.closest('[data-name-id]');
  if (!input) return;
  customNames[input.dataset.nameId] = input.value.trim() || cardById(input.dataset.nameId).name;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customNames));
});

// ESTRUCTURA DE TORRE MEJORADA (Con ángulo de cañón y animación)
function createTower(team, kind, x, y, lane = null) {
  const king = kind === 'king';
  return {
    id: `${team}-${kind}-${lane}`, team, kind, lane, x, y,
    hp: king ? 3800 : 2200, maxHp: king ? 3800 : 2200,
    damage: king ? 82 : 65, attackSpeed: king ? 0.95 : 0.8,
    range: king ? 175 : 145, radius: king ? 26 : 21,
    awake: !king, cooldown: 0.3, isBuilding: true,
    cannonAngle: team === 'blue' ? -Math.PI / 2 : Math.PI / 2,
    target: null
  };
}

// INICIAR BATALLA
$('#btn-start-battle').addEventListener('click', startBattle);
$('#btn-surrender').addEventListener('click', () => endMatch('red'));
$('#modal-ok-btn').addEventListener('click', closeMatchModal);

function startBattle() {
  playSound('spawn');
  document.querySelectorAll('.view-tab').forEach(v => v.classList.remove('active'));
  $('#view-arena-live').classList.add('active');
  bottomNav.classList.add('nav-hidden');

  const deck = [...defaultDeck];
  state = {
    running: true, ended: false, phase: 'battle', time: 180, overtime: 60,
    energy: 5, enemyEnergy: 5,
    hand: deck.slice(0, 4), nextIndex: 4, aiHand: deck.slice(0, 4), aiNextIndex: 4,
    units: [], towers: [], blasts: [], projectiles: [], selected: null,
    aiClock: 2.0, lastPlayerTank: null, matchTimeElapsed: 0
  };

  state.towers.push(
    createTower('red', 'king', W / 2, 65),
    createTower('red', 'princess', laneXs[0], 175, 0),
    createTower('red', 'princess', laneXs[1], 175, 1),
    createTower('blue', 'king', W / 2, H - 65),
    createTower('blue', 'princess', laneXs[0], H - 175, 0),
    createTower('blue', 'princess', laneXs[1], H - 175, 1)
  );

  $('#modal-result').hidden = true;
  $('#hint').classList.remove('hidden');
  $('#alert-banner').hidden = true;
  updateHand();
  updateHUD();
  resizeCanvas();

  if (frameId) cancelAnimationFrame(frameId);
  state.lastFrame = performance.now();
  frameId = requestAnimationFrame(frame);
}

function closeMatchModal() {
  $('#modal-result').hidden = true;
  document.querySelectorAll('.view-tab').forEach(v => v.classList.remove('active'));
  $('#view-battle').classList.add('active');
  bottomNav.classList.remove('nav-hidden');
  updateTrophyDisplay();
  renderManager();
}

function updateHand() {
  if (!state) return;
  $('#cards-rack').innerHTML = state.hand.map(id => {
    const c = cardById(id);
    const sel = state.selected === id ? ' selected' : '';
    const dis = (state.energy < c.costElixir || state.ended) ? ' disabled' : '';
    return `
      <button class="card-btn${sel}" type="button" data-card-id="${id}" ${dis}>
        <span class="bubble-cost">${c.costElixir}</span>
        <img class="card-btn-img" src="${c.staticIcon || c.sprite}" alt="${displayName(c)}">
        <span class="card-btn-name">${displayName(c)}</span>
      </button>
    `;
  }).join('');

  const next = cardById(defaultDeck[state.nextIndex % defaultDeck.length]);
  $('#next-img').src = next.staticIcon || next.sprite;
  $('#next-cost').textContent = next.costElixir;

  $('#cards-rack').querySelectorAll('.card-btn').forEach(btn => {
    const id = btn.dataset.cardId;
    btn.addEventListener('pointerdown', e => beginDrag(e, btn, id));
    btn.addEventListener('click', e => { if (e.detail === 0) toggleSelectCard(id); });
  });
}

function toggleSelectCard(id) {
  if (!state || state.ended || state.energy < cardById(id).costElixir) return;
  state.selected = state.selected === id ? null : id;
  updateHand();
}

function beginDrag(e, btn, id) {
  if (!state || state.ended || state.energy < cardById(id).costElixir) return;
  e.preventDefault();
  state.selected = id;
  dragState = { id, startX: e.clientX, startY: e.clientY, moved: false };
  btn.setPointerCapture(e.pointerId);

  const card = cardById(id);
  ghost.innerHTML = `<img src="${card.staticIcon || card.sprite}">`;
  ghost.classList.add('visible');
  ghost.style.left = `${e.clientX}px`;
  ghost.style.top = `${e.clientY}px`;

  btn.addEventListener('pointermove', onDragMove);
  btn.addEventListener('pointerup', onDragEnd, { once: true });
  btn.addEventListener('pointercancel', () => { dragState = null; ghost.classList.remove('visible'); }, { once: true });
}

function onDragMove(e) {
  if (!dragState) return;
  if (!dragState.moved && Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY) > 6) {
    dragState.moved = true;
  }
  ghost.style.left = `${e.clientX}px`;
  ghost.style.top = `${e.clientY}px`;
}

function onDragEnd(e) {
  if (!dragState) return;
  const rect = canvas.getBoundingClientRect();
  const overArena = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
  const id = dragState.id;
  const moved = dragState.moved;
  dragState = null;
  ghost.classList.remove('visible');

  if (moved && overArena) {
    deployAt(id, e.clientX, e.clientY);
  } else {
    state.selected = id;
    updateHand();
  }
}

canvas.addEventListener('pointerdown', e => {
  if (!state || !state.selected || state.ended) return;
  deployAt(state.selected, e.clientX, e.clientY);
});

function deploymentBoundary() {
  const redPrincessDown = state.towers.filter(t => t.team === 'red' && t.kind === 'princess' && t.hp <= 0).length;
  return Math.max(MID - 85, MID + 15 - redPrincessDown * 55);
}

function deployAt(id, clientX, clientY, team = 'blue', forcedLane = null, forcedY = null, targetPt = null) {
  if (!state || state.ended) return false;
  const card = cardById(id);
  const hand = team === 'blue' ? state.hand : state.aiHand;
  const energyKey = team === 'blue' ? 'energy' : 'enemyEnergy';

  if (!hand.includes(id) || state[energyKey] < card.costElixir) return false;

  let pt;
  if (targetPt) pt = targetPt;
  else if (forcedLane !== null) pt = { x: laneXs[forcedLane], y: forcedY };
  else {
    const rect = canvas.getBoundingClientRect();
    pt = { x: (clientX - rect.left) / rect.width * W, y: (clientY - rect.top) / rect.height * H };
  }

  const lane = forcedLane ?? (pt.x < W / 2 ? 0 : 1);
  if (card.id !== 'bola-ignea') {
    if (team === 'blue' && pt.y < deploymentBoundary()) return false;
    if (team === 'red' && pt.y > MID - 15) return false;
  }

  state[energyKey] -= card.costElixir;
  playSound('spawn');

  if (card.id === 'bola-ignea') {
    state.projectiles.push({
      x: team === 'blue' ? W / 2 : W / 2,
      y: team === 'blue' ? H - 70 : 70,
      targetX: pt.x, targetY: pt.y, speed: 440,
      team, damage: card.damage, radius: card.radius,
      towerDamageFactor: card.towerDamageFactor
    });
  } else {
    spawnTroops(card, team, lane, pt.y);
  }

  const pos = hand.indexOf(id);
  if (pos >= 0) {
    const idxKey = team === 'blue' ? 'nextIndex' : 'aiNextIndex';
    hand.splice(pos, 1);
    hand.push(defaultDeck[state[idxKey] % defaultDeck.length]);
    state[idxKey]++;
  }

  if (team === 'blue') {
    state.selected = null;
    $('#hint').classList.add('hidden');
    if (card.id === 'snor-tanque') state.lastPlayerTank = { lane, time: performance.now() / 1000 };
  }

  updateHand();
  updateHUD();
  return true;
}

function spawnTroops(card, team, lane, y) {
  const x = laneXs[lane];
  if (card.isBuilding) {
    state.units.push({
      id: Math.random(), card, team, lane, x, y, hp: card.hp, maxHp: card.hp,
      cooldown: 0.2, age: 0, size: 20, isBuilding: true, walkCycle: 0
    });
    return;
  }
  const count = card.count || 1;
  for (let i = 0; i < count; i++) {
    const ox = count > 1 ? ((i % 3) - 1) * 14 : (Math.random() - 0.5) * 8;
    const oy = count > 1 ? (Math.floor(i / 3) - 1) * 12 : (Math.random() - 0.5) * 8;
    state.units.push({
      id: Math.random(), card, team, lane, x: x + ox, y: y + oy,
      hp: card.hp, maxHp: card.hp, cooldown: Math.random() * 0.2,
      size: count > 1 ? 10 : (card.isFlying ? 19 : 16),
      isBuilding: false, isFlying: Boolean(card.isFlying),
      swarmIndex: i, swarmCount: count,
      walkCycle: Math.random() * Math.PI * 2,
      facingX: 0, facingY: team === 'blue' ? -1 : 1
    });
  }
}

function updateGame(dt, nowSec) {
  if (!state || !state.running || state.ended) return;

  state.matchTimeElapsed += dt;
  state.time -= dt;

  if (state.phase === 'battle' && state.time <= 60) {
    $('#alert-banner').hidden = false;
  }
  if (state.phase === 'battle' && state.time <= 0) {
    const scores = countCrowns();
    if (scores.blue !== scores.red) { endMatch(scores.blue > scores.red ? 'blue' : 'red'); return; }
    state.phase = 'overtime';
    state.time = state.overtime;
  } else if (state.phase === 'overtime' && state.time <= 0) {
    endMatch('draw');
    return;
  }

  const isDouble = state.phase === 'overtime' || (state.phase === 'battle' && state.time <= 60);
  const regen = (1 / 2.8) * (isDouble ? 2 : 1);
  state.energy = Math.min(10, state.energy + regen * dt);
  state.enemyEnergy = Math.min(10, state.enemyEnergy + regen * dt);

  updateAI(dt, nowSec);
  updateUnits(dt);
  updateProjectiles(dt);
  updateTowers(dt);

  state.blasts.forEach(b => b.life -= dt);
  state.blasts = state.blasts.filter(b => b.life > 0);

  if (state.towers.some(t => t.team === 'red' && t.kind === 'king' && t.hp <= 0)) { endMatch('blue'); return; }
  if (state.towers.some(t => t.team === 'blue' && t.kind === 'king' && t.hp <= 0)) { endMatch('red'); return; }

  updateHUD();
}

function updateProjectiles(dt) {
  for (const p of state.projectiles) {
    const dx = p.targetX - p.x;
    const dy = p.targetY - p.y;
    const dist = Math.hypot(dx, dy);
    const step = p.speed * dt;

    if (dist <= step) {
      p.x = p.targetX;
      p.y = p.targetY;
      const enemy = p.team === 'blue' ? 'red' : 'blue';

      playSound('boom');
      state.units.filter(u => u.team === enemy && Math.hypot(u.x - p.x, u.y - p.y) <= p.radius + u.size)
        .forEach(u => damageUnit(u, p.damage));

      state.towers.filter(t => t.team === enemy && Math.hypot(t.x - p.x, t.y - p.y) <= p.radius + t.radius)
        .forEach(t => damageTower(t, p.damage * p.towerDamageFactor));

      state.blasts.push({ x: p.x, y: p.y, radius: p.radius, color: '#ff5722', life: 0.45, maxLife: 0.45 });
      p.done = true;
    } else {
      p.x += (dx / dist) * step;
      p.y += (dy / dist) * step;
    }
  }
  state.projectiles = state.projectiles.filter(p => !p.done);
}

function updateUnits(dt) {
  for (const u of state.units) {
    if (u.hp <= 0) continue;
    u.cooldown -= dt;

    if (u.isBuilding) {
      u.age += dt;
      if (u.age >= u.card.lifetime) { u.hp = 0; continue; }
      if (u.cooldown <= 0) {
        const target = findTarget(u);
        if (target) { attack(u, target); u.cooldown = u.card.attackSpeed; }
      }
      continue;
    }

    const enemy = findTarget(u) || findTowerTarget(u);
    if (!enemy) continue;

    const dx = enemy.x - u.x, dy = enemy.y - u.y;
    const dist = Math.hypot(dx, dy);
    const reach = enemy.kind ? u.card.range + enemy.radius * 0.7 : u.card.range;

    if (dist <= reach) {
      if (u.cooldown <= 0) { attack(u, enemy); u.cooldown = u.card.attackSpeed; }
    } else {
      const step = Math.min(u.card.speed * dt, dist - reach + 1);
      const moveX = (dx / dist) * step;
      const moveY = (dy / dist) * step;
      u.x += moveX;
      u.y += moveY;
      u.facingX = dx / dist;
      u.facingY = dy / dist;
      // Incrementa ciclo de paso si camina
      u.walkCycle += dt * (u.card.speed * 0.15);
    }
  }

  for (let i = 0; i < state.units.length; i++) {
    for (let j = i + 1; j < state.units.length; j++) {
      const a = state.units[i], b = state.units[j];
      if (a.isBuilding || b.isBuilding || a.lane !== b.lane) continue;
      let dx = b.x - a.x, dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      const minD = a.size + b.size;
      if (dist < minD && dist > 0) {
        const push = (minD - dist) * 0.2;
        a.x -= (dx / dist) * push; b.x += (dx / dist) * push;
      }
    }
  }

  state.units = state.units.filter(u => u.hp > 0);
}

function findTarget(unit) {
  const enemyTeam = unit.team === 'blue' ? 'red' : 'blue';
  return state.units
    .filter(u => u.team === enemyTeam && u.hp > 0 && canAttack(unit.card, u) && Math.hypot(u.x - unit.x, u.y - unit.y) <= (unit.card.range + 35))
    .sort((a, b) => Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y))[0] || null;
}

function findTowerTarget(unit) {
  const enemyTeam = unit.team === 'blue' ? 'red' : 'blue';
  const laneTower = state.towers.find(t => t.team === enemyTeam && t.kind === 'princess' && t.lane === unit.lane && t.hp > 0);
  if (laneTower) return laneTower;
  return state.towers.find(t => t.team === enemyTeam && t.kind === 'king' && t.hp > 0) || null;
}

function canAttack(attackerCard, defender) {
  if (attackerCard.targetType === 'buildings_only') return Boolean(defender.isBuilding || defender.kind);
  if (defender.isFlying) return Boolean(attackerCard.canTargetAir);
  return true;
}

function attack(attacker, target) {
  const dmg = attacker.card.damage;
  playSound('hit');
  if (target.kind) {
    damageTower(target, dmg);
  } else if (attacker.card.isAoE) {
    const rad = attacker.card.splashRadius || 48;
    state.units.filter(u => u.team !== attacker.team && Math.hypot(u.x - target.x, u.y - target.y) <= rad)
      .forEach(u => damageUnit(u, dmg));
    state.blasts.push({ x: target.x, y: target.y, radius: rad, color: attacker.card.color, life: 0.25, maxLife: 0.25 });
  } else {
    damageUnit(target, dmg);
  }
}

function damageUnit(unit, amount) { unit.hp = Math.max(0, unit.hp - amount); }
function damageTower(tower, amount) {
  if (tower.hp <= 0) return;
  tower.awake = true;
  tower.hp = Math.max(0, tower.hp - amount);
  if (tower.hp <= 0 && state.phase === 'overtime') endMatch(tower.team === 'red' ? 'blue' : 'red');
}

function updateTowers(dt) {
  for (const t of state.towers) {
    if (t.hp <= 0 || !t.awake) continue;
    t.cooldown -= dt;

    const enemy = t.team === 'blue' ? 'red' : 'blue';
    const target = state.units.filter(u => u.team === enemy && u.hp > 0 && Math.hypot(u.x - t.x, u.y - t.y) <= t.range)
      .sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y))[0];

    t.target = target;
    if (target) {
      // Rotar cañón hacia la unidad
      t.cannonAngle = Math.atan2(target.y - t.y, target.x - t.x);
      if (t.cooldown <= 0) {
        playSound('hit');
        damageUnit(target, t.damage);
        state.blasts.push({ x: target.x, y: target.y, radius: 8, color: '#f1c40f', life: 0.15, maxLife: 0.15, particle: true });
        t.cooldown = t.attackSpeed;
      }
    }
  }
}

function updateAI(dt, nowSec) {
  state.aiClock -= dt;
  if (state.aiClock > 0 || state.ended) return;
  state.aiClock = 1.4 + Math.random() * 1.0;

  const affordable = state.aiHand.map(cardById).filter(c => c && c.costElixir <= state.enemyEnergy);
  if (!affordable.length) return;

  if (state.lastPlayerTank && (nowSec - state.lastPlayerTank.time) < 6) {
    const counter = affordable.find(c => c.id === 'gengar-horda' || c.id === 'scizor-guerrero');
    if (counter) {
      deployAt(counter.id, 0, 0, 'red', state.lastPlayerTank.lane, MID - 50);
      state.lastPlayerTank = null;
      return;
    }
  }

  const chosen = affordable[Math.floor(Math.random() * affordable.length)];
  const lane = Math.random() < 0.5 ? 0 : 1;
  deployAt(chosen.id, 0, 0, 'red', lane, chosen.isBuilding ? 150 : MID - 60);
}

function countCrowns() {
  const crowns = team => {
    const kingDown = state.towers.some(t => t.team === team && t.kind === 'king' && t.hp <= 0);
    if (kingDown) return 3;
    return state.towers.filter(t => t.team === team && t.kind === 'princess' && t.hp <= 0).length;
  };
  return { blue: crowns('red'), red: crowns('blue') };
}

// FIN DE PARTIDA CON PROGRESIÓN DE TROFEOS
function endMatch(winner) {
  if (state.ended) return;
  state.ended = true;
  state.running = false;
  if (frameId) cancelAnimationFrame(frameId);

  const crowns = countCrowns();
  const isWin = winner === 'blue';
  const isDraw = winner === 'draw';

  let trophyDelta = 0;
  if (isWin) {
    trophyDelta = 30;
    userTrophies += trophyDelta;
  } else if (!isDraw) {
    trophyDelta = -20;
    userTrophies = Math.max(0, userTrophies + trophyDelta);
  }

  localStorage.setItem(TROPHIES_KEY, userTrophies.toString());

  const deltaEl = $('#trophy-delta-value');
  if (trophyDelta > 0) {
    deltaEl.textContent = `+${trophyDelta}`;
    deltaEl.className = 'delta-plus';
  } else if (trophyDelta < 0) {
    deltaEl.textContent = `${trophyDelta}`;
    deltaEl.className = 'delta-minus';
  } else {
    deltaEl.textContent = '0';
    deltaEl.className = '';
  }

  playSound(isWin ? 'win' : 'boom');
  $('#result-headline').textContent = isWin ? '¡VICTORIA!' : (isDraw ? '¡EMPATE!' : 'DERROTA');
  $('#result-headline').style.color = isWin ? '#2ecc71' : (isDraw ? '#f1c40f' : '#e74c3c');
  $('#result-icon').textContent = isWin ? '♛' : '☠';
  $('#result-detail').textContent = `Coronas conseguidas: ${crowns.blue} vs ${crowns.red}`;
  $('#modal-result').hidden = false;
}

function updateHUD() {
  if (!state) return;
  const sec = Math.max(0, Math.ceil(state.time));
  $('#timer-text').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  $('#phase-tag').textContent = state.phase === 'overtime' ? 'MUERTE SÚBITA' : 'BATALLA';

  $('#elixir-val').textContent = Math.floor(state.energy);
  $('#elixir-fill').style.width = `${(state.energy / 10) * 100}%`;

  const crowns = countCrowns();
  $('#blue-crowns').textContent = crowns.blue;
  $('#red-crowns').textContent = crowns.red;

  $('#cards-rack').querySelectorAll('.card-btn').forEach(btn => {
    const card = cardById(btn.dataset.cardId);
    btn.disabled = (state.energy < card.costElixir || state.ended);
  });
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = (rect.width * (H / W)) * dpr;
  scale = canvas.width / W;
}
window.addEventListener('resize', resizeCanvas);

// DIBUJO REALISTA DE LA ARENA, TORRES 3D Y ANIMACIÓN DE PASO
function drawArena() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Césped con franjas cortadas alternas
  const stripes = 12;
  const sh = H / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#43793e' : '#4a8545';
    ctx.fillRect(0, i * sh, W, sh);
  }

  // Río con orillas de arena
  ctx.fillStyle = '#b38f58'; // Borde arena
  ctx.fillRect(0, MID - 27, W, 54);
  ctx.fillStyle = '#1c7896'; // Agua profunda
  ctx.fillRect(0, MID - 23, W, 46);

  // Ondas y corrientes animadas
  const tTime = state ? state.matchTimeElapsed : 0;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  for (let i = 0; i < 4; i++) {
    const wx = ((tTime * 40 + i * 110) % (W + 60)) - 30;
    ctx.fillRect(wx, MID - 12 + (i % 2) * 14, 38, 3);
  }

  // Puentes de piedra tallada
  laneXs.forEach(x => {
    // Sombra del puente
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x - 32, MID - 28, 64, 60);
    // Base de piedra
    ctx.fillStyle = '#7f8c8d';
    ctx.fillRect(x - 28, MID - 26, 56, 52);
    // Tablones / Losas de puente
    for (let py = MID - 22; py <= MID + 20; py += 8) {
      ctx.fillStyle = '#95a5a6';
      ctx.fillRect(x - 26, py, 52, 6);
      ctx.fillStyle = '#616a6b';
      ctx.fillRect(x - 26, py + 5, 52, 1);
    }
    // Barandillas laterales
    ctx.fillStyle = '#34495e';
    ctx.fillRect(x - 28, MID - 26, 4, 52);
    ctx.fillRect(x + 24, MID - 26, 4, 52);
  });

  // Línea límite de despliegue
  const bLine = deploymentBoundary();
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, bLine);
  ctx.lineTo(W, bLine);
  ctx.stroke();
  ctx.restore();

  // Dibujar Torres 3D con cañones
  state.towers.forEach(drawRealisticTower);

  // Proyectiles
  state.projectiles.forEach(p => {
    ctx.save();
    ctx.fillStyle = '#e67e22';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f1c40f';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // Dibujar Unidades con animación de caminata
  state.units.sort((a, b) => a.y - b.y).forEach(drawAnimatedUnit);

  // Efectos de explosión
  state.blasts.forEach(b => {
    ctx.save();
    ctx.globalAlpha = b.life / b.maxLife;
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

// TORRE EN PSEUDO-3D CON ALMENAS Y CAÑÓN ROTATIVO
function drawRealisticTower(t) {
  const isBlue = t.team === 'blue';
  const isKing = t.kind === 'king';

  if (t.hp <= 0) {
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.radius * 0.9, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Sombra proyectada en el suelo
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(t.x + 3, t.y + 6, t.radius * 1.15, t.radius * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Base circular de mampostería
  ctx.fillStyle = '#566573';
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.radius + 3, 0, Math.PI * 2);
  ctx.fill();

  // Cuerpo cilíndrico de piedra con textura de sillares
  const towerGrad = ctx.createLinearGradient(t.x - t.radius, t.y, t.x + t.radius, t.y);
  if (isBlue) {
    towerGrad.addColorStop(0, '#1f618d');
    towerGrad.addColorStop(0.5, '#2980b9');
    towerGrad.addColorStop(1, '#154360');
  } else {
    towerGrad.addColorStop(0, '#922b21');
    towerGrad.addColorStop(0.5, '#c0392b');
    towerGrad.addColorStop(1, '#641e16');
  }
  ctx.fillStyle = towerGrad;
  ctx.beginPath();
  ctx.arc(t.x, t.y - 4, t.radius, 0, Math.PI * 2);
  ctx.fill();

  // Cañón rotativo articulado que apunta a su objetivo
  ctx.save();
  ctx.translate(t.x, t.y - 6);
  ctx.rotate(t.cannonAngle);
  ctx.fillStyle = '#2c3e50';
  ctx.fillRect(0, -3.5, t.radius * 0.9, 7);
  ctx.fillStyle = '#f1c40f';
  ctx.fillRect(t.radius * 0.75, -4, 4, 8);
  ctx.restore();

  // Corona del Rey o Almena superior
  if (isKing) {
    ctx.fillStyle = '#f1c40f';
    ctx.font = '900 17px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.awake ? '♛' : '💤', t.x, t.y - 7);
  } else {
    ctx.fillStyle = '#ecf0f1';
    ctx.beginPath();
    ctx.arc(t.x, t.y - 6, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Barra de salud superior
  const bw = isKing ? 48 : 34;
  const bx = t.x - bw / 2;
  const by = t.y - t.radius - 16;
  ctx.fillStyle = '#000';
  ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
  ctx.fillStyle = isBlue ? '#2ecc71' : '#e74c3c';
  ctx.fillRect(bx, by, bw * Math.max(0, t.hp / t.maxHp), 4);
}

// PERSONAJES CON ANIMACIÓN DE ANDAR Y FLOTAR
function drawAnimatedUnit(u) {
  const img = getCachedImage(u.card.sprite || u.card.staticIcon);
  const sz = u.size * 2.3;

  // Animación procedural de paso
  let walkBounceY = 0;
  let walkTilt = 0;

  if (u.isFlying) {
    // Aleteo sinusoidal flotante
    walkBounceY = Math.sin(state.matchTimeElapsed * 5) * 5 - 12;
  } else if (!u.isBuilding) {
    // Bamboleo de caminata natural (rebote vertical e inclinación)
    walkBounceY = -Math.abs(Math.sin(u.walkCycle)) * 3.5;
    walkTilt = Math.sin(u.walkCycle) * 0.12;
  }

  // Sombra proyectada (permanece en el suelo independientemente del vuelo)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.beginPath();
  const shadowScale = u.isFlying ? 0.75 : 1.0;
  ctx.ellipse(u.x, u.y + 4, (u.size * 0.9) * shadowScale, (u.size * 0.45) * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(u.x, u.y + walkBounceY);
  ctx.rotate(walkTilt);

  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
  } else {
    // Render de figura con sombra si no hay imagen
    ctx.fillStyle = u.card.color;
    ctx.beginPath();
    ctx.arc(0, 0, u.size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // Barra de salud
  const bw = u.swarmCount > 1 ? 14 : 26;
  const bx = u.x - bw / 2;
  const by = u.y + walkBounceY - sz / 2 - 6;
  ctx.fillStyle = '#000';
  ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
  ctx.fillStyle = u.team === 'blue' ? '#2ecc71' : '#e74c3c';
  ctx.fillRect(bx, by, bw * Math.max(0, u.hp / u.maxHp), 3);

  // Nombre de tropa principal
  if (u.swarmIndex === 0 || !u.swarmCount) {
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeText(displayName(u.card), u.x, by - 2);
    ctx.fillText(displayName(u.card), u.x, by - 2);
  }
}

function frame(now) {
  if (!state || !state.running) return;
  const dt = Math.min((now - state.lastFrame) / 1000, 0.05);
  state.lastFrame = now;
  updateGame(dt, now / 1000);
  drawArena();
  frameId = requestAnimationFrame(frame);
}

// ARRANQUE
preloadAssets();
updateTrophyDisplay();
renderStadiumPreview();
renderManager();
