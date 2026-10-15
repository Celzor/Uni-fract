const config = require('../config.js');

const colourize = require('./colourize.js');

const Deck = require("./Deck.js");
const Player = require("./Player.js");

const GAME_STATE_LOBBY = 0;
const GAME_STATE_PROGRESS = 1;

module.exports = class Game {

    constructor(client, channel, gameOwner) {
        this.client = client
        this.channel = channel

        this.gameState = GAME_STATE_LOBBY

        this.deck = new Deck()

        this.pile = []
        this.players = {}

        this.joinPlayer(gameOwner)

        this.turnIndex = 0
        this.reverse = false
        this.gameOwner = gameOwner
        this.can_pass = false

        this.client.notice("gamerx", this.deck.cards.join(", "))
        this.deck.shuffle()
    }

    isPlayerJoined(nickName) {
        if (Object.prototype.hasOwnProperty.call(this.players, nickName)) {
            return true
        }
        return false
    }

    joinPlayer(nickName) {

        if (this.gameState == GAME_STATE_LOBBY) {

            if (!this.isPlayerJoined(nickName)) {

                const newPlayer = new Player(nickName);
                this.players[nickName] = newPlayer;

                this.givePlayerCards(this.deck.cards, nickName, 7);

                if (this.gameOwner !== nickName) {
                    this.client.say(this.channel, `${nickName} has joined the game!`)
                }

            }


        }

    }

    start(nickName) {

        if (this.gameState !== GAME_STATE_LOBBY) {
            return this.client.notice(nickName, "Not in game lobby!");
        }

        if (Object.keys(this.players).length < 2) {
            return this.client.say(this.channel, "Not enough players! Please wait for more to join.");
        }

        if (nickName !== this.gameOwner) {
            return this.client.notice(nickName, `You are not the game owner, "${this.gameOwner}" is!`);
        }

        this.gameState = GAME_STATE_PROGRESS;

        this.client.send("MODE", this.channel, "+m");

        for (const playerNick in this.players) {
            console.log("sendPlayerCards", playerNick);
            this.sendPlayerCards(playerNick);
        }

        console.log("DP", this.deck.cards, this.pile);

        // set top card
        this.moveCards(this.deck.cards, this.pile, 1);

        console.log(this.pile)

        this.client.say(this.channel, "Game Started, Top Card is " + colourize.card(this.pile[0]));

        this.doTurn()

    }

    moveCards(deck1, deck2, count = 1) {
        const cards = deck1.splice(0, count);

        for (const cardIdx in cards) {
            console.log("move", count, "to deck", cards[cardIdx]);
            deck2.unshift(cards[cardIdx]);
        }

        console.log("deck now2", deck2);
    }

    givePlayerCards(gameDeck, playerNick, count = 7) {
        const cards = gameDeck.splice(0, count);

        const player = this.players[playerNick];

        console.log("move", count, "cards", cards, "to deck", player.cards);
        player.cards = player.cards.concat(cards);

        console.log("player cards now", player.cards);
    }

    removePlayerCard(player, gamePile, cardId) {
        const cardFromHand = player.cards.filter(card => card == cardId);
        gamePile.push(cardFromHand[0]);
    }

    sendPlayerCards(playerNick) {
        const { nick, cards, } = this.players[playerNick];

        const cardsString = colourize.deck(cards);
        this.client.notice(nick, cardsString.join(", "));
    }

    getNextPlayerIndex() {

        // how many index to advance each turn
        const turnCounter = 1

        let nextIndex;

        if (this.reverse) {
            nextIndex = this.turnIndex + turnCounter
        } else {
            nextIndex = this.turnIndex - turnCounter
        }

        if (nextIndex > Object.keys(this.players).length) {
            nextIndex = 0
        }

        if (nextIndex < 0) {
            nextIndex = Object.keys(this.players).length
        }

        return nextIndex
    }

    getIndexForNick(nickName) {

        for (const playerIndex in this.players) {
            if (this.players[playerIndex].nick == nickName) {
                return playerIndex;
            }
        }

        return false;
    }


    skipTurn() {
        this.turnIndex = this.getNextPlayerIndex();
    }

    // returns a player given an index in this.players.length.
    getPlayerByIndex(playerIndex) {
        const playerKeyArray = Object.keys(this.players);
        return playerKeyArray[playerIndex];
    }



    // # doTurn() - Initiates the current player's turn.
    doTurn() {

        // advance turn / start turns....
        if (this.turnIndex === false) {
            this.turnIndex = 0;
        }
        else {
            this.turnIndex = this.getNextPlayerIndex();
        }

        // first turn cant p[ass]
        this.canPass = false;

        const player = this.getPlayerByIndex(this.turnIndex);

        this.sendPlayerCards(player.nick);

        this.client.say(this.gameChannel, player.nick + "'s turn!");

    }


    resetGame() {

        this.client.send("MODE", this.gameChannel, "-m");

        this.takePlayerHop(this.gameOwner);

        for (const playerNick in this.players) {
            if (playerNick !== this.gameOwner)
                this.takePlayerVoice(playerNick);
        }

        this.state = GAME_STATE_STOPPED
        this.deck = []
        this.gamePile = []
        this.players = {}
        this.turnIndex = 0
        this.reverse = false
        this.canPass = false
    }



}
