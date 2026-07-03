import { mockNuxtImport, renderSuspended } from '@nuxt/test-utils/runtime';
import { fireEvent, screen } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import UserMenu from './UserMenu.vue';

const { logoutMock } = vi.hoisted(() => ({ logoutMock: vi.fn() }));

// Stand in for the real Firebase-backed composable: a logged-in owner with an
// avatar, plus a spy for the logout action.
mockNuxtImport('useAuth', () => {
	return () => ({
		user: {
			value: {
				displayName: 'Scott Vandehey',
				photoURL: 'https://example.com/avatar.png',
			},
		},
		isOwner: { value: true },
		login: vi.fn(),
		logout: logoutMock,
	});
});

describe('UserMenu', () => {
	it('toggles the menu open and closed via the avatar button', async () => {
		await renderSuspended(UserMenu);
		const button = screen.getByRole('button', { name: 'Account menu' });

		expect(button).toHaveAttribute('aria-expanded', 'false');
		expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();

		await fireEvent.click(button);
		expect(button).toHaveAttribute('aria-expanded', 'true');
		expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
	});

	it('closes on Escape', async () => {
		await renderSuspended(UserMenu);
		const button = screen.getByRole('button', { name: 'Account menu' });

		await fireEvent.click(button);
		expect(button).toHaveAttribute('aria-expanded', 'true');

		await fireEvent.keyDown(document.body, { key: 'Escape' });
		expect(button).toHaveAttribute('aria-expanded', 'false');
	});

	it('offers the owner an Import link', async () => {
		await renderSuspended(UserMenu);

		await fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
		const link = screen.getByRole('link', { name: 'Import' });
		expect(link).toHaveAttribute('href', '/import');
	});

	it('calls logout when the Log out item is chosen', async () => {
		await renderSuspended(UserMenu);

		await fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

		expect(logoutMock).toHaveBeenCalledOnce();
	});
});
