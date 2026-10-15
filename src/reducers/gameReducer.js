import gameConnection from '../interface/connection.js';

export const gameStopped = () => {
    console.log("gameStopped");
    return {
        type: 'gameStopped',
    };
};
export const gameStarting = () => {
    console.log("gameStarting");
    return {
        type: 'gameStarting',
    };
};
export const gameStarted = () => {
    console.log("gameStarted");
    return {
        type: 'gameStarted',
    };
};

export const gameOwner = gameOwner => {
    console.log("gameOwner", gameOwner);
    return {
        type: 'gameOwner',
        gameOwner
    };
};

export const gameHand = gameHand => {
    console.log("gameHand", gameHand);
    return {
        type: 'gameHand',
        gameHand
    };
};

export const playerJoined = playerName => {
    console.log("playerJoined", playerName);
    return {
        type: 'playerJoined',
        playerName
    };
};

export const playerCardCount = (playerName, cardCount) => {
    console.log("playerCardCount", playerName, cardCount);
    return {
        type: 'playerCardCount',
        playerName,
        cardCount
    };
};

export const playerDrawCards = (playerName, drawAmount) => {
    console.log("playerDrawCards", playerName, drawAmount);
    return {
        type: 'playerDrawCards',
        playerName,
        drawAmount
    };
};

export const topCard = topCard => {
    console.log("topCard", topCard);
    return {
        type: 'topCard',
        topCard
    };
};

export const playerTurn = playerTurn => {
    console.log("playerTurn", playerTurn);
    return {
        type: 'playerTurn',
        playerTurn
    };
};

const initialState = {
    status: 0, // game status; 0,1,2
    turn: false, // the player name of the current turn
    owner: "", // game owner name
    isJoined: false, // is joined
    players: [],
    hand: [],
    top: false,
};

const UNO_STATE_STOPPED = 0;
const UNO_STATE_STARTING = 1;
const UNO_STATE_STARTED = 2;

const gameReducer = (state = initialState, action = {}) => {
    switch (action.type) {

        case 'gameStopped':
            return {
                ...state,
                status: UNO_STATE_STOPPED,
                turn: false,
                owner: "",
                isJoined: false,
                players: [],
                hand: [],
                top: false,
            };

        case 'gameStarting':
            return {
                ...state,
                status: UNO_STATE_STARTING,
            };

        case 'gameStarted':
            return {
                ...state,
                status: UNO_STATE_STARTED,
            };

        case 'gameOwner':
            return {
                ...state,
                owner: action.gameOwner,
            };

        case 'gameHand':
            return {
                ...state,
                hand: action.gameHand,
            };

        case 'playerJoined':

            // set joined if it's our player
            if (action.playerName == gameConnection.getNickname()) {
                return {
                    ...state,
                    isJoined: true,
                    players: {
                        ...state.players,
                        [action.playerName]: 7,
                    },
                };
            }

            return {
                ...state,
                players: {
                    ...state.players,
                    [action.playerName]: 7,
                },
            };

        case 'playerCardCount':
            return {
                ...state,
                players: {
                    ...state.players,
                    [action.playerName]: action.cardCount,
                },
            };

        case 'playerDrawCards':
            if (state.players[action.playerName]) {
                drawAmount = state.players[action.playerName] + drawAmount;
            }

            return {
                ...state,
                players: {
                    ...state.players,
                    [action.playerName]: drawAmount,
                },
            };

        case 'topCard':
            return {
                ...state,
                top: action.topCard,
            };

        case 'playerTurn':

            // check if it's our player
            if (action.playerTurn == gameConnection.getNickname()) {
                new Audio('audio/nudge.mp3').play();
            }

            return {
                ...state,
                turn: action.playerTurn,
            };

        default:
            return state;
    }
};

export default gameReducer;
