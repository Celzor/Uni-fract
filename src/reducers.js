import { combineReducers } from 'redux';

import ircReducer from './reducers/ircReducer';
import gameReducer from './reducers/gameReducer';
import chatReducer from './reducers/chatReducer';

const reducers = combineReducers({
    ircReducer,
    gameReducer,
    chatReducer,
});

export default reducers;
