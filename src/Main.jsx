import React from 'react';
import { connect } from "react-redux";

import gameConnection from './interface/connection.js';

import Connect from './components/Connect.jsx';
import MainGame from './components/MainGame.jsx';
import ChatWindow from './components/ChatWindow.jsx';

import './scss/Main.scss';
class Main extends React.Component {
    render() {

        if (this.props.isConnected) {

            return <>
                <MainGame />
                <ChatWindow />
            </>;

        }

        return (
            <Connect />
        );

    }
}

const mapStateToProps = (state) => {
    return {
        isConnected: state.ircReducer.isConnected,
    }
};

export default connect(
    mapStateToProps
)(Main);
