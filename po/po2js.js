#!/usr/bin/env node
/*
 * ps2js: gettext .po to noVNC .js converter
 * Copyright (C) 2018 The noVNC authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import { program } from 'commander';
import fs from 'fs';
import pofile from "pofile";

program
    .argument('<input>')
    .argument('<output>')
    .parse(process.argv);

let data = fs.readFileSync(program.args[0], "utf8");
let po = pofile.parse(data);

const bodyPart = po.items
    .filter(item => item.msgid !== "")
    .filter(item => item.msgstr[0] !== "")
    .filter(item => !item.flags.fuzzy)
    .filter(item => !item.obsolete)
    .map(item => "    " + JSON.stringify(item.msgid) + ": " + JSON.stringify(item.msgstr[0]))
    .join(",\n");

const output = "{\n" + bodyPart + "\n}";

fs.writeFileSync(program.args[1], output);
