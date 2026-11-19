export const MAX_FB_DIMENSION = 8192;
export const MAX_FB_SPAN = 32767;
export const MAX_FB_PIXELS = MAX_FB_DIMENSION * MAX_FB_DIMENSION;
export const FB_LIMIT_TEXT = `(max ${MAX_FB_SPAN} per side, ${MAX_FB_PIXELS} pixels)`;

export function clampDimension(value) {
    const whole = Math.floor(value);
    if (Number.isNaN(whole)) {
        return 0;
    }
    return Math.min(Math.max(0, whole), MAX_FB_SPAN);
}

export function isValidFbSize(width, height) {
    return Number.isFinite(width) && Number.isFinite(height) &&
        width > 0 && width <= MAX_FB_SPAN &&
        height > 0 && height <= MAX_FB_SPAN &&
        width * height <= MAX_FB_PIXELS;
}
