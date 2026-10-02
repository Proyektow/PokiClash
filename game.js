import { CARD_DATABASE } from './cards.js';

const $ = sel => document.querySelector(sel);
const canvas = $('#arena');
const ctx = canvas.getContext('2d');
const bottomNav = $('#bottom-nav');
const ghost = $('#drag-ghost');

const W = 400, H = 660, MID = H / 2;
const laneXs = [116, 284];
const STORAGE_KEY = 'pokiclash.v2.names';
const TROPHIES_KEY = 'pokiclash.trophies.v2';
const USER_KEY = 'pokiclash.userdata.v2';
const defaultDeck = CARD_DATABASE.map(c => c.id);

let customNames = {};
try { customNames = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch {}

// SISTEMA DE USUARIO, MONEDAS, NIVELES Y COFRES
let userData = {
  trophies: 0,
  coins: 250,
  level: 1,
  xp: 0,
  cardLevels: {}, // id -> nivel (1 por defecto)
  chests: [null, null, null, null] // 4 slots
};

try {
  const loaded = JSON.parse(localStorage.getItem(USER_KEY));
  if (loaded) userData = { ...userData, ...loaded };
} catch {}

function saveUserData() {
  localStorage.setItem(USER_KEY, JSON.stringify(userData));
  updateUserStatsUI();
}

function getCardLevel(cardId) {
  return userData.cardLevels[cardId] || 1;
}

// MULTIPLICADORES DE NIVEL (+10% stats por nivel)
function getScaledCardStats(card) {
  const lvl = getCardLevel(card.id);
  const factor = 1 + (lvl - 1) * 0.10;
  return {
    ...card,
    hp: Math.round(card.hp * factor),
    damage: Math.round(card.damage * factor)
  };
}

// MATRIZ DE TIPOS ELEMENTALES POKÉMON
const TYPE_CHART = {
  electric: { super: ['water', 'flying'], weak: ['electric', 'grass', 'dragon'] },
  fire: { super: ['grass', 'steel', 'ice'], weak: ['fire', 'water', 'rock', 'dragon'] },
  water: { super: ['fire', 'ground', 'rock'], weak: ['water', 'grass', 'dragon'] },
  grass: { super: ['water', 'ground', 'rock'], weak: ['fire', 'grass', 'poison', 'flying', 'steel'] },
  steel: { super: ['ice', 'rock'], weak: ['steel', 'fire', 'water', 'electric'] },
  ghost: { super: ['ghost', 'psychic'], weak: ['dark', 'normal'] },
  normal: { super: [], weak: ['rock', 'steel'] }
};

function calculateDamageMultiplier(attackType, defenderType) {
  if (!attackType || !defenderType) return 1.0;
  const match = TYPE_CHART[attackType];
  if (!match) return 1.0;
  if (match.super && match.super.includes(defenderType)) return 1.5;
  if (match.weak && match.weak.includes(defenderType)) return 0.65;
  return 1.0;
}

// SISTEMA DE ARENAS POR TROFEOS
function getCurrentArena(trophies) {
  if (trophies < 100) {
    return { id: 1, name: 'Estadio de Kanto', req: 0, theme: 'grass' };
  } else if (trophies < 300) {
    return { id: 2, name: 'Cueva Celeste', req: 100, theme: 'lava' };
  } else {
    return { id: 3, name: 'Cima Plateada', req: 300, theme: 'snow' };
  }
}

function updateUserStatsUI() {
  $('#trophy-count').textContent = userData.trophies;
  $('#user-coins-val').textContent = userData.coins;
  $('#deck-coins-display').textContent = userData.coins;
  $('#user-level-val').textContent = userData.level;

  const arena = getCurrentArena(userData.trophies);
  $('#arena-league-tag').textContent = `ARENA ${arena.id}`;
  $('#arena-name-text').textContent = arena.name;
  $('#arena-req-trophies').textContent = `${arena.req}+`;

  renderChestSlots();
  renderStadiumPreview();
}

// GESTIÓN DE COFRES
function renderChestSlots() {
  document.querySelectorAll('.chest-slot-card').forEach((slotEl, idx) => {
    const chest = userData.chests[idx];
    if (!chest) {
      slotEl.className = 'chest-slot-card';
      slotEl.innerHTML = `<span class="chest-empty-lbl">Hueco Vacío</span>`;
      slotEl.onclick = null;
    } else {
      slotEl.className = 'chest-slot-card has-chest';
      const now = Date.now();
      const isReady = now >= chest.unlockTime;
      const remainingSec = Math.max(0, Math.ceil((chest.unlockTime - now) / 1000));

      slotEl.innerHTML = `
        <span class="chest-slot-icon">🎁</span>
        <span class="chest-slot-type">${chest.type}</span>
        <span class="chest-slot-timer">${isReady ? '¡ABRIR!' : `${remainingSec}s`}</span>
      `;
      slotEl.onclick = () => openChest(idx);
    }
  });
}

function awardChestWin() {
  const emptyIndex = userData.chests.findIndex(c => c === null);
  if (emptyIndex === -1) return false;
  // 15 segundos para pruebas / feedback instantáneo
  userData.chests[emptyIndex] = {
    type: 'Cofre Plata',
    unlockTime: Date.now() + 15000
  };
  saveUserData();
  return true;
}

function openChest(index) {
  const chest = userData.chests[index];
  if (!chest) return;
  if (Date.now() < chest.unlockTime) return;

  const gainedCoins = 150;
  userData.coins += gainedCoins;
  userData.chests[index] = null;
  playSound('win');
  saveUserData();
  renderManager();
}

// MEJORAS DE CARTAS
function upgradeCard(cardId) {
  const currentLvl = getCardLevel(cardId);
  const cost = currentLvl * 100;
  if (userData.coins < cost) return;

  userData.coins -= cost;
  userData.cardLevels[cardId] = currentLvl + 1;
  userData.xp += 25;
  if (userData.xp >= userData.level * 100) {
    userData.level++;
    userData.xp = 0;
  }
  playSound('win');
  saveUserData();
  renderManager();
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

// PRELOADER INTEGRADO CON LA PANTALLA ÉPICA
async function preloadAssets() {
  const progressBar = $('#splash-progress');
  const statusLbl = $('#splash-status');
  const urls = [];

  CARD_DATABASE.forEach(c => {
    if (c.sprite) urls.push(c.sprite);
    if (c.staticIcon) urls.push(c.staticIcon);
  });

  // Assets del arte de la pantalla de entrada
  const splashHeroes = [
    'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/6.png',
    'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/143.png',
    'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/212.png',
    'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/92.png',
    'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png'
  ];
  urls.push(...splashHeroes);

  let count = 0;
  for (const url of urls) {
    await new Promise(res => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { count++; res(); };
      img.onerror = () => { count++; res(); };
      img.src = url;
      imageCache.set(url, img);
      const pct = Math.floor((count / urls.length) * 100);
      progressBar.style.width = pct + '%';
      statusLbl.textContent = `Cargando... ${pct}%`;
    });
  }
  
  statusLbl.textContent = '¡Listo!';
  setTimeout(() => $('#splash-screen').classList.add('fade-out'), 500);
}

// INSTALACIÓN PWA
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

// PREVIEW DEL ESTADIO EN EL HUB
function renderStadiumPreview() {
  const pCanvas = $('#stadium-preview-canvas');
  if (!pCanvas) return;
  const pctx = pCanvas.getContext('2d');
  const pw = pCanvas.width, ph = pCanvas.height;
  const arena = getCurrentArena(userData.trophies);

  pctx.clearRect(0, 0, pw, ph);

  if (arena.theme === 'grass') {
    const bgGrad = pctx.createLinearGradient(0, 0, 0, ph);
    bgGrad.addColorStop(0, '#10221e'); bgGrad.addColorStop(1, '#2c594c');
    pctx.fillStyle = bgGrad; pctx.fillRect(0, 0, pw, ph);
    for (let i = 0; i < 5; i++) {
      pctx.fillStyle = i % 2 === 0 ? '#437a40' : '#4d8a4a';
      pctx.fillRect(15, 30 + i * 20, pw - 30, 20);
    }
    pctx.fillStyle = '#22829e'; pctx.fillRect(15, ph / 2, pw - 30, 14);
  } else if (arena.theme === 'lava') {
    pctx.fillStyle = '#1c1313'; pctx.fillRect(0, 0, pw, ph);
    for (let i = 0; i < 5; i++) {
      pctx.fillStyle = i % 2 === 0 ? '#2d1f1e' : '#3d2827';
      pctx.fillRect(15, 30 + i * 20, pw - 30, 20);
    }
    pctx.fillStyle = '#e74c3c'; pctx.fillRect(15, ph / 2, pw - 30, 14);
  } else {
    pctx.fillStyle = '#1e272e'; pctx.fillRect(0, 0, pw, ph);
    for (let i = 0; i < 5; i++) {
      pctx.fillStyle = i % 2 === 0 ? '#d2dae2' : '#f1f2f6';
      pctx.fillRect(15, 30 + i * 20, pw - 30, 20);
    }
    pctx.fillStyle = '#74b9ff'; pctx.fillRect(15, ph / 2, pw - 30, 14);
  }
}

// SISTEMA DE EMOTES
const emotePopup = $('#emotes-popup-panel');
const emoteMap = {
  'pikachu-happy': '⚡😄',
  'pikachu-cry': '⚡😭',
  'gengar-laugh': '👻😈',
  'snorlax-sleep': '💤😴'
};

$('#btn-emote-menu').addEventListener('click', () => {
  emotePopup.hidden = !emotePopup.hidden;
});

document.querySelectorAll('.emote-option-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.emote;
    triggerPlayerEmote(emoteMap[key]);
    emotePopup.hidden = true;
  });
});

