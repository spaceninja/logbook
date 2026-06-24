<script setup lang="ts">
// The Dev link only renders under `nuxt dev`; built apps never show it.
const showDev = import.meta.dev;
</script>

<template>
  <div>
    <header>
      <nav>
        <NuxtLink to="/">Home</NuxtLink>
        <NuxtLink to="/backlog">Backlog</NuxtLink>
        <NuxtLink to="/history">History</NuxtLink>
        <NuxtLink v-if="showDev" to="/dev">Dev</NuxtLink>
      </nav>
    </header>
    <main>
      <slot />
    </main>
  </div>
</template>
