// core/display.js imports the whole app UI just to track secondary windows.
// Loading the real app/ui.js needs Vite and has side effects, so tests get this.
export default {
    registeredWindows: new Map([['primary', 'primary']]),
    displayWindows: new Map([['primary', 'primary']]),
};
