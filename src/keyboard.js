// Takes a DOM keyboard event and:
// - determines which keysym it represents
// - determines a keyId  identifying the key that was pressed (corresponding to the key/keyCode properties on the DOM event)
// - synthesizes events to synchronize modifier key state between which modifiers are actually down, and which we thought were down
// - marks each event with an 'escape' property if a modifier was down which should be "escaped"
// - generates a "stall" event in cases where it might be necessary to wait and see if a keypress event follows a keydown
// This information is collected into an object which is passed to the next() function. (one call per event)
function KeyEventDecoder(modifierState, next) {
    function sendAll(evts) {
        for (var i = 0; i < evts.length; ++i) {
            next(evts[i]);
        }
    }
    function process(evt, type) {
        var result = {type: type};
        var keyId = getKey(evt);
        if (keyId) {
            result['keyId'] = keyId;
        }

        var keysym = getKeysym(evt);

        var hasModifier = modifierState.hasShortcutModifier() || !!modifierState.activeCharModifier();
        // Is this a case where we have to decide on the keysym right away, rather than waiting for the keypress?
        // "special" keys like enter, tab or backspace don't send keypress events,
        // and some browsers don't send keypresses at all if a modifier is down
        if (keysym && (type !== 'keydown' || nonCharacterKey(evt) || hasModifier)) {
            result['keysym'] = keysym;
        }

        var isShift = evt.keyCode == 0x10 || evt.key == 'Shift';

        // Should we prevent the browser from handling the event?
        // Doing so on a keydown (in most browsers) prevents keypress from being generated
        // so only do that if we have to.
        var suppress = !isShift && (type !== 'keydown' || modifierState.hasShortcutModifier() || !!nonCharacterKey(evt));

        // If a char modifier is down on a keydown, we need to insert a stall,
        // so VerifyCharModifier knows to wait and see if a keypress is comnig
        var stall = type === 'keydown' && modifierState.activeCharModifier() && !nonCharacterKey(evt);

        // if a char modifier is pressed, get the keys it consists of (on Windows, AltGr is equivalent to Ctrl+Alt)
        var active = modifierState.activeCharModifier();

        // If we have a char modifier down, and we're able to determine a keysym reliably
        // then (a) we know to treat the modifier as a char modifier,
        // and (b) we'll have to "escape" the modifier to undo the modifier when sending the char.
        if (active && keysym) {
            var isCharModifier = false;
            for (var i  = 0; i < active.length; ++i) {
                if (active[i] == keysym.keysym) {
                    isCharModifier = true;
                }
            }
            if (type == 'keypress' && !isCharModifier) {
                result.escape = modifierState.activeCharModifier();
            }
        }

        if (stall) {
            // insert a fake "stall" event
            next({type: 'stall'});
        }
        next(result);

        return suppress;
    }

    return {
        keydown: function(evt) {
            sendAll(modifierState.keydown(evt));
            return process(evt, 'keydown');
        },
        keypress: function(evt) {
            return process(evt, 'keypress');
        },
        keyup: function(evt) {
            sendAll(modifierState.keyup(evt));
            return process(evt, 'keyup');
        },
        syncModifiers: function(evt) {
            sendAll(modifierState.syncAny(evt));
        },
        releaseAll: function() { next({type: 'releaseall'}); }
    };
}

// Combines keydown and keypress events where necessary to handle char modifiers.
// On some OS'es, a char modifier is sometimes used as a shortcut modifier.
// For example, on Windows, AltGr is synonymous with Ctrl-Alt. On a Danish keyboard layout, AltGr-2 yields a @, but Ctrl-Alt-D does nothing
// so when used with the '2' key, Ctrl-Alt counts as a char modifier (and should be escaped), but when used with 'D', it does not.
// The only way we can distinguish these cases is to wait and see if a keypress event arrives
// When we receive a "stall" event, wait a few ms before processing the next keydown. If a keypress has also arrived, merge the two
function VerifyCharModifier(next) {
    var queue = [];
    var timer = null;
    function process() {
        if (timer) {
            return;
        }
        while (queue.length != 0) {
            var cur = queue[0];
            queue = queue.splice(1);
            switch (cur.type) {
            case 'stall':
                // insert a delay before processing available events.
                timer = setTimeout(function() {
                    clearTimeout(timer);
                    timer = null;
                    process();
                }, 5);
                return;
            case 'keydown':
                // is the next element a keypress? Then we should merge the two
                if (queue.length != 0 && queue[0].type == 'keypress') {
                    // Firefox sends keypress even when no char is generated.
                    // so, if keypress keysym is the same as we'd have guessed from keydown,
                    // the modifier didn't have any effect, and should not be escaped
                    if (queue[0].escape && (!cur.keysym || cur.keysym.keysym !== queue[0].keysym.keysym)) {
                        cur.escape = queue[0].escape;
                    }
                    cur.keysym = queue[0].keysym;
                    queue = queue.splice(1);
                }
                break;
            }

            // swallow stall events, and pass all others to the next stage
            if (cur.type !== 'stall') {
                next(cur);
            }
        }
    }
    return function(evt) {
        queue.push(evt);
        process();
    };
}

