export const XVNC_BUTTONS = {
    LEFT_BUTTON: 1,
    MIDDLE_BUTTON: 2,
    RIGHT_BUTTON: 3,
    TURN_SCROLL_WHEEL_UP: 4,
    TURN_SCROLL_WHEEL_DOWN: 5,
    PUSH_SCROLL_WHEEL_LEFT: 6,
    PUSH_SCROLL_WHEEL_RIGHT: 7,
    BACK_BUTTON: 8,
    FORWARD_BUTTON: 9
};

export function xvncButtonToMask(xvncButton) {
    return 1 << (xvncButton - 1);
}

export default class MouseButtonMapper {
    constructor() {
        this.map = new Map();
    }

    get(mouseButton) {
        if (!this.map.has(mouseButton)) {
            return mouseButton;
        }

        return this.map.get(mouseButton);
    }

    set(mouseButton, xorgMouseButton) {
        return this.map.set(mouseButton, xorgMouseButton);
    }

    delete(mouseButton) {
        return this.map.delete(mouseButton);
    }

    dump() {
        return JSON.stringify(this.map, this._replacer);
    }

    load(json) {
        this.map = JSON.parse(json, this._reviver);
    }

    _replacer(key, value) {
        if (!(value instanceof Map)) {
            return value;
        }

        return {
            dataType: 'Map',
            value: Array.from(value.entries())
        };
    }

    _reviver(key, value) {
        if (typeof value === 'object' && value !== null) {
            if (value.dataType === 'Map') {
                return new Map(value.value);
            }
        }
        return value;
    }
}

export { MouseButtonMapper };
