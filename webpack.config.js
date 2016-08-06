module.exports = {
  entry: {
    noVNC: './include/index.js',
    ui: './include/ui.js',
    playback: './include/playback.js'
  },

  output: {
    filename: "[name].js"
  },

  module: {
    loaders: [
      { test: require.resolve("./include/rfb"), loader: "expose?RFB" },
      { test: require.resolve("./include/webutil"), loader: "expose?WebUtil" }
    ]
  }
}
