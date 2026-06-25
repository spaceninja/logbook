<script setup lang="ts">
// The Dev link only renders under `nuxt dev`; built apps never show it.
const showDev = import.meta.dev;

const { isOwner, login, logout } = useAuth();
</script>

<template>
  <div>
    <header>
      <nav>
        <NuxtLink to="/">Home</NuxtLink>
        <NuxtLink to="/backlog">Backlog</NuxtLink>
        <NuxtLink to="/history">History</NuxtLink>
        <NuxtLink v-if="showDev" to="/dev">Dev</NuxtLink>

        <!-- Auth state is client-only; render it client-side to avoid a
             hydration mismatch against the logged-out SSR markup. -->
        <ClientOnly>
          <NuxtLink v-if="isOwner" to="/add">Add</NuxtLink>
          <button v-if="isOwner" type="button" @click="logout">Log out</button>
          <button v-else type="button" @click="login">
            Log in with GitHub
          </button>
        </ClientOnly>
      </nav>
    </header>
    <main>
      <slot />
    </main>
  </div>
</template>
