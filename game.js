import { CARD_DATABASE } from './cards.js';

const $ = sel => document.querySelector(sel);
const canvas = $('#arena');
const ctx = canvas.getContext('2d');
const bottomNav = $('#bottom-nav');
const ghost = $('#drag-ghost');

const W = 400, H = 660, MID = H / 2;
const laneXs = [116, 284];
const STORAGE_KEY = 'pokiclash.v2.names';
const defaultDeck = CARD_DATABASE.map(c => c.id);

let customNames = {};
try { customNames = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch {}

let scale = 1;
let frameId = 0;
let dragState = null;
let state = null;
let deferredPrompt = null;

// SINTETIZADOR DE SONIDO ARCADE (Web Audio API)
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
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.1);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'hit') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(150, now);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'boom') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(90, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.3);
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
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

// CACHÉ DE SPRITES
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

// NAVEGACIÓN ENTRE PESTAÑAS (BATALLA / MAZO)
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

// GESTOR DE MAZO
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

// INSTALADOR PWA
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = $('#pwa-install-btn');
  btn.hidden = false;
  btn.onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') btn.hidden = true;
    deferredPrompt = null;
  };
});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// ARQUITECTURA DE TORRES
function createTower(team, kind, x, y, lane = null) {
  const king = kind === 'king';
  return {
    id: `${team}-${kind}-${lane}`, team, kind, lane, x, y,
    hp: king ? 3800 : 2200, maxHp: king ? 3800 : 2200,
    damage: king ? 80 : 65, attackSpeed: king ? 0.95 : 0.8,
    range: king ? 175 : 145, radius: king ? 24 : 20,
    awake: !king, cooldown: 0.3, isBuilding: true
  };
}

// INICIO DE PARTIDA
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
    aiClock: 2.0, lastPlayerTank: null
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

  // Rotar mano
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
      cooldown: 0.2, age: 0, size: 20, isBuilding: true
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
      size: count > 1 ? 9 : (card.isFlying ? 18 : 15),
      isBuilding: false, isFlying: Boolean(card.isFlying),
      swarmIndex: i, swarmCount: count
    });
  }
}

function updateGame(dt, nowSec) {
  if (!state || !state.running || state.ended) return;

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
      u.x += (dx / dist) * step;
      u.y += (dy / dist) * step;
    }
  }

  // Separación suave entre tropas
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
    if (t.cooldown > 0) continue;

    const enemy = t.team === 'blue' ? 'red' : 'blue';
    const target = state.units.filter(u => u.team === enemy && u.hp > 0 && Math.hypot(u.x - t.x, u.y - t.y) <= t.range)
      .sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y))[0];

    if (target) {
      playSound('hit');
      damageUnit(target, t.damage);
      state.blasts.push({ x: target.x, y: target.y, radius: 8, color: '#f1c40f', life: 0.15, maxLife: 0.15, particle: true });
      t.cooldown = t.attackSpeed;
    }
  }
}

function updateAI(dt, nowSec) {
  state.aiClock -= dt;
  if (state.aiClock > 0 || state.ended) return;
  state.aiClock = 1.4 + Math.random() * 1.0;

  const affordable = state.aiHand.map(cardById).filter(c => c && c.costElixir <= state.enemyEnergy);
  if (!affordable.length) return;

  // Si detecta un tanque rival, despliega horda de respuesta
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

// FIN DE PARTIDA DESVINCULADO DE BUGS
function endMatch(winner) {
  if (state.ended) return;
  state.ended = true;
  state.running = false;
  if (frameId) cancelAnimationFrame(frameId);

  const crowns = countCrowns();
  const isWin = winner === 'blue';

  playSound(isWin ? 'win' : 'boom');
  $('#result-headline').textContent = isWin ? '¡VICTORIA!' : (winner === 'draw' ? '¡EMPATE!' : 'DERROTA');
  $('#result-headline').style.color = isWin ? '#2ecc71' : (winner === 'draw' ? '#f1c40f' : '#e74c3c');
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

// RENDER DE ARENA
function drawArena() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Césped
  const grass = ctx.createLinearGradient(0, 0, 0, H);
  grass.addColorStop(0, '#3f6738');
  grass.addColorStop(0.5, '#4c7b44');
  grass.addColorStop(1, '#385c31');
  ctx.fillStyle = grass;
  ctx.fillRect(0, 0, W, H);

  // Río
  ctx.fillStyle = '#1c7896';
  ctx.fillRect(0, MID - 24, W, 48);
  ctx.fillStyle = '#2ab0da';
  ctx.fillRect(0, MID - 3, W, 6);

  // Puentes
  laneXs.forEach(x => {
    ctx.fillStyle = '#42281e';
    ctx.fillRect(x - 30, MID - 28, 60, 56);
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(x - 26, MID - 24, 52, 48);
  });

  // Línea de despliegue
  const bLine = deploymentBoundary();
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, bLine);
  ctx.lineTo(W, bLine);
  ctx.stroke();
  ctx.restore();

  // Torres
  state.towers.forEach(drawTower);

  // Proyectiles
  state.projectiles.forEach(p => {
    ctx.fillStyle = '#ff6b35';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    ctx.fill();
  });

  // Unidades
  state.units.sort((a, b) => a.y - b.y).forEach(drawUnit);

  // Explosiones
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

function drawTower(t) {
  const isBlue = t.team === 'blue';
  const isKing = t.kind === 'king';

  if (t.hp <= 0) {
    ctx.fillStyle = '#37474f';
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.radius * 0.8, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Base y Torre
  ctx.fillStyle = '#7f8c8d';
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.radius + 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = isBlue ? '#2980b9' : '#c0392b';
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f1c40f';
  ctx.font = `900 ${isKing ? 18 : 13}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isKing ? (t.awake ? '♛' : '💤') : '✦', t.x, t.y - 2);

  // Barra de Vida
  const bw = isKing ? 46 : 34;
  const bx = t.x - bw / 2;
  const by = t.y - t.radius - 14;
  ctx.fillStyle = '#000';
  ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
  ctx.fillStyle = isBlue ? '#2ecc71' : '#e74c3c';
  ctx.fillRect(bx, by, bw * Math.max(0, t.hp / t.maxHp), 4);
}

function drawUnit(u) {
  const img = getCachedImage(u.card.sprite || u.card.staticIcon);
  const sz = u.size * 2.2;

  // Sombra
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.ellipse(u.x, u.y + (u.isFlying ? 14 : 4), u.size * 0.9, u.size * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, u.x - sz / 2, u.y - sz / 2 - (u.isFlying ? 10 : 0), sz, sz);
  } else {
    ctx.fillStyle = u.card.color;
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.size, 0, Math.PI * 2);
    ctx.fill();
  }

  // Barra de salud
  const bw = u.swarmCount > 1 ? 14 : 26;
  const bx = u.x - bw / 2;
  const by = u.y - sz / 2 - 8 - (u.isFlying ? 10 : 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
  ctx.fillStyle = u.team === 'blue' ? '#2ecc71' : '#e74c3c';
  ctx.fillRect(bx, by, bw * Math.max(0, u.hp / u.maxHp), 3);

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

preloadAssets();
renderManager();
