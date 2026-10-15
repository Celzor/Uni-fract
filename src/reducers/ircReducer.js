import gameConnection from '../interface/connection.js';

export const setNickname = nickName => {
    return {
        type: 'setNickname',
        nickName
    };
};

export const tryConnect = () => {
    return {
        type: 'tryConnect',
    };
};

export const setIsConnected = isConnected => {
    return {
        type: 'setIsConnected',
        isConnected
    };
};

export const setInChannel = inChannel => {
    return {
        type: 'setInChannel',
        inChannel
    };
};

const initialState = {
    nickName: "nono_bot_" + Math.floor((Math.random() * 1000) + 1).toString(),
    isConnected: false,
    inChannel: false,
};

const ircReducer = (state = initialState, action = {}) => {
    switch (action.type) {

        case 'setNickname':
            console.log("nickName", action.nickName);
            return {
                ...state,
                nickName: action.nickName
            };

        case 'tryConnect':
            console.log("tryConnect", state.nickName);
            gameConnection.connectWebSocket(state.nickName);
            return state;

        case 'setIsConnected':
            console.log("isConnected", action.isConnected);
            return {
                ...state,
                isConnected: action.isConnected
            };

        case 'setInChannel':
            console.log("inChannel", action.inChannel);
            return {
                ...state,
                inChannel: action.inChannel
            };

        default:
            return state;
    }
};

export default ircReducer;
