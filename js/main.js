import { ElixirSystem } from './game/ElixirSystem.js';
import { CardSystem } from './game/CardSystem.js';
import { TowerSystem } from './game/TowerSystem.js';
import { TroopSystem } from './game/TroopSystem.js';
import { AISystem } from './game/AISystem.js';
import { BattleSystem } from './game/BattleSystem.js';
import { UIManager } from './ui/UIManager.js';

const canvas = document.getElementById('arena-canvas');
const ctx = canvas.getContext('2d');
const W = 400, H = 660, MID = H / 2;
const laneXs = [116, 284];

let lastTime = performance.now();
const imageCache = new Map();

function getImage(url) {
  if (imageCache.has(url)) return imageCache.get(url);
  const img = new Image();
  img.src = url;
  imageCache.set(url, img);
  return img;
}

async function init() {
  const res = await fetch('data/cards.json');
  const cardsData = await res.json();

  const playerElixir = new ElixirSystem(5);
  const aiElixir = new ElixirSystem(5);
  const cardSystem = new CardSystem(cardsData);
  const towerSystem = new TowerSystem(W, H, laneXs);
  const troopSystem = new TroopSystem(W, H, laneXs);
  const battleSystem = new BattleSystem(towerSystem);
  const aiSystem = new AISystem(cardSystem, aiElixir, troopSystem, battleSystem);

  const ui = new UIManager(cardSystem, playerElixir);
  ui.renderHand();

  // Despliegue por clic en el campo
  canvas.addEventListener('pointerdown', e => {
    if (battleSystem.phase === 'ended' || !cardSystem.selectedCardId) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * W;
    const y = (e.clientY - rect.top) / rect.height * H;

    const card = cardSystem.getCard(cardSystem.selectedCardId);
    if (!card || !playerElixir.canAfford(card.elixir)) return;

    // Regla de despliegue en campo propio
    if (card.id !== 'bola-ignea' && y < MID + 10) return;

    playerElixir.consume(card.elixir);
    const lane = x < W / 2 ? 0 : 1;

    if (card.id === 'bola-ignea') {
      troopSystem.castFireball(card, 'blue', x, y, towerSystem.towers);
    } else {
      troopSystem.spawn(card, 'blue', lane, y);
    }

    cardSystem.playCard(card.id);
    ui.renderHand();
  });

  document.getElementById('modal-restart-btn').onclick = () => {
    location.reload();
  };

  // Game Loop a 60 FPS
  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    if (battleSystem.phase !== 'ended') {
      playerElixir.update(dt);
      aiElixir.update(dt);
      aiSystem.update(dt);
      troopSystem.update(dt, towerSystem.towers, towerSystem);
      towerSystem.update(dt, troopSystem.units);
      battleSystem.update(dt, playerElixir, aiElixir);

      ui.updateHUD(battleSystem.time, battleSystem.getCrowns());
      if (battleSystem.phase === 'ended') {
        ui.showResult(battleSystem.winner, battleSystem.getCrowns());
      }
    }

    render(towerSystem.towers, troopSystem.units, troopSystem.projectiles);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

function render(towers, units, projectiles) {
  ctx.clearRect(0, 0, W, H);

  // Césped
  ctx.fillStyle = '#4c7b44';
  ctx.fillRect(0, 0, W, H);

  // Río
  ctx.fillStyle = '#1c7896';
  ctx.fillRect(0, MID - 22, W, 44);

  // Puentes
  laneXs.forEach(x => {
    ctx.fillStyle = '#7f8c8d';
    ctx.fillRect(x - 26, MID - 24, 52, 48);
  });

  // Torres
  for (const t of towers) {
    if (t.hp <= 0) {
      ctx.fillStyle = '#2c3e50';
      ctx.beginPath(); ctx.arc(t.x, t.y, t.radius * 0.8, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    ctx.fillStyle = t.team === 'blue' ? '#2980b9' : '#c0392b';
    ctx.beginPath(); ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2); ctx.fill();

    // Cañón
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.cannonAngle);
    ctx.fillStyle = '#1a252f';
    ctx.fillRect(0, -3, t.radius * 0.85, 6);
    ctx.restore();

    // Barra HP
    const bw = t.kind === 'king' ? 44 : 32;
    ctx.fillStyle = '#000'; ctx.fillRect(t.x - bw / 2, t.y - t.radius - 12, bw, 5);
    ctx.fillStyle = t.team === 'blue' ? '#2ecc71' : '#e74c3c';
    ctx.fillRect(t.x - bw / 2, t.y - t.radius - 12, bw * (t.hp / t.maxHp), 5);
  }

  // Tropas
  units.sort((a, b) => a.y - b.y).forEach(u => {
    const img = getImage(u.card.sprite);
    const sz = u.size * 2.2;
    if (img.complete && img.naturalWidth) {
      ctx.drawImage(img, u.x - sz / 2, u.y - sz / 2, sz, sz);
    } else {
      ctx.fillStyle = u.card.color;
      ctx.beginPath(); ctx.arc(u.x, u.y, u.size, 0, Math.PI * 2); ctx.fill();
    }
    // Barra HP
    ctx.fillStyle = '#000'; ctx.fillRect(u.x - 12, u.y - u.size - 8, 24, 4);
    ctx.fillStyle = u.team === 'blue' ? '#2ecc71' : '#e74c3c';
    ctx.fillRect(u.x - 12, u.y - u.size - 8, 24 * (u.hp / u.maxHp), 4);
  });

  // Proyectiles
  for (const p of projectiles) {
    ctx.fillStyle = '#e67e22';
    ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fill();
  }
}

init();
