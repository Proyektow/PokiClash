export class CardSystem {
  constructor(cardsData) {
    this.catalog = cardsData;
    this.deck = cardsData.map(c => c.id);
    this.hand = [];
    this.queue = [];
    this.selectedCardId = null;
    this.reset();
  }

  reset() {
    this.hand = this.deck.slice(0, 4);
    this.queue = this.deck.slice(4);
    this.selectedCardId = null;
  }

  getCard(id) {
    return this.catalog.find(c => c.id === id);
  }

  playCard(id) {
    const idx = this.hand.indexOf(id);
    if (idx === -1) return null;

    const played = this.hand[idx];
    this.queue.push(played);
    const nextCard = this.queue.shift();
    this.hand[idx] = nextCard;
    this.selectedCardId = null;
    return played;
  }

  getNextCard() {
    return this.getCard(this.queue[0]);
  }
}
