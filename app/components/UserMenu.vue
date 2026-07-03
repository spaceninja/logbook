<template>
	<nav ref="navEl" class="user-menu" aria-label="Account">
		<button
			ref="toggleEl"
			type="button"
			class="user-menu__avatar button--reset"
			:aria-expanded="isOpen"
			aria-label="Account menu"
			@click="isOpen = !isOpen"
		>
			<img
				v-if="photoURL"
				class="user-menu__img"
				:src="photoURL"
				alt=""
				width="32"
				height="32"
				referrerpolicy="no-referrer"
			/>
			<span v-else class="user-menu__initials" aria-hidden="true">
				{{ initials }}
			</span>
		</button>
		<ul class="user-menu__list" :hidden="!isOpen">
			<li v-if="isOwner" class="user-menu__item">
				<NuxtLink to="/import" class="user-menu__link" @click="close">
					Import
				</NuxtLink>
			</li>
			<li class="user-menu__item">
				<button
					type="button"
					class="user-menu__button button--reset"
					@click="onLogout"
				>
					Log out
				</button>
			</li>
		</ul>
	</nav>
</template>

<script setup lang="ts">
import { onClickOutside, onKeyStroke } from '@vueuse/core';

const { user, isOwner, logout } = useAuth();

const isOpen = ref(false);
const navEl = ref<HTMLElement | null>(null);
const toggleEl = ref<HTMLButtonElement | null>(null);

// GitHub serves resized avatars via a `s=` (size) query param, so we request
// 64px (2× the 32px render size) instead of downloading the full-res original.
const photoURL = computed(() => {
	const url = user.value?.photoURL;
	if (!url) return '';
	try {
		const parsed = new URL(url);
		parsed.searchParams.set('s', '64');
		return parsed.toString();
	} catch {
		return url;
	}
});

// Fall back to initials when GitHub gives us no avatar: "Scott Vandehey" → "SV",
// a single name → its first letter, nothing usable → "?".
const initials = computed(() => {
	const name = user.value?.displayName?.trim();
	if (!name) return '?';
	const parts = name.split(/\s+/);
	const first = parts[0]!.charAt(0);
	const last = parts.length > 1 ? parts.at(-1)!.charAt(0) : '';
	return (first + last).toUpperCase();
});

function close() {
	isOpen.value = false;
}

async function onLogout() {
	close();
	await logout();
}

// The avatar lives inside `navEl`, so clicking it to open the menu is treated as
// an inside click and never immediately re-closes.
onClickOutside(navEl, close);

// Escape closes and returns focus to the avatar, per the menu-button pattern.
onKeyStroke('Escape', () => {
	if (!isOpen.value) return;
	close();
	toggleEl.value?.focus();
});
</script>

<style scoped>
.user-menu {
	position: relative;
}

.user-menu__avatar {
	border-radius: 50%;
	display: block;
	overflow: hidden;

	&:hover,
	&:focus {
		outline: 2px solid var(--color-border);
	}
}

.user-menu__img,
.user-menu__initials {
	block-size: 32px;
	inline-size: 32px;
}

.user-menu__img {
	object-fit: cover;
}

.user-menu__initials {
	align-items: center;
	background: var(--color-currentcolor-20);
	display: flex;
	font-weight: 700;
	justify-content: center;
}

.user-menu__list {
	background: light-dark(lightblue, black);
	border: 1px solid var(--color-border);
	border-radius: 0.25em;
	box-shadow: 0 6px 20px rgb(0 0 0 / 40%);
	color: light-dark(black, white);
	inset-block-start: calc(100% + 0.5em);
	inset-inline-end: 0;
	list-style: none;
	margin: 0;
	min-inline-size: 8em;
	overflow: hidden;
	padding: 0;
	position: absolute;
	z-index: 10;
}

.user-menu__button,
.user-menu__link {
	display: block;
	font-stretch: initial;
	font-weight: 500;
	letter-spacing: initial;
	padding: 0.15em 0.5em;
	text-align: left;
	text-decoration: none;
	width: 100%;

	&:hover,
	&:focus {
		background: var(--color-currentcolor-20);
	}
}
</style>
