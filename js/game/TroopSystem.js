export class TroopSystem {
  constructor(width, height, laneXs) {
    this.W = width;
    this.H = height;
    this.laneXs = laneXs;
    this.units = [];
    this.projectiles = [];
  }

  reset() {
    this.units = [];
    this.projectiles = [];
  }

  spawn(card, team, lane, y) {
    const x = this.laneXs[lane];
    if (card.isBuilding) {
      this.units.push({
        id: Math.random(), card, team, lane, x, y,
        hp: card.hp, maxHp: card.hp, cooldown: 0.2, age: 0,
        size: 20, isBuilding: true, walkCycle: 0
      });
      return;
    }

    const count = card.count || 1;
    for (let i = 0; i < count; i++) {
      const ox = count > 1 ? ((i % 3) - 1) * 14 : 0;
      const oy = count > 1 ? (Math.floor(i / 3) - 1) * 12 : 0;
      this.units.push({
        id: Math.random(), card, team, lane,
        x: x + ox, y: y + oy,
        hp: card.hp, maxHp: card.hp, cooldown: 0.2,
        size: count > 1 ? 10 : (card.isFlying ? 18 : 15),
        isBuilding: false,
        isFlying: Boolean(card.isFlying),
        walkCycle: Math.random() * Math.PI,
        swarmIndex: i
      });
    }
  }

  castFireball(card, team, tx, ty, towers) {
    this.projectiles.push({
      x: this.W / 2, y: team === 'blue' ? this.H - 70 : 70,
      targetX: tx, targetY: ty, speed: 440,
      damage: card.damage, radius: card.radius,
      factor: card.towerDamageFactor, team
    });
  }

  update(dt, towers, towerSystem, onImpact) {
    // Proyectiles
    for (const p of this.projectiles) {
      const dx = p.targetX - p.x;
      const dy = p.targetY - p.y;
      const dist = Math.hypot(dx, dy);
      const step = p.speed * dt;

      if (dist <= step) {
        p.done = true;
        const enemy = p.team === 'blue' ? 'red' : 'blue';
        this.units.filter(u => u.team === enemy && Math.hypot(u.x - p.targetX, u.y - p.targetY) <= p.radius)
          .forEach(u => { u.hp -= p.damage; });
        towers.filter(t => t.team === enemy && Math.hypot(t.x - p.targetX, t.y - p.targetY) <= p.radius + t.radius)
          .forEach(t => { towerSystem.damageTower(t, p.damage * p.factor); });
        if (onImpact) onImpact(p.targetX, p.targetY);
      } else {
        p.x += (dx / dist) * step;
        p.y += (dy / dist) * step;
      }
    }
    this.projectiles = this.projectiles.filter(p => !p.done);

    // Tropas
    for (const u of this.units) {
      if (u.hp <= 0) continue;
      u.cooldown -= dt;

      if (u.isBuilding) {
        u.age += dt;
        if (u.age >= u.card.lifetime) { u.hp = 0; continue; }
      }

      const enemyTeam = u.team === 'blue' ? 'red' : 'blue';
      const enemyUnits = this.units.filter(o => o.team === enemyTeam && o.hp > 0 && Math.hypot(o.x - u.x, o.y - u.y) <= u.card.range + 35);
      const targetUnit = enemyUnits.sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];

      let target = targetUnit;
      if (!target || u.card.target === 'buildings_only') {
        const laneTower = towers.find(t => t.team === enemyTeam && t.kind === 'princess' && t.lane === u.lane && t.hp > 0);
        target = laneTower || towers.find(t => t.team === enemyTeam && t.kind === 'king' && t.hp > 0);
      }
      if (!target) continue;

      const dx = target.x - u.x;
      const dy = target.y - u.y;
      const dist = Math.hypot(dx, dy);
      const reach = target.kind ? u.card.range + target.radius * 0.7 : u.card.range;

      if (dist <= reach) {
        if (u.cooldown <= 0) {
          if (target.kind) {
            towerSystem.damageTower(target, u.card.damage);
          } else if (u.card.isAoE) {
            this.units.filter(o => o.team === enemyTeam && Math.hypot(o.x - target.x, o.y - target.y) <= 48)
              .forEach(o => { o.hp -= u.card.damage; });
          } else {
            target.hp -= u.card.damage;
          }
          u.cooldown = u.card.attackSpeed;
        }
      } else if (!u.isBuilding) {
        const step = Math.min(u.card.speed * dt, dist - reach + 1);
        u.x += (dx / dist) * step;
        u.y += (dy / dist) * step;
        u.walkCycle += dt * (u.card.speed * 0.15);
      }
    }

    // Separación física
    for (let i = 0; i < this.units.length; i++) {
      for (let j = i + 1; j < this.units.length; j++) {
        const a = this.units[i], b = this.units[j];
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

    this.units = this.units.filter(u => u.hp > 0);
  }
}
