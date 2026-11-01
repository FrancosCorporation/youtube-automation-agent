'use strict';

const path = require('node:path');

// The benchmark deliberately owns the r187 dependency tree. The approved
// presenter was authored in another experiment with r186.1, so map its Three,
// R3F, Remotion and React imports to the benchmark's single runtime copies.
const nodeModules = path.resolve(process.cwd(), 'benchmarks/video_3d/node_modules');
const { Config } = require(path.join(nodeModules, '@remotion/cli/dist/config/index.js'));

Config.overrideWebpackConfig((config) => {
  const previous = config.resolve?.alias ?? {};
  const aliases = Array.isArray(previous)
    ? Object.fromEntries(previous.map((item) => [item.name, item.alias]))
    : previous;

  return {
    ...config,
    resolve: {
      ...config.resolve,
      alias: {
        ...aliases,
        'three$': path.join(nodeModules, 'three'),
        'three/': `${path.join(nodeModules, 'three')}/`,
        'react$': path.join(nodeModules, 'react'),
        'react-dom$': path.join(nodeModules, 'react-dom'),
        'remotion$': path.join(nodeModules, 'remotion'),
        '@react-three/fiber$': path.join(nodeModules, '@react-three/fiber'),
        '@remotion/': `${path.join(nodeModules, '@remotion')}/`,
      },
    },
  };
});
