
export const addMessage = parsedMessage => {
    console.log("addMessage", parsedMessage);
    return {
        type: 'addMessage',
        parsedMessage
    };
};

const initialState = {
    messageHistory: [],
};

const chatReducer = (state = initialState, action = {}) => {
    switch (action.type) {

        case 'addMessage':
            return {
                messageHistory: [
                    ...state.messageHistory,
                    action.parsedMessage,
                ],
            };

        default:
            return state;
    }
};

export default chatReducer;
