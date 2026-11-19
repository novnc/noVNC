// Display reads its target's parent size, so the canvas needs a parent element
export default function makeCanvas() {
    const container = document.createElement('div');
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    return canvas;
}

// resize() alone leaves the primary screen's x2/y2 at 0, so rects below or to the
// right of the origin are not assigned to any screen. RFB sets them from the
// screen plan, tests have to do the same.
export function sizeDisplay(display, width, height) {
    display.resize(width, height);
    display.screens[0].x2 = width;
    display.screens[0].y2 = height;
}
