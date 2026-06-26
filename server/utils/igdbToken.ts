/**
 * Twitch app access token for IGDB, cached in module scope until shortly before
 * it expires (tokens last ~60 days). Re-exchanged on demand. Module scope is
 * per-server-instance, which is fine — a cold start just re-fetches once.
 */
// Plain ofetch $fetch (see tmdb.ts) — avoids internal-route type matching.
import { $fetch } from 'ofetch';

let cached: { token: string; expiresAt: number } | null = null;

export async function getIgdbToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) return cached.token;

  const { twitchClientId, twitchClientSecret } = useRuntimeConfig();
  const res = await $fetch<{ access_token: string; expires_in: number }>(
    'https://id.twitch.tv/oauth2/token',
    {
      method: 'POST',
      params: {
        client_id: twitchClientId,
        client_secret: twitchClientSecret,
        grant_type: 'client_credentials',
      },
    },
  );

  cached = { token: res.access_token, expiresAt: now + res.expires_in * 1000 };
  return res.access_token;
}
