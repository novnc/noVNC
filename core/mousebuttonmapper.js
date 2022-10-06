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
