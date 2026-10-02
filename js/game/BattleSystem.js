export class BattleSystem {
  constructor(towerSystem) {
    this.towers = towerSystem;
    this.time = 180;
    this.overtime = 60;
    this.phase = 'battle'; // 'battle' | 'overtime' | 'ended'
    this.winner = null;
  }

  update(dt, playerElixir, aiElixir) {
    if (this.phase === 'ended') return;

    this.time -= dt;

    if (this.phase === 'battle' && this.time <= 60) {
      playerElixir.isDouble = true;
      aiElixir.isDouble = true;
    }

    if (this.phase === 'battle' && this.time <= 0) {
      const scores = this.getCrowns();
      if (scores.blue !== scores.red) {
        this.endMatch(scores.blue > scores.red ? 'blue' : 'red');
      } else {
        this.phase = 'overtime';
        this.time = this.overtime;
        playerElixir.isDouble = true;
        aiElixir.isDouble = true;
      }
    } else if (this.phase === 'overtime' && this.time <= 0) {
      this.endMatch('draw');
    }

    // Verificar torres del rey
    const redKing = this.towers.towers.find(t => t.team === 'red' && t.kind === 'king');
    const blueKing = this.towers.towers.find(t => t.team === 'blue' && t.kind === 'king');
    if (redKing && redKing.hp <= 0) this.endMatch('blue');
    if (blueKing && blueKing.hp <= 0) this.endMatch('red');
  }

  getCrowns() {
    const count = team => {
      const king = this.towers.towers.find(t => t.team === team && t.kind === 'king');
      if (king && king.hp <= 0) return 3;
      return this.towers.towers.filter(t => t.team === team && t.kind === 'princess' && t.hp <= 0).length;
    };
    return { blue: count('red'), red: count('blue') };
  }

  endMatch(winner) {
    this.phase = 'ended';
    this.winner = winner;
  }
}
