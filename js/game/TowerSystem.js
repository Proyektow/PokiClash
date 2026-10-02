export class TowerSystem {
  constructor(width, height, laneXs) {
    this.W = width;
    this.H = height;
    this.laneXs = laneXs;
    this.towers = [];
    this.reset();
  }

  reset() {
    const create = (team, kind, x, y, lane = null) => {
      const king = kind === 'king';
      return {
        id: `${team}-${kind}-${lane}`,
        team, kind, lane, x, y,
        hp: king ? 3800 : 2200,
        maxHp: king ? 3800 : 2200,
        damage: king ? 82 : 65,
        attackSpeed: king ? 0.95 : 0.8,
        range: king ? 175 : 145,
        radius: king ? 26 : 21,
        awake: !king,
        cooldown: 0.3,
        cannonAngle: team === 'blue' ? -Math.PI / 2 : Math.PI / 2
      };
    };

    this.towers = [
      create('red', 'king', this.W / 2, 65),
      create('red', 'princess', this.laneXs[0], 175, 0),
      create('red', 'princess', this.laneXs[1], 175, 1),
      create('blue', 'king', this.W / 2, this.H - 65),
      create('blue', 'princess', this.laneXs[0], this.H - 175, 0),
      create('blue', 'princess', this.laneXs[1], this.H - 175, 1)
    ];
  }

  update(dt, units, onShoot) {
    for (const t of this.towers) {
      if (t.hp <= 0 || !t.awake) continue;
      t.cooldown -= dt;
      if (t.cooldown > 0) continue;

      const enemyTeam = t.team === 'blue' ? 'red' : 'blue';
      const target = units
        .filter(u => u.team === enemyTeam && u.hp > 0 && Math.hypot(u.x - t.x, u.y - t.y) <= t.range)
        .sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y))[0];

      if (target) {
        t.cannonAngle = Math.atan2(target.y - t.y, target.x - t.x);
        target.hp -= t.damage;
        t.cooldown = t.attackSpeed;
        if (onShoot) onShoot(t, target);
      }
    }
  }

  damageTower(tower, amount) {
    if (tower.hp <= 0) return;
    tower.awake = true;
    tower.hp = Math.max(0, tower.hp - amount);
    if (tower.kind === 'princess' && tower.hp <= 0) {
      const king = this.towers.find(t => t.team === tower.team && t.kind === 'king');
      if (king) king.awake = true;
    }
  }
}
