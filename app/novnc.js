/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2017 Pierre Ossman for Cendio AB
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

/* jslint white: false, browser: true */

"use strict";

requirejs.config({
    baseUrl: '',
});

requirejs(['app/ui', 'core/util'],
function(ui, util) {
    // Set up translations, then start the UI
    var LINGUAS = ["de", "el", "nl", "sv"];
    util.Localisation.setup(LINGUAS, "app/locale", ui.load);
});
