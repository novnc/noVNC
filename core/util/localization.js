/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

/*
 * Localization Utilities
 */

export function Localizer() {
    // Currently configured language
    this.language = 'en';

    // Current dictionary of translations
    this.dictionary = undefined;
}

Localizer.prototype = {
    // Configure suitable language based on user preferences
    setup: function (supportedLanguages) {
        var userLanguages;

        this.language = 'en'; // Default: US English

        /*
         * Navigator.languages only available in Chrome (32+) and FireFox (32+)
         * Fall back to navigator.language for other browsers
         */
        if (typeof window.navigator.languages == 'object') {
            userLanguages = window.navigator.languages;
        } else {
            userLanguages = [navigator.language || navigator.userLanguage];
        }

        for (var i = 0;i < userLanguages.length;i++) {
            var userLang = userLanguages[i];
            userLang = userLang.toLowerCase();
            userLang = userLang.replace("_", "-");
            userLang = userLang.split("-");

            // Built-in default?
            if ((userLang[0] === 'en') &&
                ((userLang[1] === undefined) || (userLang[1] === 'us'))) {
                return;
            }

            // First pass: perfect match
            for (var j = 0;j < supportedLanguages.length;j++) {
                var supLang = supportedLanguages[j];
                supLang = supLang.toLowerCase();
                supLang = supLang.replace("_", "-");
                supLang = supLang.split("-");

                if (userLang[0] !== supLang[0])
                    continue;
                if (userLang[1] !== supLang[1])
                    continue;

                this.language = supportedLanguages[j];
                return;
            }

            // Second pass: fallback
            for (var j = 0;j < supportedLanguages.length;j++) {
                supLang = supportedLanguages[j];
                supLang = supLang.toLowerCase();
                supLang = supLang.replace("_", "-");
                supLang = supLang.split("-");

                if (userLang[0] !== supLang[0])
                    continue;
                if (supLang[1] !== undefined)
                    continue;

                this.language = supportedLanguages[j];
                return;
            }
        }
    },

    // Retrieve localised text
    get: function (id) {
        if (typeof this.dictionary !== 'undefined' && this.dictionary[id]) {
            return this.dictionary[id];
        } else {
            return id;
        }
    },

    // Traverses the DOM and translates relevant fields
    // See https://html.spec.whatwg.org/multipage/dom.html#attr-translate
    translateDOM: function () {
        var self = this;
        function process(elem, enabled) {
            function isAnyOf(searchElement, items) {
                return items.indexOf(searchElement) !== -1;
            }

            function translateAttribute(elem, attr) {
                var str = elem.getAttribute(attr);
                str = self.get(str);
                elem.setAttribute(attr, str);
            }

            function translateTextNode(node) {
                var str = node.data.trim();
                str = self.get(str);
                node.data = str;
            }

            if (elem.hasAttribute("translate")) {
                if (isAnyOf(elem.getAttribute("translate"), ["", "yes"])) {
                    enabled = true;
                } else if (isAnyOf(elem.getAttribute("translate"), ["no"])) {
                    enabled = false;
                }
            }

            if (enabled) {
                if (elem.hasAttribute("abbr") &&
                    elem.tagName === "TH") {
                    translateAttribute(elem, "abbr");
                }
                if (elem.hasAttribute("alt") &&
                    isAnyOf(elem.tagName, ["AREA", "IMG", "INPUT"])) {
                    translateAttribute(elem, "alt");
                }
                if (elem.hasAttribute("download") &&
                    isAnyOf(elem.tagName, ["A", "AREA"])) {
                    translateAttribute(elem, "download");
                }
                if (elem.hasAttribute("label") &&
                    isAnyOf(elem.tagName, ["MENUITEM", "MENU", "OPTGROUP",
                                   "OPTION", "TRACK"])) {
                    translateAttribute(elem, "label");
                }
                // FIXME: Should update "lang"
                if (elem.hasAttribute("placeholder") &&
                    isAnyOf(elem.tagName, ["INPUT", "TEXTAREA"])) {
                    translateAttribute(elem, "placeholder");
                }
                if (elem.hasAttribute("title")) {
                    translateAttribute(elem, "title");
                }
                if (elem.hasAttribute("value") &&
                    elem.tagName === "INPUT" &&
                    isAnyOf(elem.getAttribute("type"), ["reset", "button"])) {
                    translateAttribute(elem, "value");
                }
            }

            for (var i = 0;i < elem.childNodes.length;i++) {
                let node = elem.childNodes[i];
                if (node.nodeType === node.ELEMENT_NODE) {
                    process(node, enabled);
                } else if (node.nodeType === node.TEXT_NODE && enabled) {
                    translateTextNode(node);
                }
            }
        }

        process(document.body, true);
    },
}

export const l10n = new Localizer();
export default l10n.get.bind(l10n);
