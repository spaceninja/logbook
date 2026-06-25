import { fireEvent, render, screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import type { Item } from '~~/shared/types/item';
import ItemForm from './ItemForm.vue';

// Submit by dispatching the form's submit event directly. Unlike clicking the
// submit button, this bypasses native constraint validation — which keeps the
// component's real-browser validation intact while sidestepping a jsdom bug in
// its `step` constraint check. It still runs our @submit.prevent handler.
function submitForm() {
  return fireEvent.submit(screen.getByRole('form'));
}

describe('ItemForm', () => {
  it('emits a manual-id item assembled from the inputs (create)', async () => {
    const { emitted } = render(ItemForm, { props: { mode: 'create' } });

    await fireEvent.update(screen.getByLabelText('Type'), 'movie');
    await fireEvent.update(screen.getByLabelText('Title'), 'Inception');
    await fireEvent.update(screen.getByLabelText(/Creator/), 'Nolan, Thomas');
    await fireEvent.update(screen.getByLabelText(/Tags/), 'sci-fi, heist');
    await submitForm();

    const item = (emitted().submit as [Item][])[0]![0];
    expect(item.id).toMatch(/^movie-manual-/);
    expect(item.type).toBe('movie');
    expect(item.title).toBe('Inception');
    expect(item.creator).toStrictEqual(['Nolan', 'Thomas']);
    expect(item.tags).toStrictEqual(['sci-fi', 'heist']);
    expect(item.provider).toBe('manual');
    expect(item.status).toBe('backlog');
    expect(item.completed_dates).toStrictEqual([]);
    expect(item.completed_years).toStrictEqual([]);
    expect(item.metadata).toStrictEqual({});
  });

  it('keeps the existing id and derives completed_years (edit)', async () => {
    const initial: Item = {
      id: 'movie-tmdb-27205',
      type: 'movie',
      title: 'Inception',
      provider: 'tmdb',
      status: 'inactive',
      is_purchased: false,
      is_prioritized: false,
      completed_dates: ['2024-01-02', '2026-02-14'],
      completed_years: [2024, 2026],
      tags: [],
      metadata: {},
    };
    const { emitted } = render(ItemForm, {
      props: { mode: 'edit', initial },
    });

    await submitForm();

    const item = (emitted().submit as [Item][])[0]![0];
    expect(item.id).toBe('movie-tmdb-27205');
    expect(item.completed_years).toStrictEqual([2024, 2026]);
  });

  it('swaps the metadata block when the type changes', async () => {
    render(ItemForm, { props: { mode: 'create' } });

    await fireEvent.update(screen.getByLabelText('Type'), 'book');
    expect(screen.getByText('Book details')).toBeInTheDocument();
    expect(screen.getByLabelText('Series')).toBeInTheDocument();

    await fireEvent.update(screen.getByLabelText('Type'), 'show');
    expect(screen.getByText('Show details')).toBeInTheDocument();
    expect(screen.getByLabelText('Season number')).toBeInTheDocument();
  });

  it('blocks submit and shows an error when the title is empty', async () => {
    const { emitted } = render(ItemForm, { props: { mode: 'create' } });

    await submitForm();

    expect(emitted().submit).toBeUndefined();
    expect(screen.getByRole('alert')).toHaveTextContent('Title is required.');
  });
});
