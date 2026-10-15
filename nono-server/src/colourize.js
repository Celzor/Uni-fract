const chalk = require('chalk');

String.prototype.leftJustify = function (length, char) {
    var fill = [];
    while (fill.length + this.length < length) {
        fill[fill.length] = char;
    }
    return fill.join('') + this;
}

String.prototype.rightJustify = function (length, char) {
    var fill = [];
    while (fill.length + this.length < length) {
        fill[fill.length] = char;
    }
    return this + fill.join('');
}

module.exports = class colourize {

    static deck(cardArray) {
        return cardArray.map(card => colourize.card(card));
    }

    static card(cardString) {
        const firstChar = cardString.substr(0, 1);

        const colors = {
            "r": { "fg": 0, "bg": 4 },
            "g": { "fg": 0, "bg": 3 },
            "b": { "fg": 0, "bg": 12 },
            "y": { "fg": 1, "bg": 8 },
            "w": { "fg": 0, "bg": 1 }
        };

        if (colors.hasOwnProperty(firstChar)) {

            const cardColorCode = this.colorCode(colors[firstChar]);

            const cardValue = cardColorCode + cardString + "\x0F";
            console.log("cardValue", cardValue)

            return cardValue;
        }

        return cardString;
    }

    static colorCode({ fg, bg }) {
        // # colours:
        // #  fg - foreground
        // #  bg - background

        let code = `\x03`

        // # If we have a foreground, hopefully, add that.
        if (!fg)
            code = code + String(fg).rightJustify(2, '0')

        // # If no foreground is specifified, assume it to want 01(black).
        // # otherwise assume one was infact specified.
        if (bg && !fg)
            code = code + '01,' + String(bg).rightJustify(2, '0')
        else if (bg) {
            code = code + ',' + String(bg).rightJustify(2, '0')
        }


        return code
    }


}
