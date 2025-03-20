#!/usr/bin/env node
/*
 * xgettext-html: HTML gettext parser
 * Copyright (C) 2018 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 */

import { program } from 'commander';
import jsdom from 'jsdom';
import fs from 'fs';

program
    .argument('<INPUT...>')
    .requiredOption('-o, --output <FILE>', 'write output to specified file')
    .parse(process.argv);

const strings = {};

function addString(str, location) {
    // We assume surrounding whitespace, and whitespace around line
    // breaks, is just for source formatting
    str = str.split("\n").map(s => s.trim()).join(" ").trim();

    if (str.length == 0) {
        return;
    }

    if (strings[str] === undefined) {
        strings[str] = {};
    }
    strings[str][location] = null;
}

// See https://html.spec.whatwg.org/multipage/dom.html#attr-translate
function process(elem, locator, enabled) {
    function isAnyOf(searchElement, items) {
        return items.indexOf(searchElement) !== -1;
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
            addString(elem.getAttribute("abbr"), locator(elem));
        }
        if (elem.hasAttribute("alt") &&
            isAnyOf(elem.tagName, ["AREA", "IMG", "INPUT"])) {
            addString(elem.getAttribute("alt"), locator(elem));
        }
        if (elem.hasAttribute("download") &&
            isAnyOf(elem.tagName, ["A", "AREA"])) {
            addString(elem.getAttribute("download"), locator(elem));
        }
        if (elem.hasAttribute("label") &&
            isAnyOf(elem.tagName, ["MENUITEM", "MENU", "OPTGROUP",
                                   "OPTION", "TRACK"])) {
            addString(elem.getAttribute("label"), locator(elem));
        }
        if (elem.hasAttribute("placeholder") &&
            isAnyOf(elem.tagName in ["INPUT", "TEXTAREA"])) {
            addString(elem.getAttribute("placeholder"), locator(elem));
        }
        if (elem.hasAttribute("title")) {
            addString(elem.getAttribute("title"), locator(elem));
        }
        if (elem.hasAttribute("value") &&
            elem.tagName === "INPUT" &&
            isAnyOf(elem.getAttribute("type"), ["reset", "button", "submit"])) {
            addString(elem.getAttribute("value"), locator(elem));
        }
    }

    for (let i = 0; i < elem.childNodes.length; i++) {
        let node = elem.childNodes[i];
        if (node.nodeType === node.ELEMENT_NODE) {
            process(node, locator, enabled);
        } else if (node.nodeType === node.TEXT_NODE && enabled) {
            addString(node.data, locator(node));
        }
    }
}

for (let i = 0; i < program.args.length; i++) {
    const fn = program.args[i];
    const file = fs.readFileSync(fn, "utf8");
    const dom = new jsdom.JSDOM(file, { includeNodeLocations: true });
    const body = dom.window.document.body;

    let locator = (elem) => {
        const offset = dom.nodeLocation(elem).startOffset;
        const line = file.slice(0, offset).split("\n").length;
        return fn + ":" + line;
    };

    process(body, locator, true);
}

let output = "";

for (let str in strings) {
    output += "#:";
    for (let location in strings[str]) {
        output += " " + location;
    }
    output += "\n";

    output += "msgid " + JSON.stringify(str) + "\n";
    output += "msgstr \"\"\n";
    output += "\n";
}

fs.writeFileSync(program.opts().output, output);