// Keeps track of which keys we (and the server) believe are down
// When a keyup is received, match it against this list, to determine the corresponding keysym(s)
// in some cases, a single key may produce multiple keysyms, so the corresponding keyup event must release all of these chars
// key repeat events should be merged into a single entry.
// Because we can't always identify which entry a keydown or keyup event corresponds to, we sometimes have to guess
function TrackKeyState(next) {
    var state = [];

    return function (evt) {
        var last = state.length != 0 ? state[state.length-1] : null;

        switch (evt.type) {
        case 'keydown':
            // insert a new entry if last seen key was different.
            if (!last || !evt.keyId || last.keyId != evt.keyId) {
                last = {keyId: evt.keyId, keysyms: {}};
                state.push(last);
            }
            if (evt.keysym) {
                // make sure last event contains this keysym (a single "logical" keyevent
                // can cause multiple key events to be sent to the VNC server)
                last.keysyms[evt.keysym.keysym] = evt.keysym;
                last.ignoreKeyPress = true;
                next(evt);
            }
            break;
        case 'keypress':
            if (!last) {
                last = {keyId: evt.keyId, keysyms: {}};
                state.push(last);
            }
            if (!evt.keysym) {
                console.log('keypress with no keysym:', evt);
            }

            // If we didn't expect a keypress, and already sent a keydown to the VNC server
            // based on the keydown, make sure to skip this event.
            if (evt.keysym && !last.ignoreKeyPress) {
                last.keysyms[evt.keysym.keysym] = evt.keysym;
                evt.type = 'keydown';
                next(evt);
            }
            break;
        case 'keyup':
            if (state.length == 0) {
                return;
            }
            var idx = null;
            // do we have a matching key tracked as being down?
            for (var i = 0; i != state.length; ++i) {
                if (state[i].keyId === evt.keyId) {
                    idx = i;
                    break;
                }
            }
            // if we couldn't find a match (it happens), assume it was the last key pressed
            if (idx === null) {
                idx = state.length - 1;
            }

            var item = state.splice(idx, 1)[0];
            // for each keysym tracked by this key entry, clone the current event and override the keysym
            for (var key in item.keysyms) {
                var clone = (function(){
                    return function (obj) { Clone.prototype=obj; return new Clone() };
                    function Clone(){}
                }());
                var out = clone(evt);
                out.keysym = item.keysyms[key];
                next(out);
            }
            break;
        case 'releaseall':
            for (var i = 0; i < state.length; ++i) {
                for (var key in state[i].keysyms) {
                    var keysym = state[i].keysyms[key];
                    next({keyId: 0, keysym: keysym, type: 'keyup'});
                }
            }
            state = [];
        }
    }
}

// Handles "escaping" of modifiers: if a char modifier is used to produce a keysym (such as AltGr-2 to generate an @),
// then the modifier must be "undone" before sending the @, and "redone" afterwards.
function EscapeModifiers(next) {
    return function(evt) {
        if (evt.type != 'keydown' || evt.escape === undefined) {
            next(evt);
            return;
        }
        // undo modifiers
        for (var i = 0; i < evt.escape.length; ++i) {
            next({type: 'keyup', keyId: 0, keysym: keysyms.lookup(evt.escape[i])});
        }
        // send the character event
        next(evt);
        // redo modifiers
        for (var i = 0; i < evt.escape.length; ++i) {
            next({type: 'keydown', keyId: 0, keysym: keysyms.lookup(evt.escape[i])});
        }
    }
}
