import { CARD_DATABASE } from './cards.js';

const $ = sel => document.querySelector(sel);
const canvas = $('#arena');
const ctx = canvas.getContext('2d');
const managerGrid = $('#manager-grid');
const handEl = $('#cards');
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

// Caché de imágenes precargadas
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

// Inicializar Preloader e Imágenes
async function preloadGame() {
  const progressBar = $('#splash-progress');
  const statusText = $('#splash-status');
  const urls = [];

  CARD_DATABASE.forEach(c => {
    if (c.sprite) urls.push(c.sprite);
    if (c.staticIcon) urls.push(c.staticIcon);
  });

  let loaded = 0;
  const total = urls.length;

  for (const url of urls) {
    await new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { loaded++; resolve(); };
      img.onerror = () => { loaded++; resolve(); }; // No bloquear si falla un asset
      img.src = url;
      imageCache.set(url, img);
      const pct = Math.floor((loaded / total) * 100);
      progressBar.style.width = pct + '%';
      statusText.textContent = `Preparando combatientes (${loaded}/${total})...`;
    });
  }

  statusText.textContent = '¡Todo listo para la arena!';
  setTimeout(() => {
    $('#splash-screen').classList.add('fade-out');
  }, 400);
}

// PWA Instalación
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = $('#pwa-install-btn');
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') btn.hidden = true;
    deferredPrompt = null;
  });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

function cardById(id) { return CARD_DATABASE.find(c => c.id === id); }
function displayName(card) { return customNames[card.id] || card.name; }

