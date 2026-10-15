
/**
 * 
 */
module.exports = class Deck {

    constructor() {

        this.cards = [];

        this.colors = ["r", "g", "b", "y"];

        // ie.. cardsPerColor * Rx * amountOfEachCard
        this.cardsPerColor = 9;
        this.amountOfEachCard = 2;

        this.amountOfDrawTwo = 2; // total d2: amountOfDrawTwo * colors.length
        this.amountOfSkip = 1; // total s: amountOfSkip * colors.length
        this.amountOfReverse = 1; // total r: amountOfReverse * colors.length

        this.amountOfWild = 4; // total w
        this.amountOfWildD4 = 1; // total wd4

        this.create();

    }

    create() {
        const deck = [];

        for (const color in this.colors) { // CARD COLOR

            for (let j = 0; j < this.cardsPerColor; j++) { // CARD NUMBER

                for (let k = 0; k < this.amountOfEachCard; k++) {
                    deck.push(this.colors[color] + j)
                }

            }

            // draw two
            for (let d2 = 0; d2 < this.amountOfDrawTwo; d2++) {
                deck.push(this.colors[color] + "d2")
            }

            // skip
            for (let sk = 0; sk < this.amountOfSkip; sk++) {
                deck.push(this.colors[color] + "s")
            }

            // reverse
            for (let re = 0; re < this.amountOfReverse; re++) {
                deck.push(this.colors[color] + "r")
            }

        }

        for (let wi = 0; wi < this.amountOfWild; wi++) {
            deck.push("w")
        }

        for (let re = 0; re < this.amountOfWildD4; re++) {
            deck.push("wd4")
        }

        this.cards = deck;
    }

    shuffle() {

        /**
         * Shuffles array in place. ES6 version
         * @param {Array} a items An array containing the items.
         */
        function shuffle(a) {
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [a[i], a[j]] = [a[j], a[i]];
            }
            return a;
        }

        this.cards = shuffle(shuffle(this.cards));
    }

}
