export class AISystem {
  constructor(cardSystem, elixirSystem, troopSystem, battleSystem) {
    this.cards = cardSystem;
    this.elixir = elixirSystem;
    this.troops = troopSystem;
    this.battle = battleSystem;
    this.timer = 2.0;
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1.6 + Math.random() * 1.2;

    const affordable = this.cards.catalog.filter(c => this.elixir.canAfford(c.elixir));
    if (!affordable.length) return;

    // Detectar si el jugador empuja con un tanque
    const playerTank = this.troops.units.find(u => u.team === 'blue' && u.card.id === 'snor-tanque');
    if (playerTank) {
      const counter = affordable.find(c => c.id === 'gengar-horda' || c.id === 'scizor-guerrero');
      if (counter && this.elixir.consume(counter.elixir)) {
        this.troops.spawn(counter, 'red', playerTank.lane, 260);
        return;
      }
    }

    // Despliegue estándar en carril aleatorio
    const choice = affordable[Math.floor(Math.random() * affordable.length)];
    const lane = Math.random() < 0.5 ? 0 : 1;

    if (choice.id === 'bola-ignea') {
      const target = this.troops.units.find(u => u.team === 'blue');
      if (target && this.elixir.consume(choice.elixir)) {
        this.troops.castFireball(choice, 'red', target.x, target.y, this.battle.towers.towers);
      }
    } else if (this.elixir.consume(choice.elixir)) {
      this.troops.spawn(choice, 'red', lane, choice.isBuilding ? 150 : 250);
    }
  }
}
