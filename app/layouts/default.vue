<template>
	<header class="site-header">
		<div class="site-header__inner">
			<div class="site-logo">
				<span class="logo">🪵</span> <span class="logotype">Logbook</span>
			</div>
			<nav class="site-nav">
				<NuxtLink to="/">Backlog</NuxtLink>
				<NuxtLink to="/history">History</NuxtLink>
				<NuxtLink v-if="showDev" to="/dev">Dev</NuxtLink>
				<!-- Auth state is client-only; render it client-side to avoid a
							 hydration mismatch against the logged-out SSR markup. -->
				<ClientOnly>
					<template v-if="user">
						<NuxtLink v-if="isOwner" to="/add">Add</NuxtLink>
						<UserMenu />
					</template>
					<button v-else type="button" @click="login">Log in</button>
				</ClientOnly>
			</nav>
		</div>
	</header>
	<main>
		<slot />
	</main>
</template>

<script setup lang="ts">
// The Dev link only renders under `nuxt dev`; built apps never show it.
const showDev = import.meta.dev;

const { user, isOwner, login } = useAuth();
</script>
