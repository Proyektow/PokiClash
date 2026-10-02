export class ElixirSystem {
  constructor(initial = 5) {
    this.max = 10;
    this.value = initial;
    this.isDouble = false;
  }

  update(dt) {
    const rate = (1 / 2.8) * (this.isDouble ? 2 : 1);
    this.value = Math.min(this.max, this.value + rate * dt);
  }

  canAfford(cost) {
    return this.value >= cost;
  }

  consume(cost) {
    if (!this.canAfford(cost)) return false;
    this.value -= cost;
    return true;
  }
}
