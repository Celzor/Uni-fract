// based on https://github.com/aripalo/node-irc-bot

const irc = require('irc');
const config = require('./config.js');

const Controller = require('./src/Controller.js');

class Bot {

    constructor() {
        console.info("Bot() constructor!");

        this.client = new irc.Client(
            config.server,
            config.userName,
            config
        );

        this.gameController = new Controller();

        this.client.addListener("registered", () => {
            console.log("registered " + config.server);
            this.gameController.setClient(this.client);
            this.client.join(config.gameChannel);
        });

        this.client.addListener('error', (error) => {
            console.log('error: ', error);
        });

        this.client.addListener("join" + config.gameChannel, (channel, nick, message) => {
            try {
                this.gameController.onJoin(channel, nick, message);
            } catch (error) {
                console.error("join listener error", error.toString());
                this.messageAdmins(error.toString())
            }
        });

        this.client.addListener('message' + config.gameChannel, (from, to, text, message) => {
            try {
                this.gameController.onMessage(from, to, text, message);
            } catch (error) {
                console.error("message listener error", error);
                this.messageAdmins(error.toString())
            }
        });

    }

    messageAdmins(message) {
        config.admins.forEach(adminNick => {
            this.client.say(adminNick, message);
        });
    }

}

const bot = new Bot();