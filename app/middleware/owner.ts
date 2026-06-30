/**
 * Restricts a route to the owner. Cosmetic gate (Firestore rules are the real
 * boundary); it keeps non-owners out of the add/edit forms.
 *
 * Auth is client-only, so this no-ops during SSR and waits for the auth state to
 * be known on the client before deciding — otherwise a direct load/refresh would
 * redirect the owner before their session is restored.
 */
export default defineNuxtRouteMiddleware(async () => {
	if (import.meta.server) return;

	await useNuxtApp().$authReady;

	const { isOwner } = useAuth();
	if (!isOwner.value) {
		return navigateTo('/');
	}
});
