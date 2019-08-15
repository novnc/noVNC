import nodeResolve from 'rollup-plugin-node-resolve';

export default {
  input: 'src/browser-es-module-loader.js',
  output: {
    file: 'dist/browser-es-module-loader.js',
    format: 'umd',
    name: 'BrowserESModuleLoader',
    sourcemap: true,
  },

  plugins: [
    nodeResolve(),
  ],
};
