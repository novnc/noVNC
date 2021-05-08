const path = require('path');

module.exports = {
    entry: './app/ui.js',
    output: {
        filename: 'main.js',
        path: path.resolve(__dirname, 'dist'),
    },
    optimization: {
        minimize: false
    },
    devServer: {
        index: "vnc.html",
        contentBase : path.join(__dirname),
        publicPath: '/',
        compress: true,
        port: 9000,
        hot: true
    }
};