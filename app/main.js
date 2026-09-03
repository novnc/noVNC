import UI from "./ui.js";
import * as Log from '../core/util/logging.js';

let response;

let defaults = {};
let mandatory = {};

// Default settings will be loaded from defaults.json. Mandatory
// settings will be loaded from mandatory.json, which the user
// cannot change.

try {
    response = await fetch('./defaults.json');
    if (!response.ok) {
        throw Error("" + response.status + " " + response.statusText);
    }

    defaults = await response.json();
} catch (err) {
    Log.Error("Couldn't fetch defaults.json: " + err);
}

try {
    response = await fetch('./mandatory.json');
    if (!response.ok) {
        throw Error("" + response.status + " " + response.statusText);
    }

    mandatory = await response.json();
} catch (err) {
    Log.Error("Couldn't fetch mandatory.json: " + err);
}

// You can also override any defaults you need here:
//
// defaults['host'] = 'vnc.example.com';

// Or force a specific setting, preventing the user from
// changing it:
//
// mandatory['view_only'] = true;

// See docs/EMBEDDING.md for a list of possible settings.

UI.start({ settings: { defaults: defaults,
                       mandatory: mandatory } });
