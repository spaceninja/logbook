<template>
	<!-- Navigation menu button pattern: a plain disclosure that toggles
	     `aria-expanded` on the avatar and `hidden` on the list. No `role=menu`
	     or arrow-key handling — just the minimal show/hide.
	     @see https://inclusive-components.design/menus-menu-buttons/ -->
	<nav ref="root" class="user-menu" aria-label="Account">
		<button
			ref="toggle"
			type="button"
			class="user-menu__avatar"
			:aria-expanded="open"
			aria-label="Account menu"
			@click="open = !open"
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
		<ul class="user-menu__list" :hidden="!open">
			<li>
				<button type="button" class="user-menu__item" @click="onLogout">
					Log out
				</button>
			</li>
		</ul>
	</nav>
</template>

<script setup lang="ts">
import { onClickOutside, onKeyStroke } from '@vueuse/core';

const { user, logout } = useAuth();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const toggle = ref<HTMLButtonElement | null>(null);

const photoURL = computed(() => user.value?.photoURL ?? '');

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
	open.value = false;
}

async function onLogout() {
	close();
	await logout();
}

// The avatar lives inside `root`, so clicking it to open the menu is treated as
// an inside click and never immediately re-closes.
onClickOutside(root, close);

// Escape closes and returns focus to the avatar, per the menu-button pattern.
onKeyStroke('Escape', () => {
	if (!open.value) return;
	close();
	toggle.value?.focus();
});
</script>

<style scoped>
.user-menu {
	display: flex;
	position: relative;
}

.user-menu__avatar {
	appearance: none;
	background: none;
	border: 0;
	border-radius: 50%;
	cursor: pointer;
	display: block;
	padding: 0;
}

.user-menu__img,
.user-menu__initials {
	block-size: 32px;
	border-radius: 50%;
	box-sizing: border-box;
	display: block;
	inline-size: 32px;
}

.user-menu__img {
	object-fit: cover;
}

.user-menu__initials {
	align-items: center;
	background: color-mix(in srgb, currentcolor 25%, transparent);
	color: currentcolor;
	display: flex;
	font-size: 0.8em;
	font-weight: 700;
	justify-content: center;
	letter-spacing: 0;
}

.user-menu__list {
	background: #444;
	border: 1px solid color-mix(in srgb, currentcolor 30%, transparent);
	border-radius: 0.5em;
	box-shadow: 0 6px 20px rgb(0 0 0 / 40%);
	inset-block-start: calc(100% + 0.5em);
	inset-inline-end: 0;
	list-style: none;
	margin: 0;
	min-inline-size: 8em;
	padding: 0.33em;
	position: absolute;
	z-index: 10;
}

.user-menu__list[hidden] {
	display: none;
}

.user-menu__item {
	appearance: none;
	background: none;
	border: 0;
	border-radius: 0.33em;
	color: currentcolor;
	cursor: pointer;
	display: block;
	font: inherit;
	inline-size: 100%;
	letter-spacing: 0.1ch;
	padding: 0.5em 0.66em;
	text-align: start;
	text-transform: none;
}

.user-menu__item:hover,
.user-menu__item:focus-visible {
	background: color-mix(in srgb, currentcolor 15%, transparent);
}
</style>
