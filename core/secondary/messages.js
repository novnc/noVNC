import { MAX_FB_SPAN, MAX_FB_PIXELS } from '../util/fb-limits.js';
import { POINTER_BUTTON_MASK } from './constants.js';

export function validPointerArgs(eventType, args) {
    if (!Array.isArray(args) || !Number.isFinite(args[0]) || !Number.isFinite(args[1])) { return false; }
    if (eventType === 'mousedown' || eventType === 'mouseup') {
        return Number.isInteger(args[2]) && args[2] >= 0 && args[2] <= POINTER_BUTTON_MASK;
    }
    if (eventType === 'scroll') {
        return Number.isFinite(args[2]) && Number.isFinite(args[3]);
    }
    return true;
}

export function validKeyArgs(args) {
    return Array.isArray(args) && args.length === 2 &&
        Number.isInteger(args[0]) && (args[1] === 0 || args[1] === 1);
}

export function validClipboardArgs(args) {
    if (!Array.isArray(args) || !Array.isArray(args[0]) || !Array.isArray(args[1])) { return false; }
    const [dataset, mimes] = args;
    return dataset.length === mimes.length && dataset.length <= 255 &&
        mimes.every(m => typeof m === 'string' && m.length <= 255) &&
        dataset.every(d => d && Number.isFinite(d.length));
}

export function validScreenGeometry(data) {
    const within = (value, max) => Number.isFinite(value) && value >= 0 && value <= max;
    const factor = value => within(value, 64);
    return within(data.width, MAX_FB_SPAN) && within(data.height, MAX_FB_SPAN) &&
        within(data.serverWidth, MAX_FB_SPAN) && within(data.serverHeight, MAX_FB_SPAN) &&
        within(data.x, MAX_FB_SPAN) && within(data.y, MAX_FB_SPAN) &&
        within(data.containerWidth, MAX_FB_SPAN) && within(data.containerHeight, MAX_FB_SPAN) &&
        data.serverWidth * data.serverHeight <= MAX_FB_PIXELS &&
        data.x + data.serverWidth <= MAX_FB_SPAN && data.y + data.serverHeight <= MAX_FB_SPAN &&
        factor(data.pixelRatio) && factor(data.scale);
}
