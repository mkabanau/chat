const TerserPlugin = require('terser-webpack-plugin');
// const CopyPlugin = require('copy-webpack-plugin');
const path = require('path');
const webpack = require('webpack')

module.exports = (env, argv) => {
  const mode = argv.mode === 'production' ? 'prod' : 'dev';
  return {
    entry: {
      tinode: path.resolve(__dirname, 'src/tinode.js'),
    },
    devtool: 'source-map',
    module: {
      rules: [
        {
          test: /\.js$/,
          enforce: 'pre',
          exclude: /(node_modules|bower_components|\.spec\.js)/,
          use: [
            {
              loader: 'webpack-remove-code-blocks',
              // options: {
              //   blocks: [
              //     'debug',
              //     'devblock',
              //     {
              //       start: 'devserver_start',
              //       end: 'devserver_end',
              //       prefix: '/*',
              //       suffix: '*/',
              //     },
              //   ],
              // },
            },
          ],
        },
        {
          test: /\.jsx?$/,
          use: [
            'babel-loader',
          ],
          exclude: /node_modules/,
        },
      ],
    },
    output: {
      path: path.resolve(__dirname, 'umd'),
      filename: `[name].${mode}.js`,
      // library: "tinode-sdk",
      globalObject: 'this',
      library: {
        name: 'Tinode',
        type: 'umd',
      },
    },
    optimization: {
      minimize: (mode === 'prod'),
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            ecma: undefined,
            warnings: false,
            parse: {},
            compress: {},
            format: {
              comments: false,
            },
            mangle: true, // Note `mangle.properties` is `false` by default.
            module: false,
            output: null,
            toplevel: false,
            nameCache: null,
            ie8: false,
            keep_classnames: undefined,
            keep_fnames: false,
            safari10: false,
          },
          extractComments: false,
        })
      ]
    },
    performance: {
      maxEntrypointSize: 360000,
      maxAssetSize: 360000
    },
    plugins: [
      // new CopyPlugin({
      //   patterns: [
      //     { from: `node_modules/tinode-sdk/umd/tinode.${mode}.js`, to: `tinode.${mode}.js` },
      //   ],
      // }),
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
    }),
    ],
    // externals: {
    //   'react': 'React',
    //   'react-dom': 'ReactDOM',
    //   'react-intl': 'ReactIntl',
    //   'tinode-sdk': 'Tinode',
    // },
  };
}
