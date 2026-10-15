import React from 'react';
import { connect } from "react-redux";

import gameConnection from '../interface/connection.js';

import { addMessage, } from "../reducers/chatReducer";

import { stripColorsAndStyle } from "irc-colors";

const UNO_STATE_STOPPED = 0;
const UNO_STATE_STARTING = 1;
const UNO_STATE_STARTED = 2;

class ChatWindow extends React.Component {

    constructor(props) {
        super(props);

        this.state = {
            message: "",
        };
    }

    sendInput() {
        const inputMessage = this.state.message;
        console.log("inputMessage", inputMessage);

        gameConnection.sendChannel(inputMessage);

        this.setState({ message: "", });
    }

    sendString(stringToSend) {
        console.log("sendString", stringToSend);

        const userNick = gameConnection.getNickname();
        console.log("userNick", userNick);

        const ourSide = {
            prefix: userNick + "!fake",
            params: [
                "",
                stringToSend
            ],
        };
        this.props.addMessage(ourSide);
        gameConnection.sendChannel(inputMessage);

    }

    componentDidUpdate() {
        const el = this.refs.output;
        el.scrollTop = el.scrollHeight;
    }

    messageItems() {
        return this.props.messageHistory.map((message, index) => {

            // {
            //     "raw": ":nono_bot_716!websocket@52789176.9116A563.73DB4363.IP JOIN :#Uno",
            //     "prefix": "nono_bot_716!websocket@52789176.9116A563.73DB4363.IP",
            //     "command": "JOIN",
            //     "params": [
            //       "#Uno"
            //     ]
            //   }
            if (message.command == "JOIN") {
                return <p key={index}>{`>>> `} <strong>{message.prefix.split("!")[0]}</strong> has joined {message.params[0]}!</p>;

            }
            if (message.command == "QUIT") {
                return <p key={index}>{`<<< `} <strong>{message.prefix.split("!")[0]}</strong> has quit {message.params[0]}!</p>;

            }

            // {
            //     "raw": ":irc.connct.online 404 nono_bot_980 #Uno :You need voice (+v) (#Uno)",
            //     "prefix": "irc.connct.online",
            //     "command": "404",
            //     "params": [
            //       "nono_bot_980",
            //       "#Uno",
            //       "You need voice (+v) (#Uno)"
            //     ]
            //   }
            if (message.command == "404") {
                return <p key={index}> <strong>{message.params[1]}</strong>: {message.params[2]}</p>;

            }

            return <p key={index}><strong>{message.prefix.split("!")[0]}</strong>: {stripColorsAndStyle(message.params[1])}</p>;
        })
    }

    render() {


        // set joined if it's our player
        let isGameOwner = false;
        const userNick = gameConnection.getNickname();
        if (this.props.gameOwner == userNick) {
            isGameOwner = true;
        }

        return (
            <div id="chatwindow">

                <input type="submit" name="submit" id="submit" value="NEW GAME"
                    disabled={!this.props.inChannel || this.props.gameStatus !== UNO_STATE_STOPPED}
                    onClick={() => gameConnection.sendChannel("uno")} />

                <input type="submit" name="submit" id="submit" value="JOIN GAME"
                    disabled={!this.props.inChannel || this.props.gameStatus !== UNO_STATE_STARTING || this.props.isGameJoined}
                    onClick={() => gameConnection.sendChannel("join")} />

                <input type="submit" name="submit" id="submit" value="START GAME"
                    disabled={!this.props.inChannel || !isGameOwner || this.props.gameStatus !== UNO_STATE_STARTING}
                    onClick={() => gameConnection.sendChannel("deal")} />

                Nick: {userNick}
                {isGameOwner && ` | You are the Game Owner!`}
                {!isGameOwner && this.props.gameOwner !== "" && ` | Game Owner: ${this.props.gameOwner}`}

                <div id="output" ref='output' className="output">{!this.props.inChannel ? "joining channel..." : this.messageItems()}</div>


                <div className="chat-input">
                    <p>
                        <input type="text" name="input" id="input" size="60" value={this.state.message}
                            onKeyDown={event => {
                                if (event.key === 'Enter') {
                                    this.sendInput();
                                }
                            }}
                            onChange={event => this.setState({ message: event.target.value, })} />
                        <button
                            disabled={this.state.message == "" || !this.props.inChannel}
                            onClick={() => this.sendInput()} >
                            Send!
                        </button>
                    </p>
                </div>
            </div>
        );
    }

}

const mapStateToProps = (state) => {
    return {
        isConnected: state.ircReducer.isConnected,
        inChannel: state.ircReducer.inChannel,
        messageHistory: state.chatReducer.messageHistory,

        gameOwner: state.gameReducer.owner,
        isGameOwner: state.gameReducer.isOwner,
        gameStatus: state.gameReducer.status,
        isGameJoined: state.gameReducer.isJoined,
    }
};

export default connect(
    mapStateToProps,
)(ChatWindow);
