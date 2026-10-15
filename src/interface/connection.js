
import { stripColorsAndStyle } from "irc-colors";
import store from '../store';

import { setIsConnected, setInChannel, setNickname, } from "../reducers/ircReducer";
import { addMessage, } from "../reducers/chatReducer";
import {
    gameStopped,
    gameStarting,
    gameStarted,
    gameOwner,
    gameHand,
    playerJoined,
    topCard,
    playerTurn,
    playerCardCount,
} from "../reducers/gameReducer";

class Connection {

    constructor() {

        this.connected = false;
        this.websocket = null;

        this.nickname = "";

        this.server = {
            uri: "wss://irc.connct.online/",
            channelName: "#Uno",
            channelKey: "",
            unoBotHost: "UnoBot!UnoBot@games.connct.online",
        };

    }

    getNickname() {
        return this.nickname;
    }

    setConnected(isConnected) {
        this.connected = isConnected;
        store.dispatch(setIsConnected(isConnected));
    }

    doSend(message) {
        if (this.connected) {
            console.info(">>> ", message);
            this.websocket.send(message + "\n");
        } else {
            console.warn("dosend with not connected", message)
        }
    }

    sendChannel(message) {
        this.doSend("privmsg " + this.server.channelName + " :" + message);
    }

    connectWebSocket(nickName) {
        this.nickname = nickName;

        this.websocket = new WebSocket(this.server.uri);

        this.websocket.onopen = (evt) => {
            this.setConnected(true);

            store.dispatch(setNickname(nickName));
            this.doSend("user websocket * * :Online User");
            this.doSend("nick " + this.nickname);
        }

        this.websocket.onclose = (evt) => {
            this.setConnected(false);
        };

        this.websocket.onmessage = (evt) => {
            const rawData = evt.data;
            if (rawData instanceof Blob) { // binary
                var fileReader = new FileReader();
                fileReader.addEventListener("loadend", event => {
                    const fileReader = event.target;
                    this.process(fileReader.result);
                });
                fileReader.readAsText(rawData);
            }
            else { //text
                this.process(rawData);
            }
        };

        this.websocket.onerror = (evt) => {
            this.setConnected(false);

            console.error("wss error!", evt);
        };

    }

    process(rawData) {
        const parsedMessage = this.parseMessage(rawData);
        console.info("<<< ", parsedMessage);

        switch (parsedMessage.command) {

            // respond to IRC PING
            case "PING":
                this.doSend("PONG :" + parsedMessage.params[0]);
                break;

            // IRC connect
            case "001":
                // join channel upon connection (optional key)
                const joinCommand = "JOIN " + this.server.channelName;
                if (this.server.channelKey != "") {
                    joinCommand += " " + this.server.channelKey;
                }
                this.doSend(joinCommand);
                break;

            case "JOIN":
                // if the user joined our channel
                if (parsedMessage.params[0] == this.server.channelName) {
                    store.dispatch(setInChannel(true));
                    store.dispatch(addMessage(parsedMessage));
                }
                break;

            case "QUIT":
                store.dispatch(addMessage(parsedMessage));
                break;

            // error talking/etc
            case "404":

                // send msg to chat window
                store.dispatch(addMessage(parsedMessage));

                if (parsedMessage.params[2] == "You need voice (+v) (#Uno)") {
                    console.log("game already in progress", parsedMessage);
                    store.dispatch(gameStarted());
                }
                break;

            case "PRIVMSG":
                // only messages in assigned channel
                if (parsedMessage.params[0] == this.server.channelName) {
                    this.processChannelMessage(parsedMessage);
                }
                break;

            case "NOTICE":
                // notices from nono bot
                if (parsedMessage.prefix.indexOf(this.server.unoBotHost) !== -1) {
                    this.processBotNotice(parsedMessage);
                }
                break;

        };

    }

