import React from 'react';
import { Provider } from 'react-redux';

import store from './store';
import Main from './Main.jsx';

export default class App extends React.Component {

    constructor(props) {
        super(props);

    }

    render() {
        return (
            <Provider store={store}>
                <Main />
            </Provider>
        );

    }
}