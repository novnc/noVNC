# Translations

Included here are po translation files for many languages. The final output consumed by noVNC will be json files generated at build time located in `/app/locale` using the node script `po2js`. 

## Adding new strings

When making modifications to UI elements any english strings used that are presented to the user should be noted in the `noVNC.pot` template file. IE: 

```
msgid "Prefer Local Cursor"
msgstr ""
```

Using this template file on any system with the utility [trans](https://manpages.ubuntu.com/manpages/jammy/man1/trans.1.html) and [nodejs](https://nodejs.org/en) installed all of the languages can be updated from this directory by simply running: 

```
npm install --prefix ./ node-getopt po2json
bash update_trans.sh
rm -Rf node_modules/ package.json package-lock.json
```

Any new strings will be translated using Google Translate and injected into the po files along with generating new json for ingestion.

## Native speakers

Many of these files were automatically generated, but they can be modified directly and will maintain their changes even with new generations. Feel free to open a PR with corrected translations for any po files in this directory. 