    processChannelMessage(parsedMessage) {
        console.warn("processChannelMessage", parsedMessage);
        const messageString = parsedMessage.params[1];

        // send msg to chat window
        store.dispatch(addMessage(parsedMessage));

        //////////////// GAME STATE

        if (messageString.indexOf(" stopped the current game.") !== -1) {
            console.log("game stopped", parsedMessage);
            store.dispatch(gameStopped());
        }

        if (messageString.indexOf(" has created a game lobby for Uno. Players can now \"join\".") !== -1) {
            console.log("game started", parsedMessage);

            const cleanOwner = messageString.split(" ")[0];
            console.log("cleanOwner", cleanOwner);

            store.dispatch(gameOwner(cleanOwner));
            store.dispatch(gameStarting());
            store.dispatch(playerJoined(cleanOwner));
        }

        if (messageString.indexOf(" has won the game!") !== -1) {
            console.log("game FINISHED", parsedMessage);

            store.dispatch(gameStopped());
        }

        if (messageString.indexOf(" has joined the game!") !== -1) {
            console.log("player joined", parsedMessage);
            const joiningPlayer = messageString.replace(" has joined the game!", "");

            store.dispatch(gameStarting());
            store.dispatch(playerJoined(joiningPlayer));
        }

        //////////////// TOP CARD

        // someone playes "gamerx played \u000300,04r8\u000f."
        if (messageString.indexOf(" played ") !== -1) {
            let cleanInput = messageString.split(" played ")[1];
            cleanInput = cleanInput.substring(0, cleanInput.length - 1);

            console.warn("top", topCard);
            store.dispatch(topCard(stripColorsAndStyle(cleanInput)));
        }

        // game start "Game Started, Top Card is \u000300,12b0\u000f"
        if (
            messageString.startsWith("Game Started, Top Card is ")
        ) {
            const cleanInput = messageString.replace("Game Started, Top Card is ", "").trim();

            console.warn("top", topCard);
            store.dispatch(topCard(stripColorsAndStyle(cleanInput)));
            store.dispatch(gameStarted());
        }

        //////////////// TURN

        if (messageString.indexOf("'s turn!") !== -1) {
            let whosTurn = messageString.replace("'s turn!", "");
            whosTurn = whosTurn.replace("It's currently ", "");

            console.warn("whosTurn", whosTurn);
            store.dispatch(playerTurn(whosTurn));
        }

        //////////////// cards played/count

        if (messageString.indexOf(" drew a card. They now have") !== -1) {

            const extracted = /([a-zA-Z0-9_-]+) drew a card. They now have ([0-9]+) cards./.exec(messageString);
            console.log("extracted", extracted);

            store.dispatch(playerCardCount(extracted[1], extracted[2]));
        }

        if (messageString.indexOf(" now has") !== -1 && messageString.indexOf(" cards left.") !== -1) {

            const extracted = /([a-zA-Z0-9_-]+) now has ([0-9]+) cards left./.exec(messageString);
            console.log("extracted", extracted);

            store.dispatch(playerCardCount(extracted[1], extracted[2]));
        }

        if (messageString.indexOf(" draws ") !== -1 && messageString.indexOf(" cards.") !== -1) {

            const extracted = /([a-zA-Z0-9_-]+) draws ([two|four]{1}) cards./.exec(messageString);
            console.log("extracted", extracted);

            let pickupCount = 0;
            if (extracted[2] == "two") {
                pickupCount = 2;
            } else if (extracted[2] == "four") {
                pickupCount = 4;
            }

            store.dispatch(playerDrawCards(extracted[1], pickupCount));
        }





    }

    processBotNotice(parsedMessage) {
        console.warn("processNotice", parsedMessage);
        const noticeString = parsedMessage.params[1]

        // send msg to chat window
        store.dispatch(addMessage(parsedMessage));

        // response to "turn" when no game
        if (noticeString == "No game in progress.") {
            console.log("no game in progress", parsedMessage);
            store.dispatch(gameStopped());
        }

        // game owner "You need to use \"deal\" when you are ready to start your game."
        if (noticeString == "You need to use \"deal\" when you are ready to start your game.") {
            console.log("user is game owner", this.nickname);
            store.dispatch(gameOwner(this.nickname));
        }

        // hand notice "Hand: \u000300,04r9\u000f \u000300,01wd4\u000f \u000300,03gs\u000f \u000300,01w\u000f \u000300,03g5\u000f \u000300,03g7\u000f \u000300,12bd2\u000f "
        if (noticeString.startsWith("Hand: ")) {

            // stript crap, extrat cards
            const handFull = noticeString.substr(6).trim();
            const handFlat = stripColorsAndStyle(handFull);

            console.warn("hand", handFlat);
            const cardsArray = handFlat.split(" ");

            store.dispatch(gameHand(cardsArray));
        }

    }





    parseMessage(inputRaw) {
        let text = inputRaw;

        // prefix
        if (text.charAt(0) === ':') {
            var i = text.indexOf(' ');
            var prefix = text.slice(1, i);
            text = text.slice(i + 1);
        }

        // command
        var i = text.indexOf(' ');
        if (i === -1) i = text.length;
        var command = text.slice(0, i);
        text = text.slice(i + 1);

        var params = [];

        // middle
        while (text && text.charAt(0) !== ':') {
            var i = text.indexOf(' ');
            if (i === -1) i = text.length;
            params.push(text.slice(0, i));
            text = text.slice(i + 1);
        }

        // trailing
        if (text) params.push(text.slice(1));

        return {
            raw: inputRaw,
            prefix: prefix,
            command: command,
            params: params
        };
    }

}

const connectionInstance = new Connection();
export default connectionInstance;
