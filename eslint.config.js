const js = require('@eslint/js');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'logs/**',
      'temp/**',
      'tmp/**',
      'uploads/**',
      'data/assets/**',
      'data/audio/**',
      'data/captions/**',
      'data/scripts/**',
      'data/videos/**',
      'data/thumbnails/**',
      'experiments/hyperframes-pulso-pilot/.agents/**',
      'experiments/hyperframes-pulso-pilot/.hyperframes/**',
      'experiments/hyperframes-pulso-pilot/assets/pilot.bundle.js'
    ]
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        confirm: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        localStorage: 'readonly',
        location: 'readonly',
        module: 'readonly',
        process: 'readonly',
        prompt: 'readonly',
        require: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
        window: 'readonly',
        document: 'readonly',
        matchMedia: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        IntersectionObserver: 'readonly',
        PointerEvent: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none'
      }]
    }
  },
  {
    files: [
      '**/*.mjs',
      'scripts/verify-publications.js',
      'experiments/hyperframes-pulso-pilot/scripts/**/*.js',
      'experiments/hyperframes-pulso-pilot/src/**/*.js'
    ],
    languageOptions: {
      sourceType: 'module'
    }
  },
  {
    files: ['experiments/hyperframes-pulso-pilot/src/pilot.js'],
    languageOptions: {
      globals: {
        __VIDEO_SEED__: 'readonly',
        __VIDEO_THEME__: 'readonly',
        __THEME_PALETTE__: 'readonly',
        __AUDIO_ENVELOPE__: 'readonly'
      }
    }
  }
];
