// Karma preprocessor that bundles each test file with Vite.
//
// core/ is written for Vite: bare imports of CommonJS packages (pako), extensionless
// relative imports and the "?url" / "?worker" suffixes. A plain browser can resolve
// none of those, so every test is bundled the same way the app is.

const path = require('path');

const stubs = path.resolve(__dirname, 'stubs');

// app/ui.js has side effects on load and needs the whole app. core/display.js only
// uses it to track secondary windows, so tests get a small stand-in.
const viteShims = {
  name: 'karma-vite-shims',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source.endsWith('?worker')) { return path.join(stubs, 'worker.js'); }
    if (source.endsWith('?url')) { return path.join(stubs, 'asset-url.js'); }
    if (importer && /[\\/]app[\\/]ui$|\/ui\.js$/.test(source) && source.includes('app/ui')) {
      return path.join(stubs, 'ui.js');
    }
    return null;
  },
};

function createVitePreprocessor(logger) {
  const log = logger.create('preprocessor.vite');

  return async function (content, file, done) {
    try {
      const vite = await import('vite');
      const result = await vite.build({
        configFile: false,
        logLevel: 'silent',
        root: path.resolve(__dirname, '..'),
        plugins: [viteShims],
        build: {
          write: false,
          minify: false,
          target: 'esnext',
          sourcemap: 'inline',
          rollupOptions: {
            input: file.originalPath,
            output: { format: 'es', inlineDynamicImports: true },
          },
        },
      });
      const output = Array.isArray(result) ? result[0] : result;
      const chunk = output.output.find((o) => o.type === 'chunk');
      done(null, chunk.code);
    } catch (err) {
      log.error('Failed to bundle %s\n%s', file.originalPath, err.stack || err);
      done(err);
    }
  };
}

createVitePreprocessor.$inject = ['logger'];

module.exports = { 'preprocessor:vite': ['factory', createVitePreprocessor] };
