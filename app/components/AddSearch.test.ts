import { registerEndpoint, renderSuspended } from '@nuxt/test-utils/runtime';
import { fireEvent, screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import type { SearchResult } from '~~/shared/types/search';
import AddSearch from './AddSearch.vue';

registerEndpoint('/api/search', (): SearchResult[] => [
  { type: 'movie', providerId: '27205', title: 'Inception', year: '2010' },
]);

describe('AddSearch', () => {
  it('emits manual with the currently selected type', async () => {
    const { emitted } = await renderSuspended(AddSearch);

    await fireEvent.click(
      screen.getByRole('button', { name: /Enter manually/ }),
    );

    expect((emitted().manual as [string][])[0]).toStrictEqual(['movie']);
  });

  it('searches (debounced) and emits the picked result', async () => {
    const { emitted } = await renderSuspended(AddSearch);

    await fireEvent.update(screen.getByLabelText('Search'), 'Inception');
    // Wait out the 300ms debounce, then for the result to render.
    const result = await screen.findByRole(
      'button',
      { name: /Inception/ },
      { timeout: 2000 },
    );
    await fireEvent.click(result);

    expect((emitted().select as [SearchResult][])[0]![0]).toMatchObject({
      providerId: '27205',
      title: 'Inception',
    });
  });
});
