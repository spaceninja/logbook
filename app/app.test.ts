import { renderSuspended } from '@nuxt/test-utils/runtime';
import { screen, within } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import app from './app.vue';

describe('app', () => {
  it('renders the layout navigation', async () => {
    // renderSuspended mounts within the Nuxt runtime (router, plugins, layouts),
    // which the app shell needs — NuxtLayout/NuxtPage read the current route.
    await renderSuspended(app);
    // Scope to the layout's <nav> so we don't collide with in-page links.
    const nav = within(screen.getByRole('navigation'));
    expect(nav.getByRole('link', { name: 'Backlog' })).toBeInTheDocument();
    expect(nav.getByRole('link', { name: 'History' })).toBeInTheDocument();
  });
});
