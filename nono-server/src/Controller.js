
const config = require('../config.js');

const Game = require('./Game.js');

const GAME_STATE_STOPPED = 0;
const GAME_STATE_LOBBY = 1;
const GAME_STATE_PROGRESS = 2;

module.exports = class Controller {

    // ----------------------------------------------------------------------------------
    // ------- Command Handlers ---------------------------------------------------------
    // ----------------------------------------------------------------------------------

    constructor() {
        this.gameChannel = config.gameChannel;

        this.client = null;
        this.game = null;

        this.state = GAME_STATE_STOPPED
    }

    setClient(client) {
        this.client = client;
    }

    onMessage(from, messageText, messageObject) {
        // deal with lower case message args
        const messageArgs = messageText.toLowerCase().split(" ");
        const firstParm = messageArgs[0];

        switch (firstParm) {

            case "nono":
                console.log(`Calling handler: ${firstParm} because: ${from} => ${this.gameChannel}: ${messageText}`);
                this.commandNono(from, messageArgs);
                break;

            case "join":
                console.log(`Calling handler: ${firstParm} because: ${from} => ${this.gameChannel}: ${messageText}`);
                this.commandJoin(from, messageArgs);
                break;

            case "stop":
                console.log(`Calling handler: ${firstParm} because: ${from} => ${this.gameChannel}: ${messageText}`);

                break;

            case "deal":
                console.log(`Calling handler: ${firstParm} because: ${from} => ${this.gameChannel}: ${messageText}`);
                this.commandDeal(from, messageArgs);
                break;

            case "play":
            case "p":
                break;

            case "draw":
            case "d":
                break;

            case "pass":
                break;

            case "cards":
                break;

            case "hand":
                break;

            case "top":
                break;

            case "turn":
                break;

            case "admin":
                if (this.isBotAdmin(from)) {

                    this.client.say(this.gameChannel, "TEST SEQUENCE STARTING");

                    this.commandNono(from);


                    this.commandJoin("test1");
                    this.commandJoin("test2");

                    this.commandDeal(from);






                }
                break;

            case "help":
                break;

            case "commands":
                break;

            default:
                break;
        }

    }

    onJoin(nick, message) {
        console.log(nick, message);

    }

    /**
     * 	# commandNono() - Begins a new game of Uno.
		# - Checks is game is running.
		# - Creates a new deck, shuffles it.
		# - Creates a new pile.
		# - Sets up the channel target.
		# - Sets current state to GAME_STATE_LOBBY
		# - Announces game started.
		# - Set the current user to the game owner.
		# - Add the current player to the game.
     */
    commandNono(fromNick, messageArgs) {

        this.client.say(this.gameChannel, "Called commandNono(" + fromNick + ", " + JSON.stringify(messageArgs) + ")");

        if (this.state == GAME_STATE_STOPPED) {

            this.game = new Game(this.client, this.gameChannel, fromNick);
            this.state = GAME_STATE_LOBBY

            // Print some messages.
            this.client.say(this.gameChannel, fromNick + " has created a game lobby for Uno. Players can now \"join\".")
            this.client.notice(fromNick, "You need to use \"deal\" when you are ready to start your game.")

            this.givePlayerHop(fromNick);
        }

        else if (this.state == GAME_STATE_LOBBY || this.state == GAME_STATE_PROGRESS) {
            // call join game command
            this.commandJoin(fromNick, messageArgs)
        }

    }

    /**
     *  # commandJoin() - Allows player to join the current game.
		# - Checks game is in progress.
		# - Checks the player is not in the game.
		# - Adds the player to the game.
	
     */
    commandJoin(fromNick, messageArgs) {

        if (this.state == GAME_STATE_LOBBY) {

            if (!this.game.isPlayerJoined(fromNick)) {

                console.log("joinPlayer", fromNick, this.state);
                this.game.joinPlayer(fromNick)
                this.client.send('MODE', this.gameChannel, '+v', fromNick);
            }

            else {
                this.client.notice(fromNick, "You are already in the current game.")
            }

        }

        else if (this.state == GAME_STATE_PROGRESS) {
            this.client.notice(fromNick, "You cannot join a game in progress.... Yet!")
        }

        else {
            this.client.notice(fromNick, "There is no current game, you can create one using \"uno\".")
        }

    }


    /**
     * 	# commandDeal() - Starts the game by dealing cards.
		# - Checks game is in lobby state.
		# - Deals cards to the players.
     */
    commandDeal(fromNick, messageArgs) {

        if (this.state == GAME_STATE_LOBBY) {

            if (fromNick == this.gameOwner || this.isBotAdmin(fromNick)) {
                this.game.start(fromNick);
            }

            else {
                this.client.notice(fromNick, "You need to be the owner of the game to start it.")
            }

        } else {
            this.client.notice(fromNick, "There is no current game, you can create one using \"uno\".")
        }

    }

    // givePlayerVoice() - Gives the player Voice (For players)
    givePlayerVoice(nickName) {
        this.client.send('MODE', this.gameChannel, '+v', nickName);
    }

    // givePlayerHop() - Give a player hop (party owner)
    givePlayerHop(nickName) {
        this.client.send('MODE', this.gameChannel, '+h', nickName);
    }

    // takePlayerVoice() - Takes the player Voice (For players)
    takePlayerVoice(nickName) {
        this.client.send('MODE', this.gameChannel, '-v', nickName);
    }

    // takePlayerHop() - Take a player hop (party owner)
    takePlayerHop(nickName) {
        this.client.send('MODE', this.gameChannel, '-h', nickName);
    }

    isBotAdmin(nickName) {
        return (config.admins.indexOf(nickName) !== -1);
    }

    deckString(cards) {
        return colourize.deck(cards);
    }
}