function triggerPlayerEmote(symbol) {
  const el = $('#player-emote-bubble');
  el.textContent = symbol;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 2400);
}

function triggerRivalEmote(symbol) {
  const el = $('#rival-emote-bubble');
  el.textContent = symbol;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 2400);
}

// NAVEGACIÓN
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view-tab').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    $(`#${btn.dataset.target}`).classList.add('active');
  });
});

function cardById(id) {
  const base = CARD_DATABASE.find(c => c.id === id);
  return base ? getScaledCardStats(base) : null;
}
function displayName(card) { return customNames[card.id] || card.name; }

function renderManager() {
  $('#manager-grid').innerHTML = CARD_DATABASE.map(c => {
    const scaled = getScaledCardStats(c);
    const lvl = getCardLevel(c.id);
    const cost = lvl * 100;
    const canUpgrade = userData.coins >= cost;
    return `
      <div class="manager-card">
        <div class="manager-card-top">
          <img class="manager-thumb" src="${c.staticIcon || c.sprite}" alt="${c.name}">
          <div class="manager-info">
            <input maxlength="18" data-name-id="${c.id}" value="${displayName(c)}">
            <div class="manager-meta">
              <span>💧 ${c.costElixir}</span>
              <span>❤️ ${scaled.hp}</span>
            </div>
          </div>
        </div>
        <div class="card-upgrade-row">
          <span class="card-level-tag">NIVEL ${lvl}</span>
          <button class="upgrade-card-btn" data-upgrade-id="${c.id}" ${canUpgrade ? '' : 'disabled'}>
            Mejorar (${cost}🪙)
          </button>
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.upgrade-card-btn').forEach(b => {
    b.addEventListener('click', () => upgradeCard(b.dataset.upgradeId));
  });
}

$('#manager-grid').addEventListener('input', e => {
  const input = e.target.closest('[data-name-id]');
  if (!input) return;
  customNames[input.dataset.nameId] = input.value.trim() || cardById(input.dataset.nameId).name;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customNames));
});

// ESCALADO DE TORRES POR NIVEL DEL JUGADOR
function createTower(team, kind, x, y, lane = null) {
  const king = kind === 'king';
  const playerBonus = team === 'blue' ? (1 + (userData.level - 1) * 0.08) : 1.0;
  const baseHp = king ? 3800 : 2200;
  const baseDmg = king ? 82 : 65;

  return {
    id: `${team}-${kind}-${lane}`, team, kind, lane, x, y,
    hp: Math.round(baseHp * playerBonus), maxHp: Math.round(baseHp * playerBonus),
    damage: Math.round(baseDmg * playerBonus), attackSpeed: king ? 0.95 : 0.8,
    range: king ? 175 : 145, radius: king ? 26 : 21,
    awake: !king, cooldown: 0.3, isBuilding: true,
    cannonAngle: team === 'blue' ? -Math.PI / 2 : Math.PI / 2,
    target: null
  };
}

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
    units: [], towers: [], blasts: [], projectiles: [], floatingTexts: [],
    selected: null, pointerPos: null,
    aiClock: 2.0, lastPlayerTank: null, matchTimeElapsed: 0,
    arenaTheme: getCurrentArena(userData.trophies).theme
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
  $('#modal-chest-award').hidden = true;
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
  updateUserStatsUI();
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

  const rect = canvas.getBoundingClientRect();
  state.pointerPos = {
    x: (e.clientX - rect.left) / rect.width * W,
    y: (e.clientY - rect.top) / rect.height * H
  };
}

function onDragEnd(e) {
  if (!dragState) return;
  const rect = canvas.getBoundingClientRect();
  const overArena = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
  const id = dragState.id;
  const moved = dragState.moved;
  dragState = null;
  ghost.classList.remove('visible');
  state.pointerPos = null;

  if (moved && overArena) {
    deployAt(id, e.clientX, e.clientY);
  } else {
    state.selected = id;
    updateHand();
  }
}

canvas.addEventListener('pointermove', e => {
  if (!state || !state.selected) return;
  const rect = canvas.getBoundingClientRect();
  state.pointerPos = {
    x: (e.clientX - rect.left) / rect.width * W,
    y: (e.clientY - rect.top) / rect.height * H
  };
});

canvas.addEventListener('pointerleave', () => {
  if (state) state.pointerPos = null;
});

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
      towerDamageFactor: card.towerDamageFactor,
      type: card.type
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
    state.pointerPos = null;
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

  state.floatingTexts.forEach(ft => {
    ft.y -= dt * 25;
    ft.life -= dt;
  });
  state.floatingTexts = state.floatingTexts.filter(ft => ft.life > 0);

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
        .forEach(u => applyDamage(p, u, p.damage));

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
  playSound('hit');
  if (target.kind) {
    damageTower(target, attacker.card.damage);
  } else if (attacker.card.isAoE) {
    const rad = attacker.card.splashRadius || 48;
    state.units.filter(u => u.team !== attacker.team && Math.hypot(u.x - target.x, u.y - target.y) <= rad)
      .forEach(u => applyDamage(attacker, u, attacker.card.damage));
    state.blasts.push({ x: target.x, y: target.y, radius: rad, color: attacker.card.color, life: 0.25, maxLife: 0.25 });
  } else {
    applyDamage(attacker, target, attacker.card.damage);
  }
}

function applyDamage(source, target, baseDmg) {
  const mult = calculateDamageMultiplier(source.card ? source.card.type : source.type, target.card ? target.card.type : null);
  const finalDmg = Math.round(baseDmg * mult);
  target.hp = Math.max(0, target.hp - finalDmg);

  if (mult >= 1.4) {
    state.floatingTexts.push({ x: target.x, y: target.y - 10, text: '¡Eficaz! x1.5', color: '#f1c40f', life: 0.8 });
  } else if (mult <= 0.7) {
    state.floatingTexts.push({ x: target.x, y: target.y - 10, text: 'Poco eficaz', color: '#95a5a6', life: 0.8 });
  }
}

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
      t.cannonAngle = Math.atan2(target.y - t.y, target.x - t.x);
      if (t.cooldown <= 0) {
        playSound('hit');
        target.hp = Math.max(0, target.hp - t.damage);
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

  if (Math.random() < 0.08) {
    const aiEmotes = ['⚡😄', '👻😈', '💤😴', '⚡😭'];
    triggerRivalEmote(aiEmotes[Math.floor(Math.random() * aiEmotes.length)]);
  }

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
    userData.trophies += trophyDelta;
    userData.coins += 40;
    const gotChest = awardChestWin();
    if (gotChest) $('#modal-chest-award').hidden = false;
  } else if (!isDraw) {
    trophyDelta = -20;
    userData.trophies = Math.max(0, userData.trophies + trophyDelta);
  }

  saveUserData();

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

function drawArena() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const theme = state ? state.arenaTheme : 'grass';

  const stripes = 12;
  const sh = H / stripes;
  for (let i = 0; i < stripes; i++) {
    if (theme === 'grass') {
      ctx.fillStyle = i % 2 === 0 ? '#43793e' : '#4a8545';
    } else if (theme === 'lava') {
      ctx.fillStyle = i % 2 === 0 ? '#261b1b' : '#332322';
    } else {
      ctx.fillStyle = i % 2 === 0 ? '#d2dae2' : '#f1f2f6';
    }
    ctx.fillRect(0, i * sh, W, sh);
  }

  if (theme === 'grass') {
    ctx.fillStyle = '#b38f58'; ctx.fillRect(0, MID - 27, W, 54);
    ctx.fillStyle = '#1c7896'; ctx.fillRect(0, MID - 23, W, 46);
  } else if (theme === 'lava') {
    ctx.fillStyle = '#110b0b'; ctx.fillRect(0, MID - 27, W, 54);
    ctx.fillStyle = '#c0392b'; ctx.fillRect(0, MID - 23, W, 46);
    ctx.fillStyle = '#e67e22'; ctx.fillRect(0, MID - 5, W, 10);
  } else {
    ctx.fillStyle = '#a4b0be'; ctx.fillRect(0, MID - 27, W, 54);
    ctx.fillStyle = '#74b9ff'; ctx.fillRect(0, MID - 23, W, 46);
  }

  laneXs.forEach(x => {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 32, MID - 28, 64, 60);
    ctx.fillStyle = theme === 'lava' ? '#4a3838' : '#7f8c8d';
    ctx.fillRect(x - 28, MID - 26, 56, 52);
    for (let py = MID - 22; py <= MID + 20; py += 8) {
      ctx.fillStyle = theme === 'lava' ? '#2e1c1c' : '#95a5a6';
      ctx.fillRect(x - 26, py, 52, 6);
    }
  });

  const bLine = deploymentBoundary();
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, bLine);
  ctx.lineTo(W, bLine);
  ctx.stroke();
  ctx.restore();

  if (theme === 'snow' && state) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    for (let i = 0; i < 20; i++) {
      const sx = (Math.sin(state.matchTimeElapsed + i) * W + i * 25) % W;
      const sy = (state.matchTimeElapsed * 40 + i * 35) % H;
      ctx.fillRect(sx, sy, 3, 3);
    }
  }

  // RETÍCULA DE DESPLIEGUE Y RANGO
  if (state && state.selected && state.pointerPos) {
    const card = cardById(state.selected);
    const pos = state.pointerPos;

    ctx.save();
    if (card.id === 'bola-ignea') {
      ctx.strokeStyle = '#ff4757';
      ctx.fillStyle = 'rgba(255, 71, 87, 0.25)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, card.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#2ecc71';
      ctx.fillStyle = 'rgba(46, 204, 113, 0.15)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, card.range + 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  state.towers.forEach(drawRealisticTower);

  state.projectiles.forEach(p => {
    ctx.save();
    ctx.fillStyle = '#e67e22';
    ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f1c40f';
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });

  state.units.sort((a, b) => a.y - b.y).forEach(drawAnimatedUnit);

  state.floatingTexts.forEach(ft => {
    ctx.save();
    ctx.font = '900 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = ft.color;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(ft.text, ft.x, ft.y);
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();
  });

  state.blasts.forEach(b => {
    ctx.save();
    ctx.globalAlpha = b.life / b.maxLife;
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawRealisticTower(t) {
  const isBlue = t.team === 'blue';
  const isKing = t.kind === 'king';

  if (t.hp <= 0) {
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath(); ctx.arc(t.x, t.y, t.radius * 0.9, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(t.x + 3, t.y + 6, t.radius * 1.15, t.radius * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#566573';
  ctx.beginPath(); ctx.arc(t.x, t.y, t.radius + 3, 0, Math.PI * 2);
  ctx.fill();

  const towerGrad = ctx.createLinearGradient(t.x - t.radius, t.y, t.x + t.radius, t.y);
  if (isBlue) {
    towerGrad.addColorStop(0, '#1f618d'); towerGrad.addColorStop(0.5, '#2980b9'); towerGrad.addColorStop(1, '#154360');
  } else {
    towerGrad.addColorStop(0, '#922b21'); towerGrad.addColorStop(0.5, '#c0392b'); towerGrad.addColorStop(1, '#641e16');
  }
  ctx.fillStyle = towerGrad;
  ctx.beginPath(); ctx.arc(t.x, t.y - 4, t.radius, 0, Math.PI * 2); ctx.fill();

  // Cañón rotativo
  ctx.save();
  ctx.translate(t.x, t.y - 6);
  ctx.rotate(t.cannonAngle);
  ctx.fillStyle = '#2c3e50';
  ctx.fillRect(0, -3.5, t.radius * 0.9, 7);
  ctx.fillStyle = '#f1c40f';
  ctx.fillRect(t.radius * 0.75, -4, 4, 8);
  ctx.restore();

  if (isKing) {
    ctx.fillStyle = '#f1c40f';
    ctx.font = '900 17px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t.awake ? '♛' : '💤', t.x, t.y - 7);
  } else {
    ctx.fillStyle = '#ecf0f1';
    ctx.beginPath(); ctx.arc(t.x, t.y - 6, 6, 0, Math.PI * 2); ctx.fill();
  }

  const bw = isKing ? 48 : 34;
  const bx = t.x - bw / 2;
  const by = t.y - t.radius - 16;
  ctx.fillStyle = '#000';
  ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
  ctx.fillStyle = isBlue ? '#2ecc71' : '#e74c3c';
  ctx.fillRect(bx, by, bw * Math.max(0, t.hp / t.maxHp), 4);
}

function drawAnimatedUnit(u) {
  const img = getCachedImage(u.card.sprite || u.card.staticIcon);
  const sz = u.size * 2.3;

  let walkBounceY = 0;
  let walkTilt = 0;

  if (u.isFlying) {
    walkBounceY = Math.sin(state.matchTimeElapsed * 5) * 5 - 12;
  } else if (!u.isBuilding) {
    walkBounceY = -Math.abs(Math.sin(u.walkCycle)) * 3.5;
    walkTilt = Math.sin(u.walkCycle) * 0.12;
  }

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
    ctx.fillStyle = u.card.color;
    ctx.beginPath(); ctx.arc(0, 0, u.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  const bw = u.swarmCount > 1 ? 14 : 26;
  const bx = u.x - bw / 2;
  const by = u.y + walkBounceY - sz / 2 - 6;
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

// INICIALIZACIÓN
preloadAssets();
updateUserStatsUI();
renderManager();
setInterval(renderChestSlots, 1000);