function renderManager() {
  managerGrid.innerHTML = CARD_DATABASE.map(c => `
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

managerGrid.addEventListener('input', e => {
  const input = e.target.closest('[data-name-id]');
  if (!input) return;
  customNames[input.dataset.nameId] = input.value.trim() || cardById(input.dataset.nameId).name;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customNames));
});

$('#enter-arena').addEventListener('click', startMatch);
$('#back-to-deck').addEventListener('click', returnToDeck);
$('#play-again').addEventListener('click', returnToDeck);

// Configuración de Torres estilo Clash Royale
function createTower(team, kind, x, y, lane = null) {
  const king = kind === 'king';
  return {
    id: `${team}-${kind}-${lane}`, team, kind, lane, x, y,
    hp: king ? 3800 : 2200, maxHp: king ? 3800 : 2200,
    damage: king ? 78 : 64, attackSpeed: king ? 0.95 : 0.8,
    range: king ? 175 : 145, radius: king ? 24 : 20,
    awake: !king, cooldown: 0.3, isBuilding: true, isFlying: false
  };
}

function startMatch() {
  $('#deck-screen').hidden = true;
  $('#game-screen').hidden = false;
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

  $('#result').hidden = true;
  $('#hint').classList.remove('hidden');
  updateHand();
  updateHUD();
  resizeCanvas();

  if (frameId) cancelAnimationFrame(frameId);
  state.lastFrame = performance.now();
  frameId = requestAnimationFrame(frame);
}

function returnToDeck() {
  if (state) state.running = false;
  if (frameId) cancelAnimationFrame(frameId);
  frameId = 0;
  ghost.classList.remove('visible');
  $('#game-screen').hidden = true;
  $('#deck-screen').hidden = false;
  renderManager();
}

function updateHand() {
  if (!state) return;
  handEl.innerHTML = state.hand.map(id => {
    const c = cardById(id);
    const sel = state.selected === id ? ' selected' : '';
    const dis = (state.energy < c.costElixir || state.ended) ? ' disabled' : '';
    return `
      <button class="battle-card${sel}" type="button" data-card-id="${id}" ${dis}>
        <span class="cost-bubble">${c.costElixir}</span>
        <img class="battle-card-img" src="${c.staticIcon || c.sprite}" alt="${displayName(c)}">
        <span class="battle-card-name">${displayName(c)}</span>
      </button>
    `;
  }).join('');

  const nextCard = cardById(defaultDeck[state.nextIndex % defaultDeck.length]);
  $('#next-icon').src = nextCard.staticIcon || nextCard.sprite;
  $('#next-cost').textContent = nextCard.costElixir;

  handEl.querySelectorAll('.battle-card').forEach(btn => {
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
  moveGhost(e.clientX, e.clientY);

  btn.addEventListener('pointermove', onDragMove);
  btn.addEventListener('pointerup', onDragEnd, { once: true });
  btn.addEventListener('pointercancel', () => { dragState = null; ghost.classList.remove('visible'); }, { once: true });
}

function moveGhost(x, y) {
  ghost.style.left = `${x}px`;
  ghost.style.top = `${y}px`;
}

function onDragMove(e) {
  if (!dragState) return;
  if (!dragState.moved && Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY) > 6) {
    dragState.moved = true;
  }
  moveGhost(e.clientX, e.clientY);
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
  const redPrincessDestroyed = state.towers.filter(t => t.team === 'red' && t.kind === 'princess' && t.hp <= 0).length;
  return Math.max(MID - 85, MID + 15 - redPrincessDestroyed * 55);
}

function deployAt(id, clientX, clientY, team = 'blue', forcedLane = null, forcedY = null, targetPt = null) {
  if (!state || state.ended) return false;
  const card = cardById(id);
  const hand = team === 'blue' ? state.hand : state.aiHand;
  const energyKey = team === 'blue' ? 'energy' : 'enemyEnergy';

  if (!hand.includes(id) || state[energyKey] < card.costElixir) return false;

  let point;
  if (targetPt) point = targetPt;
  else if (forcedLane !== null) point = { x: laneXs[forcedLane], y: forcedY };
  else {
    const rect = canvas.getBoundingClientRect();
    point = {
      x: (clientX - rect.left) / rect.width * W,
      y: (clientY - rect.top) / rect.height * H
    };
  }

  const lane = forcedLane ?? (point.x < W / 2 ? 0 : 1);

  // Restricciones de despliegue tipo Clash Royale
  if (card.id !== 'bola-ignea') {
    if (team === 'blue' && point.y < deploymentBoundary()) return false;
    if (team === 'red' && point.y > MID - 15) return false;
  }

  state[energyKey] -= card.costElixir;

  if (card.id === 'bola-ignea') {
    castFireball(card, team, point.x, point.y);
  } else {
    spawnTroops(card, team, lane, point.y);
  }

  // Rotación de cartas
  cycleCard(team, id);

  if (team === 'blue') {
    state.selected = null;
    $('#hint').classList.add('hidden');
    if (card.id === 'snor-tanque') state.lastPlayerTank = { lane, time: performance.now() / 1000 };
  }

  updateHand();
  updateHUD();
  return true;
}

function cycleCard(team, id) {
  const hand = team === 'blue' ? state.hand : state.aiHand;
  const idxKey = team === 'blue' ? 'nextIndex' : 'aiNextIndex';
  const pos = hand.indexOf(id);
  if (pos >= 0) {
    hand.splice(pos, 1);
    hand.push(defaultDeck[state[idxKey] % defaultDeck.length]);
    state[idxKey]++;
  }
}

function spawnTroops(card, team, lane, y) {
  const x = laneXs[lane];
  if (card.isBuilding) {
    state.units.push({
      id: Math.random(), card, team, lane, x, y, hp: card.hp, maxHp: card.hp,
      cooldown: 0.2, age: 0, size: 20, isBuilding: true, isFlying: false
    });
    return;
  }

  const count = card.count || 1;
  for (let i = 0; i < count; i++) {
    const offsetX = count > 1 ? ((i % 3) - 1) * 14 : (Math.random() - 0.5) * 8;
    const offsetY = count > 1 ? (Math.floor(i / 3) - 1) * 12 : (Math.random() - 0.5) * 8;
    state.units.push({
      id: Math.random(), card, team, lane,
      x: x + offsetX, y: y + offsetY,
      hp: card.hp, maxHp: card.hp, cooldown: Math.random() * 0.2,
      size: count > 1 ? 9 : (card.isFlying ? 18 : 15),
      isBuilding: false, isFlying: Boolean(card.isFlying),
      swarmIndex: i, swarmCount: count
    });
  }
}

function castFireball(card, team, tx, ty) {
  const startX = team === 'blue' ? W / 2 : W / 2;
  const startY = team === 'blue' ? H - 70 : 70;
  state.projectiles.push({
    x: startX, y: startY, targetX: tx, targetY: ty,
    speed: 420, team, damage: card.damage, radius: card.radius,
    towerDamageFactor: card.towerDamageFactor, isFireball: true
  });
}

function updateGame(dt, nowSec) {
  if (!state || !state.running || state.ended) return;

  // Cronómetro y Doble Elixir
  state.time -= dt;
  if (state.phase === 'battle' && state.time <= 0) {
    const scores = countCrowns();
    if (scores.blue !== scores.red) {
      endMatch(scores.blue > scores.red ? 'blue' : 'red');
      return;
    }
    state.phase = 'overtime';
    state.time = state.overtime;
  } else if (state.phase === 'overtime' && state.time <= 0) {
    endMatch('draw');
    return;
  }

  const isDouble = state.phase === 'overtime' || (state.phase === 'battle' && state.time <= 60);
  const regenRate = (1 / 2.8) * (isDouble ? 2 : 1);
  state.energy = Math.min(10, state.energy + regenRate * dt);
  state.enemyEnergy = Math.min(10, state.enemyEnergy + regenRate * dt);

  updateAI(dt, nowSec);
  updateUnits(dt);
  updateProjectiles(dt);
  updateTowers(dt);

  // Explosiones / Efectos
  state.blasts.forEach(b => b.life -= dt);
  state.blasts = state.blasts.filter(b => b.life > 0);

  // Verificar Reyes destruidos
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
      // Impacto de Bola Ígnea
      p.x = p.targetX;
      p.y = p.targetY;
      const enemy = p.team === 'blue' ? 'red' : 'blue';

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
  for (const unit of state.units) {
    if (unit.hp <= 0) continue;
    unit.cooldown -= dt;

    if (unit.isBuilding) {
      unit.age += dt;
      if (unit.age >= unit.card.lifetime) { unit.hp = 0; continue; }
      if (unit.cooldown <= 0) {
        const target = findTarget(unit);
        if (target) { attack(unit, target); unit.cooldown = unit.card.attackSpeed; }
      }
      continue;
    }

    const enemyTarget = findTarget(unit);
    const target = enemyTarget || findTowerTarget(unit);
    if (!target) continue;

    const dx = target.x - unit.x, dy = target.y - unit.y;
    const dist = Math.hypot(dx, dy);
    const reach = target.kind ? unit.card.range + target.radius * 0.7 : unit.card.range;

    if (dist <= reach) {
      if (unit.cooldown <= 0) {
        attack(unit, target);
        unit.cooldown = unit.card.attackSpeed;
      }
    } else {
      const step = Math.min(unit.card.speed * dt, dist - reach + 1);
      unit.x += (dx / dist) * step;
      unit.y += (dy / dist) * step;
    }
  }

  // Separación física entre tropas para evitar apilamiento
  for (let i = 0; i < state.units.length; i++) {
    for (let j = i + 1; j < state.units.length; j++) {
      const a = state.units[i], b = state.units[j];
      if (a.isBuilding || b.isBuilding || a.lane !== b.lane) continue;
      let dx = b.x - a.x, dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      const minDist = a.size + b.size;
      if (dist < minDist && dist > 0) {
        const push = (minDist - dist) * 0.2;
        a.x -= (dx / dist) * push; b.x += (dx / dist) * push;
        a.y -= (dy / dist) * push * 0.3; b.y += (dy / dist) * push * 0.3;
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

function damageUnit(unit, amount) {
  unit.hp = Math.max(0, unit.hp - amount);
}

function damageTower(tower, amount) {
  if (tower.hp <= 0) return;
  tower.awake = true;
  tower.hp = Math.max(0, tower.hp - amount);
  if (tower.hp <= 0 && state.phase === 'overtime') {
    endMatch(tower.team === 'red' ? 'blue' : 'red');
  }
}

function updateTowers(dt) {
  for (const tower of state.towers) {
    if (tower.hp <= 0 || !tower.awake) continue;
    tower.cooldown -= dt;
    if (tower.cooldown > 0) continue;

    const enemy = tower.team === 'blue' ? 'red' : 'blue';
    const target = state.units.filter(u => u.team === enemy && u.hp > 0 && Math.hypot(u.x - tower.x, u.y - tower.y) <= tower.range)
      .sort((a, b) => Math.hypot(a.x - tower.x, a.y - tower.y) - Math.hypot(b.x - tower.x, b.y - tower.y))[0];

    if (target) {
      damageUnit(target, tower.damage);
      state.blasts.push({ x: target.x, y: target.y, radius: 8, color: '#f1c40f', life: 0.15, maxLife: 0.15, particle: true });
      tower.cooldown = tower.attackSpeed;
    }
  }
}

function updateAI(dt, nowSec) {
  state.aiClock -= dt;
  if (state.aiClock > 0 || state.ended) return;
  state.aiClock = 1.4 + Math.random() * 1.0;

  const affordable = state.aiHand.map(cardById).filter(c => c && c.costElixir <= state.enemyEnergy);
  if (!affordable.length) return;

  const playerUnits = state.units.filter(u => u.team === 'blue' && u.hp > 0);

  // Respuesta inteligente al Gigante / Tanque
  if (state.lastPlayerTank && (nowSec - state.lastPlayerTank.time) < 6) {
    const counter = affordable.find(c => c.id === 'gengar-horda' || c.id === 'scizor-guerrero');
    if (counter) {
      deployAt(counter.id, 0, 0, 'red', state.lastPlayerTank.lane, MID - 50);
      state.lastPlayerTank = null;
      return;
    }
  }

  // Si tiene mucho elixir, lanza combo
  if (state.enemyEnergy >= 8) {
    const tank = affordable.find(c => c.id === 'snor-tanque');
    const attacker = affordable.find(c => c.id === 'char-ignis' || c.id === 'decidue-tirador');
    const lane = Math.random() < 0.5 ? 0 : 1;
    if (tank) { deployAt(tank.id, 0, 0, 'red', lane, 190); return; }
    if (attacker) { deployAt(attacker.id, 0, 0, 'red', lane, 190); return; }
  }

  // Despliegue general
  const chosen = affordable[Math.floor(Math.random() * affordable.length)];
  const lane = playerUnits.length ? (playerUnits[0].x < W / 2 ? 0 : 1) : (Math.random() < 0.5 ? 0 : 1);
  deployAt(chosen.id, 0, 0, 'red', lane, chosen.isBuilding ? 150 : MID - 60);
}

function countCrowns() {
  const getCrowns = team => {
    const kingDead = state.towers.some(t => t.team === team && t.kind === 'king' && t.hp <= 0);
    if (kingDead) return 3;
    return state.towers.filter(t => t.team === team && t.kind === 'princess' && t.hp <= 0).length;
  };
  return { blue: getCrowns('red'), red: getCrowns('blue') };
}

function endMatch(winner) {
  if (state.ended) return;
  state.ended = true;
  const crowns = countCrowns();
  $('#blue-crown-score').textContent = crowns.blue;
  $('#red-crown-score').textContent = crowns.red;

  const isWin = winner === 'blue';
  $('#result-title').textContent = isWin ? '¡VICTORIA!' : (winner === 'draw' ? '¡EMPATE!' : 'DERROTA');
  $('#result-title').style.color = isWin ? '#2ed573' : (winner === 'draw' ? '#ffa502' : '#ff4757');
  $('#result-crown').textContent = isWin ? '♛' : '☠';
  $('#result-copy').textContent = `Coronas: ${crowns.blue} vs ${crowns.red}`;
  $('#result').hidden = false;
}

function updateHUD() {
  if (!state) return;
  const sec = Math.max(0, Math.ceil(state.time));
  $('#timer').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  $('#phase-label').textContent = state.phase === 'overtime' ? 'MUERTE SÚBITA' : 'BATALLA';
  $('#double-badge').hidden = !(state.phase === 'overtime' || (state.phase === 'battle' && state.time <= 60));

  $('#energy-value').textContent = Math.floor(state.energy);
  $('#energy-fill').style.width = `${(state.energy / 10) * 100}%`;

  const crowns = countCrowns();
  $('#blue-crown-score').textContent = crowns.blue;
  $('#red-crown-score').textContent = crowns.red;

  handEl.querySelectorAll('.battle-card').forEach(btn => {
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

// DIBUJADO DE LA ARENA, TORRES REALES Y SPRITES
function drawArena() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Césped estilo Clash Royale con degradado
  const grass = ctx.createLinearGradient(0, 0, 0, H);
  grass.addColorStop(0, '#426839');
  grass.addColorStop(0.5, '#4f7c44');
  grass.addColorStop(1, '#3b5e33');
  ctx.fillStyle = grass;
  ctx.fillRect(0, 0, W, H);

  // Río central
  ctx.fillStyle = '#1e7b99';
  ctx.fillRect(0, MID - 24, W, 48);
  ctx.fillStyle = '#2ab0da';
  ctx.fillRect(0, MID - 4, W, 8); // Brillo de corriente

  // Puentes de madera detallados
  laneXs.forEach(x => {
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(x - 30, MID - 28, 60, 56);
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(x - 26, MID - 24, 52, 48);
    // Tablones
    ctx.fillStyle = '#5d4037';
    for (let py = MID - 20; py <= MID + 20; py += 10) {
      ctx.fillRect(x - 26, py, 52, 2);
    }
  });

  // Línea de límite de despliegue
  const bLine = deploymentBoundary();
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, bLine);
  ctx.lineTo(W, bLine);
  ctx.stroke();
  ctx.restore();

  // Torres con arquitectura y coronas
  state.towers.forEach(drawTower);

  // Proyectiles volando (Llamaradas, etc.)
  state.projectiles.forEach(drawProjectile);

  // Unidades con sprites de Pokémon
  state.units.sort((a, b) => a.y - b.y).forEach(drawUnit);

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

function drawTower(t) {
  const isBlue = t.team === 'blue';
  const isKing = t.kind === 'king';

  if (t.hp <= 0) {
    // Ruinas
    ctx.fillStyle = '#37474f';
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.radius * 0.8, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Base de piedra
  ctx.fillStyle = '#7f8c8d';
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.radius + 4, 0, Math.PI * 2);
  ctx.fill();

  // Cuerpo de la torre
  ctx.fillStyle = isBlue ? '#2980b9' : '#c0392b';
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
  ctx.fill();

  // Almena / tejado superior
  ctx.fillStyle = isBlue ? '#3498db' : '#e74c3c';
  ctx.beginPath();
  ctx.arc(t.x, t.y - 4, t.radius * 0.7, 0, Math.PI * 2);
  ctx.fill();

  // Cañón o Corona
  ctx.fillStyle = '#f1c40f';
  ctx.font = `900 ${isKing ? 18 : 13}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isKing ? (t.awake ? '♛' : '💤') : '✦', t.x, t.y - 4);

  // Barra de salud superior
  const bw = isKing ? 46 : 34;
  const bh = 5;
  const bx = t.x - bw / 2;
  const by = t.y - t.radius - 14;

  ctx.fillStyle = '#000';
  ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
  ctx.fillStyle = isBlue ? '#2ecc71' : '#e74c3c';
  ctx.fillRect(bx, by, bw * Math.max(0, t.hp / t.maxHp), bh);
}

