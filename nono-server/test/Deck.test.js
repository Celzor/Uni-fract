
const expect = require('chai').expect;

const Deck = require('../src/Deck.js');

describe('# Deck()', function () {
    let deck

    it('creates a new deck', function () {
        deck = new Deck()

        expect(deck.colors.length).to.equal(4)
        expect(deck.cards.length).to.equal(93)
    })


    it('shuffles cards', function () {

        expect(deck.cards[92]).to.equal("wd4")
        expect(deck.cards[54]).to.equal("b5")
        expect(deck.cards[66]).to.equal("y0")

        deck.shuffle()
        deck.shuffle()
        deck.shuffle()
        deck.shuffle()

        expect(deck.cards[92]).to.not.equal("wd4")
        expect(deck.cards[54]).to.not.equal("b5")
        expect(deck.cards[66]).to.not.equal("y0")

    })

})
