
const expect = require('chai').expect;

const Player = require('../src/Player.js');

describe('# Player()', function () {
    let player
    const testNick = "hello"

    it('creates a new player', function () {
        player = new Player(testNick)

        expect(player.nick).to.equal(testNick)
        expect(player.cards).to.deep.equal([])
    })


})
