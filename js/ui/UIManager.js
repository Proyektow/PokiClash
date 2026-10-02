export class UIManager {
  constructor(cardSystem, playerElixir, onDeploy) {
    this.cards = cardSystem;
    this.elixir = playerElixir;
    this.onDeploy = onDeploy;
    this.handEl = document.getElementById('card-hand');
    this.nextIcon = document.getElementById('next-card-img');
    this.elixirFill = document.getElementById('elixir-bar-fill');
    this.elixirText = document.getElementById('elixir-count');
    this.timerText = document.getElementById('match-timer');
    this.blueCrownsText = document.getElementById('blue-crowns');
    this.redCrownsText = document.getElementById('red-crowns');
    this.modal = document.getElementById('result-modal');
  }

  renderHand() {
    this.handEl.innerHTML = this.cards.hand.map(id => {
      const c = this.cards.getCard(id);
      const isSel = this.cards.selectedCardId === id ? 'selected' : '';
      const isDis = !this.elixir.canAfford(c.elixir) ? 'disabled' : '';
      return `
        <button class="card-btn ${isSel}" data-card-id="${c.id}" ${isDis}>
          <span class="card-cost">${c.elixir}</span>
          <img class="card-img" src="${c.sprite}" alt="${c.name}">
          <span class="card-name">${c.name}</span>
        </button>
      `;
    }).join('');

    const next = this.cards.getNextCard();
    if (next) this.nextIcon.src = next.sprite;

    this.handEl.querySelectorAll('.card-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.cardId;
        this.cards.selectedCardId = (this.cards.selectedCardId === id) ? null : id;
        this.renderHand();
      };
    });
  }

  updateHUD(time, crowns) {
    const sec = Math.max(0, Math.ceil(time));
    this.timerText.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    this.blueCrownsText.textContent = crowns.blue;
    this.redCrownsText.textContent = crowns.red;

    this.elixirFill.style.width = `${(this.elixir.value / 10) * 100}%`;
    this.elixirText.textContent = Math.floor(this.elixir.value);

    this.handEl.querySelectorAll('.card-btn').forEach(btn => {
      const c = this.cards.getCard(btn.dataset.cardId);
      btn.disabled = !this.elixir.canAfford(c.elixir);
    });
  }

  showResult(winner, crowns) {
    this.modal.hidden = false;
    const title = document.getElementById('modal-title');
    title.textContent = winner === 'blue' ? '¡VICTORIA!' : (winner === 'draw' ? '¡EMPATE!' : 'DERROTA');
    title.style.color = winner === 'blue' ? '#2ecc71' : (winner === 'draw' ? '#f1c40f' : '#e74c3c');
    document.getElementById('modal-score').textContent = `Coronas: ${crowns.blue} - ${crowns.red}`;
  }
}
