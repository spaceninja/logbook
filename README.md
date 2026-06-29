# Logbook

A personal media tracker for **books, movies, shows, and video games** — one place to record what you want to consume next and what you've already finished.

Logbook lives at [log.oscorp.net](https://log.oscorp.net). It replaces a patchwork of separate services (Goodreads, Letterboxd, Trakt, and a games tracker) with a single, unified log you own.

## What it does

Everything you track — a book, a movie, a season of a show, or a game — is a single **item**, and two views read over that collection:

- **Backlog** — things you intend to get to (not yet started, in progress, or finished and flagged for a repeat).
- **History** — things you've completed, grouped by year.

Because the two views read different parts of an item (its current intent vs. its record of completions), an item can appear in both — for example, a book you've finished but want to re-read.

Adding things is meant to be low-effort: pick a media type, type a title, pick the match, and Logbook autofills the cover art, description, creator, release date, and other metadata from public sources (TMDB for movies and shows, Google Books for books, IGDB for games). You can also edit any field by hand.

## How it's built

Logbook is a [Nuxt](https://nuxt.com) (Vue) app backed by [Firebase](https://firebase.google.com):

- **Reads are public** — anyone can browse the Backlog and History.
- **Writes are owner-only** — adding, editing, and deleting requires logging in with GitHub, and is enforced by Firestore security rules.
- **Metadata lookups** during the add flow run through server-side proxy routes, so third-party API keys stay off the client.

It's designed to be **low-maintenance** (a fully managed backend with no servers to run), **instant** (edits are live immediately, with no rebuild), and **cheap** (it runs comfortably on free tiers).

## Status

Logbook is in active development. Planned and in-progress work — automated Goodreads sync, bulk import from other services, data backups, streaming availability, and more — is tracked in [GitHub Issues](https://github.com/spaceninja/logbook/issues).

Documentation on how to configure your own instance and import your existing data is coming soon (tracked in the issues above).
