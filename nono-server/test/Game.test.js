
const expect = require('chai').expect;

const Game = require('../src/Game.js');

const mockClient = {
    send: function () {
        console.warn("mockClient send", arguments);
    },

    say: function () {
        console.warn("mockClient say", arguments);

    },

    notice: function () {
        console.warn("mockClient notice", arguments);
    },

};

describe('# Game()', function () {
    let game

    const testNick = "hello"
    const testNick2 = "hello_two";

    const testChan = "#Uno_420"

    it('creates a `new Game()`', function () {
        game = new Game(mockClient, testChan, testNick);

        expect(game.deck.cards.length).to.equal(93 - 7); // take the first player

        expect(game.players[testNick].cards.length).to.equal(7); // here they are
    })

    it('isPlayerJoined', function () {
        expect(game.isPlayerJoined(testNick)).to.equal(true);
        expect(game.isPlayerJoined("othernick")).to.equal(false);
    })

    it('testNick2 can join', function () {
        game.joinPlayer(testNick2);

        expect(game.players[testNick].cards.length).to.equal(7); // here they are
        expect(game.players[testNick2].cards.length).to.equal(7); // here they are

    })

    it('start game', function () {
        game.start(testNick)





    })





})
