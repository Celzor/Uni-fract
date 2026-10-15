import React from 'react';
import { connect } from "react-redux";

import gameConnection from '../interface/connection.js';

class GameStatus extends React.Component {
    render() {

        const userNick = gameConnection.getNickname();
        const turn = this.props.turn;

        let appendColor = "";
        if (turn == userNick) {
            console.log(userNick, turn);
            appendColor = " yourturn"
        }

        let stateNames = [
            "Stopped",
            "Lobby",
            "Started"
        ];

        return (
            <div className={"game-stats" + appendColor} >

                <input type="submit" name="submit" id="submit" value="CHECK TURN" onClick={() => gameConnection.sendChannel("turn")} />
                <br />
                <p className="text-section">
                    Game State: {stateNames[this.props.status]}<br />
                    {this.props.turn && `Whos Turn: ${this.props.turn}`}<br />
                    <br />
                    Player List:<br />
                </p>
                <select className="user-list" multiple>
                    {this.props.players && Object.keys(this.props.players)
                        .map(nick => {
                            const playerData = this.props.players[nick];

                            if (nick == userNick) {
                                return (<option value={nick} key={nick}>&middot; {nick} (You!) - {playerData} cards!</option>);
                            }

                            return (<option value={nick} key={nick}>&middot; {nick} - {playerData} cards!</option>);
                        })}
                </select>
            </div>
        );
    }

}

const mapStateToProps = (state) => {
    return {
        status: state.gameReducer.status,
        owner: state.gameReducer.owner,
        turn: state.gameReducer.turn,
        players: state.gameReducer.players,
        hand: state.gameReducer.hand,
        top: state.gameReducer.top,
    }
};

export default connect(
    mapStateToProps,
)(GameStatus);
