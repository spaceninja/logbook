// Adds jest-dom matchers (toBeInTheDocument, toHaveTextContent, etc.) to expect().
import '@testing-library/jest-dom/vitest';

// When you start testing components that use async setup (via @nuxt/test-utils'
// renderSuspended/mountSuspended) or that read window.matchMedia, you may need to
// add a matchMedia stub and/or suppress Vue's "<Suspense> is experimental" info
// log here. They're omitted until something actually requires them.
