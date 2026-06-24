import { render, screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import app from './app.vue';

describe('app', () => {
  it('renders inside the Nuxt test environment', async () => {
    await render(app);
    // <NuxtWelcome> is a Nuxt auto-imported component; it only resolves
    // (and renders its documentation links) because we're running under
    // the `nuxt` Vitest environment.
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
  });
});
