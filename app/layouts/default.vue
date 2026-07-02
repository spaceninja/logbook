<template>
	<div class="page">
		<header class="site-header">
			<div class="site-header__inner">
				<NuxtLink to="/" class="site-logo">
					<span class="logo">🪵</span> <span class="logotype">Logbook</span>
				</NuxtLink>
				<nav class="site-nav">
					<NuxtLink to="/">Backlog</NuxtLink>
					<NuxtLink to="/history">History</NuxtLink>
					<!-- Auth state is client-only; render it client-side to avoid a
							 hydration mismatch against the logged-out SSR markup. -->
					<ClientOnly>
						<template v-if="user">
							<NuxtLink v-if="isOwner" to="/add" class="add-button">
								<svg width="12" height="12" viewBox="0 0 32 32">
									<path
										d="M28 12h-8V4a4 4 0 1 0-8 0v8H4a4 4 0 1 0 0 8h8v8a4 4 0 1 0 8 0v-8h8a4 4 0 1 0 0-8"
									/>
								</svg>
								<span>Add</span>
							</NuxtLink>
							<UserMenu />
						</template>
						<button
							v-else
							type="button"
							class="button button--reset"
							@click="login"
						>
							Log in
						</button>
					</ClientOnly>
				</nav>
			</div>
		</header>
		<main class="site-main">
			<div class="site-main__inner">
				<slot />
			</div>
		</main>
		<footer class="site-footer">
			<div class="site-footer__inner">
				<div class="site-legal">
					Metadata provided by <a href="https://www.themoviedb.org">TMDB</a>,
					<a href="https://www.igdb.com">IGDB</a>,
					<a href="https://books.google.com">Google Books</a>,
					<a href="https://www.goodreads.com">Goodreads</a>, and
					<a href="https://www.justwatch.com">JustWatch</a>
				</div>
				<nav class="footer-nav">
					<NuxtLink v-if="showDev" class="button" to="/dev">Dev</NuxtLink>
				</nav>
			</div>
		</footer>
	</div>
</template>

<script setup lang="ts">
// The Dev link only renders under `nuxt dev`; built apps never show it.
const showDev = import.meta.dev;

const { user, isOwner, login } = useAuth();
</script>
