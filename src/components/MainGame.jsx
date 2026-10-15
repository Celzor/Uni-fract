import React from 'react';
import { connect } from "react-redux";

import gameConnection from '../interface/connection.js';

import {
    playerTurn,
} from "../reducers/gameReducer";

import GameStatus from "./GameStatus.jsx"
class MainGame extends React.Component {

    playCard(cardId) {
        let cardCommand = "p " + cardId;

        // select w color
        if (cardId.indexOf("w") == 0) {
            const selectedColor = prompt("please select color, from [b, blue, r, red, g, green, y, yellow]");
            if (selectedColor != null) {
                cardCommand += " " + selectedColor;
                gameConnection.sendChannel(cardCommand);
                this.props.playerTurn(false);
            }
        }

        else {
            gameConnection.sendChannel(cardCommand);
            this.props.playerTurn(false);
        }
    }

    render() {

        // just color code
        let topPath = false;
        if (this.props.top.length > 1) {
            topPath = <img src={`cards/${this.props.top}.png`} />;
        }

        const userNick = gameConnection.getNickname();
        const turn = this.props.turn;

        let appendColor = "";
        if (this.props.turn == gameConnection.getNickname()) {
            console.log(userNick, turn);
            appendColor = " yourturn"
        }

        return (
            <div id="maingame">
                <div className="top">
                    Top Card<br />
                    <div className="card-container">
                        {topPath && topPath}
                        {this.props.top && this.props.top.toUpperCase()}
                        {!this.props.top && "NOTHING!"}
                    </div>
                </div>
                <div className="hand">
                    Your Hand<br />
                    <div className="card-container">
                        <div className={this.props.turn == gameConnection.getNickname() ? "overlay" : "overlay on"}></div>
                        {this.props.hand.map(card => {
                            let playableCard = false;

                            // colored card
                            if (
                                this.props.top && (
                                    this.props.top.indexOf("b") == 0 ||
                                    this.props.top.indexOf("g") == 0 ||
                                    this.props.top.indexOf("r") == 0 ||
                                    this.props.top.indexOf("y") == 0
                                )
                            ) {
                                // matching color
                                if (this.props.top.substr(0, 1) == card.substr(0, 1)) {
                                    playableCard = true;
                                }

                                // same card class
                                if (this.props.top.substr(1, 3) == card.substr(1, 3)) {
                                    playableCard = true;
                                }
                            }

                            if (card.indexOf("w") == 0) {
                                playableCard = true;
                            }

                            if (this.props.top && this.props.top.indexOf("w") == 0) {
                                playableCard = true;
                            }

                            let cardClasses = "card";
                            if (!playableCard) {
                                cardClasses += " unavailable";

                            }

                            return <div className={cardClasses} onClick={() => this.playCard(card)}>
                                <img tooltip={card.toUpperCase()} src={`cards/${card}.png`} />
                                <div className="card-name">{card.toUpperCase()}</div>
                            </div>;
                        })}
                        <div className="buttons-attach">
                            <button
                                disabled={!this.props.inChannel || this.props.nickName !== this.props.turn}
                                onClick={() => gameConnection.sendChannel("draw")} >
                                DRAW
                            </button>
                            <button
                                disabled={!this.props.inChannel || this.props.nickName !== this.props.turn}
                                onClick={() => gameConnection.sendChannel("pass")} >
                                PASS
                            </button>
                        </div>
                    </div>
                </div>

                <GameStatus
                    players={this.props.players}
                    status={this.props.status}
                    turn={this.props.turn} />
            </div>
        );
    }

}

const mapStateToProps = (state) => {
    return {
        inChannel: state.ircReducer.inChannel,
        nickName: state.ircReducer.nickName,

        status: state.gameReducer.status,
        owner: state.gameReducer.owner,
        turn: state.gameReducer.turn,
        players: state.gameReducer.players,
        hand: state.gameReducer.hand,
        top: state.gameReducer.top,
    }
};

const mapDispatchToProps = (dispatch) => {
    return {
        playerTurn: playerName => dispatch(playerTurn(playerName))
    }
}

export default connect(
    mapStateToProps,
    mapDispatchToProps,
)(MainGame);
