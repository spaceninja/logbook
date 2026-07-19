// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
	compatibilityDate: '2025-07-15',
	css: ['~/assets/css/global.css'],
	devtools: { enabled: false },
	router: {
		options: {
			linkActiveClass: 'is-active',
			linkExactActiveClass: 'is-exact-active',
		},
	},
	// Firebase web config, sourced from NUXT_PUBLIC_FIREBASE_* env vars.
	// Locally these point at logbook-dev (.env); prod values are set in Netlify.
	runtimeConfig: {
		// Server-only secrets for the metadata search proxies (never exposed to the
		// client). Sourced from NUXT_* env vars (local .env / Netlify). TMDB uses the
		// v4 read token (Bearer); IGDB uses Twitch client-credentials.
		tmdbReadToken: '', // NUXT_TMDB_READ_TOKEN
		googleBooksApiKey: '', // NUXT_GOOGLE_BOOKS_API_KEY
		twitchClientId: '', // NUXT_TWITCH_CLIENT_ID
		twitchClientSecret: '', // NUXT_TWITCH_CLIENT_SECRET
		// Which IGDB time-to-beat stat pre-fills a game's length: hastily |
		// normally | completely. Defaults to normally (main-story pace); forks can
		// override via NUXT_IGDB_TIME_TO_BEAT_STAT. Unknown values fall back to normally.
		igdbTimeToBeatStat: 'normally', // NUXT_IGDB_TIME_TO_BEAT_STAT
		// ISO 3166-1 country whose streaming availability is shown on movie/show
		// detail pages. TMDB keys its watch-provider data by country; a country
		// with no listings simply shows nothing. Override via
		// NUXT_WATCH_PROVIDER_COUNTRY.
		watchProviderCountry: 'US', // NUXT_WATCH_PROVIDER_COUNTRY
		public: {
			firebase: {
				apiKey: '',
				authDomain: '',
				projectId: '',
				storageBucket: '',
				messagingSenderId: '',
				appId: '',
			},
			// The owner's Firebase Auth UID. Per-project (dev/prod differ); sourced
			// from NUXT_PUBLIC_OWNER_UID. Gates write controls in the UI; the real
			// enforcement is the Firestore rules.
			ownerUid: '',
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
			include: [
				'@vueuse/core',
				'@vueuse/router',
				'firebase/app',
				'firebase/firestore',
				'firebase/auth',
			],
		},
	},
});
