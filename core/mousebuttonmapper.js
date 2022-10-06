export const XVNC_BUTTONS = {
    LEFT_BUTTON: 0,
    MIDDLE_BUTTON: 1,
    RIGHT_BUTTON: 2,
    TURN_SCROLL_WHEEL_UP: 3,
    TURN_SCROLL_WHEEL_DOWN: 4,
    PUSH_SCROLL_WHEEL_LEFT: 5,
    PUSH_SCROLL_WHEEL_RIGHT: 6,
    BACK_BUTTON: 7,
    FORWARD_BUTTON: 8
};

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
