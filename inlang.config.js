// filename: inlang.config.js

export async function defineConfig(env) {
  // importing a plugin
  const plugin = await env.$import(
    "https://cdn.jsdelivr.net/gh/jannesblobel/inlang-plugin-po@1/dist/index.js"
  );
  const pluginConfig = {
    // language mean the name of you file
    pathPattern: "./po/{language}.po",
    referenceResourcePath: "./po/noVNC.pot",
  };

  return {
    // if your project use a pot file use the pot as the reference Language
    // !! do not add the pot file in the Languages array
    /**
 * @example
 * example files: en.pot, de.po, es.po, fr.po
 *  referenceLanguage: "en",
    languages: ["de","es","fr"],
 */
    // !!change

    referenceLanguage: "en",
    languages: await getLanguages(env),
    readResources: (args) =>
      plugin.readResources({ ...args, ...env, pluginConfig }),
    writeResources: (args) =>
      plugin.writeResources({ ...args, ...env, pluginConfig }),
  };
}

/**
 * Automatically derives the languages in this repository.
 */
async function getLanguages(env) {
  const files = await env.$fs.readdir("./po");
  // files that end with .json
  // remove the .json extension to only get language name
  const languages = files
    .filter((name) => name.endsWith(".po"))
    .map((name) => name.replace(".po", ""));
  return languages;
}
