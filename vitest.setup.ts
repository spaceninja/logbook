// Adds jest-dom matchers (toBeInTheDocument, toHaveTextContent, etc.) to expect().
import '@testing-library/jest-dom/vitest';

// Suppress Vue's one-time "<Suspense> is an experimental feature" notice. Vue
// logs it via console.info the first time a Suspense boundary mounts, and since
// each test file gets a fresh module registry it reprints once per file, which
// drowns out real output. The `<Suspense>` use is intentional (it's how Nuxt's
// renderSuspended/mountSuspended mount async components), so the notice is noise.
const originalInfo = console.info.bind(console);
console.info = (...args: unknown[]) => {
	if (
		typeof args[0] === 'string' &&
		args[0].includes('<Suspense> is an experimental feature')
	) {
		return;
	}
	originalInfo(...args);
};
