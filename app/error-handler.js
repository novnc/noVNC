/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

// Fallback for all uncaught errors
function handleError(event, err) {
    try {
        const msg = document.getElementById('noVNC_fallback_errormsg');

        // Work around Firefox bug:
        // https://bugzilla.mozilla.org/show_bug.cgi?id=1685038
        if (event.message === "ResizeObserver loop completed with undelivered notifications.") {
            return false;
        }

        // Only show the initial error
        if (msg.hasChildNodes()) {
            return false;
        }

        let div = document.createElement("div");
        div.classList.add('noVNC_message');
        div.appendChild(document.createTextNode(event.message));
        msg.appendChild(div);

        if (event.filename) {
            div = document.createElement("div");
            div.className = 'noVNC_location';
            let text = event.filename;
            if (event.lineno !== undefined) {
                text += ":" + event.lineno;
                if (event.colno !== undefined) {
                    text += ":" + event.colno;
                }
            }
            div.appendChild(document.createTextNode(text));
            msg.appendChild(div);
        }

        if (err && err.stack) {
            div = document.createElement("div");
            div.className = 'noVNC_stack';
            div.appendChild(document.createTextNode(err.stack));
            msg.appendChild(div);
        }

        document.getElementById('noVNC_fallback_error')
            .classList.add("noVNC_open");

    } catch (exc) {
        document.write("noVNC encountered an error.");
    }

    // Try to disable keyboard interaction, best effort
    try {
        // Remove focus from the currently focused element in order to
        // prevent keyboard interaction from continuing
        if (document.activeElement) { document.activeElement.blur(); }

        // Don't let any element be focusable when showing the error
        let keyboardFocusable = 'a[href], button, input, textarea, select, details, [tabindex]';
        document.querySelectorAll(keyboardFocusable).forEach((elem) => {
            elem.setAttribute("tabindex", "-1");
        });
    } catch (exc) {
        // Do nothing
    }

    // Don't return true since this would prevent the error
    // from being printed to the browser console.
    return false;
}

window.addEventListener('error', evt => handleError(evt, evt.error));
window.addEventListener('unhandledrejection', evt => handleError(evt.reason, evt.reason));
