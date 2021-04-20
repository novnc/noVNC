const path = require('path');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const HtmlWebpackInlineSVGPlugin = require('html-webpack-inline-svg-plugin');
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
// const SvgSpriteHtmlWebpackPlugin = require('svg-sprite-html-webpack');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');

module.exports = {
    mode: "production",
    entry: {
        main: './app/ui.js',
        error_handler: './app/error-handler.js',
        promise: './vendor/promise.js',
        style: './app/styles/base.css'
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].bundle.js'
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /(node_modules)/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['@babel/preset-env']
                    }
                }
            },
            {
                test: /\.(sa|sc|c)ss$/,
                use: [
                    {
                        loader: MiniCssExtractPlugin.loader
                    },
                    {
                        loader: "css-loader",
                    },
                    // {
                    //     loader: "postcss-loader"
                    // },
                    {
                        loader: "sass-loader",
                        options: {
                            implementation: require("sass")
                        }
                    }
                ]
            },
            {
                // Now we apply rule for images
                test: /\.(png|jpe?g|gif|svg)$/,
                use: [
                    {
                        // Using file-loader for these files
                        loader: "file-loader",

                        // In options we can set different things like format
                        // and directory to save
                        options: {
                            outputPath: 'images'
                        }
                    }
                ]
            },
            {
                // Apply rule for fonts files
                test: /\.(woff|woff2|ttf|otf|eot)$/,
                use: [
                    {
                        // Using file-loader too
                        loader: "file-loader",
                        options: {
                            outputPath: 'fonts'
                        }
                    }
                ]
            },
            // {
            //     test: /\.svg$/,
            //     exclude: /node_modules/,
            //     use: SvgSpriteHtmlWebpackPlugin.getLoader(),
            // }
        ]
    },
    optimization: {
        minimize: true,
        minimizer: [
            new CssMinimizerPlugin(),
        ],
        runtimeChunk: 'single',
        splitChunks: {
            chunks: 'all',
        },
    },
    plugins: [
        new CleanWebpackPlugin(),
        new HtmlWebpackPlugin({
            filename: '../index.html',
            template: 'vnc.html',
            minify: {
                html5: true,
                collapseWhitespace: true,
                minifyCSS: true,
                minifyJS: true,
                minifyURLs: false,
                removeAttributeQuotes: true,
                removeComments: true, // false for Vue SSR to find app placeholder
                removeEmptyAttributes: true,
                removeOptionalTags: true,
                removeRedundantAttributes: true,
                removeScriptTypeAttributes: true,
                removeStyleLinkTypeAttributese: true,
                useShortDoctype: true
            }
        }),
        // new SvgSpriteHtmlWebpackPlugin({
        //     append: true,
        //     includeFiles: [
        //         'app/images/*.svg',
        //     ],
        //     generateSymbolId: function(svgFilePath, svgHash, svgContent) {
        //         return svgHash.toString();
        //     },
        // }),
        new HtmlWebpackInlineSVGPlugin({
            inlineAll: true,
            runPreEmit: true,
        }),
        new MiniCssExtractPlugin({
            filename: "[name].bundle.css"
        }),
    ],
};
