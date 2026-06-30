import { defineVitestConfig } from '@nuxt/test-utils/config';

// https://nuxt.com/docs/getting-started/testing
export default defineVitestConfig({
	test: {
		globals: true,
		// Run tests in a Nuxt runtime so auto-imports, components, and
		// composables resolve the same way they do in the app.
		// @see https://nuxt.com/docs/getting-started/testing#using-a-nuxt-runtime-environment
		environment: 'nuxt',
		environmentOptions: {
			nuxt: {
				domEnvironment: 'jsdom',
			},
		},
		setupFiles: ['./vitest.setup.ts'],
	},
});
