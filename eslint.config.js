const js = require('@eslint/js');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      '**/.venv-neural/**',
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
      // Authenticated browser profiles include vendor extension code; they are
      // local runtime state, not application source.
      'data/browser-profiles/**',
      'experiments/hyperframes-pulso-pilot/.agents/**',
      'experiments/hyperframes-pulso-pilot/.hyperframes/**',
      'experiments/hyperframes-pulso-pilot/assets/pilot.bundle.js',
      'experiments/hyperframes-pulso-pilot/assets/production-presenter.js',
      'experiments/remotion-motion-review/build-*/**',
      // Remotion exports contain generated webpack/vendor bundles. Their
      // authored source remains checked under src/ and scripts/.
      'experiments/remotion-motion-review/renders/**/bundle/**',
      // Variant asset JavaScript is generated/bundled output. Lint its source
      // in src/ and scripts/ once, not every checked-in copy of the bundles.
      'experiments/hyperframes-pulso-pilot/variants/**/assets/**/*.js'
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
    // This historical source is bound to the reviewed evidence checksum.
    // Preserve its bytes while still checking every other unused variable.
    files: ['docs/evidencias/visual-standard-production-e2e-chrome-incognito-myth-correction-2026-10-23/generate-authored-scenes.cjs'],
    rules: {
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^(?:_|envelope$)',
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
  },
  {
    files: [
      'experiments/hyperframes-pulso-pilot/src/**/*.js',
      'experiments/hyperframes-pulso-pilot/scripts/qa-*-publication.js',
      'tests/presenter-framing.js'
    ],
    languageOptions: {
      globals: {
        Blob: 'readonly',
        getComputedStyle: 'readonly',
        innerWidth: 'readonly'
      }
    }
  }
];
