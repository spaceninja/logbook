// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  // Firebase web config, sourced from NUXT_PUBLIC_FIREBASE_* env vars.
  // Locally these point at logbook-dev (.env); prod values are set in Netlify.
  runtimeConfig: {
    public: {
      firebase: {
        apiKey: '',
        authDomain: '',
        projectId: '',
        storageBucket: '',
        messagingSenderId: '',
        appId: '',
      },
    },
  },
  // https://nuxt.com/docs/api/nuxt-config#tsconfig
  typescript: {
    tsConfig: {
      compilerOptions: {
        // Expose @testing-library/jest-dom matchers (e.g. toBeInTheDocument) to the type checker.
        // https://github.com/testing-library/jest-dom/issues/546#issuecomment-1800436478
        types: ['@testing-library/jest-dom'],
      },
      // Type-check the test config/setup, which live outside app/.
      include: ['../vitest.config.ts', '../vitest.setup.ts'],
    },
  },
  // https://vite.dev/guide/dep-pre-bundling.html
  vite: {
    optimizeDeps: {
      include: ['firebase/app', 'firebase/firestore'],
    },
  },
});