function drawUnit(u) {
  const img = getCachedImage(u.card.sprite || u.card.staticIcon);
  const sz = u.size * 2.2;

  // Sombra proyectada
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(u.x, u.y + (u.isFlying ? 14 : 4), u.size * 0.9, u.size * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  // Sprite de Pokémon
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, u.x - sz / 2, u.y - sz / 2 - (u.isFlying ? 10 : 0), sz, sz);
  } else {
    // Fallback geométrico con el color asignado
    ctx.fillStyle = u.card.color;
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.size, 0, Math.PI * 2);
    ctx.fill();
  }

  // Barra de vida
  const bw = u.swarmCount > 1 ? 14 : 26;
  const bh = 3.5;
  const bx = u.x - bw / 2;
  const by = u.y - sz / 2 - 8 - (u.isFlying ? 10 : 0);

  ctx.fillStyle = '#000';
  ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
  ctx.fillStyle = u.team === 'blue' ? '#2ecc71' : '#e74c3c';
  ctx.fillRect(bx, by, bw * Math.max(0, u.hp / u.maxHp), bh);

  // Nombre visible sólo para tropas principales
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

function drawProjectile(p) {
  ctx.save();
  ctx.fillStyle = '#e67e22';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
  ctx.fill();
  // Estela de fuego
  ctx.fillStyle = '#f1c40f';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function frame(now) {
  if (!state || !state.running) return;
  const dt = Math.min((now - state.lastFrame) / 1000, 0.05);
  state.lastFrame = now;
  updateGame(dt, now / 1000);
  drawArena();
  frameId = requestAnimationFrame(frame);
}

// Inicialización
preloadGame();
renderManager();
