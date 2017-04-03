import nodeResolve from 'rollup-plugin-node-resolve';

export default {
  entry: 'src/browser-es-module-loader.js',
  dest: 'dist/browser-es-module-loader.js',
  format: 'umd',
  moduleName: 'BrowserESModuleLoader',
  sourceMap: true,

  plugins: [
    nodeResolve(),
  ],

  // skip rollup warnings (specifically the eval warning)
  onwarn: function() {}
};
