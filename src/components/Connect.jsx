import React from 'react';
import { connect } from "react-redux";

import { setNickname, tryConnect, } from "../reducers/ircReducer";

class Connect extends React.Component {
    render() {
        return (
            <div id="connect">
                <div className="inner">
                    <div className="title">NOno Videographical Game</div>

                    <div className="connection-info">
                        <div>Nickname:</div>
                        <p>
                            <input type="text"
                                value={this.props.nickName}
                                onChange={event => this.props.setNickname(event.target.value)} />
                            <button
                                onClick={() => this.props.tryConnect()} >
                                Connect!
                        </button>
                        </p>
                    </div>
                </div>
            </div>
        );
    }
}

const mapStateToProps = (state) => {
    return {
        nickName: state.ircReducer.nickName,
    }
};

const mapDispatchToProps = (dispatch) => {
    return {
        setNickname: (newNickname) => dispatch(setNickname(newNickname)),
        tryConnect: () => dispatch(tryConnect()),
    }
}

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(Connect);
