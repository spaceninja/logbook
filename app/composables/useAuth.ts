import {
	GithubAuthProvider,
	signInWithPopup,
	signOut,
	type Auth,
	type User,
} from 'firebase/auth';

/**
 * Auth state and actions. `user` mirrors the Firebase Auth session (populated by
 * the listener in the firebase plugin); `isOwner` gates write controls in the UI.
 * The real write enforcement is the Firestore rules — this is cosmetic.
 *
 * `$auth` is client-only, so `login`/`logout` resolve it lazily (they only run
 * from browser event handlers).
 */
export function useAuth() {
	const nuxtApp = useNuxtApp();
	const user = useState<User | null>('auth-user', () => null);
	const ownerUid = useRuntimeConfig().public.ownerUid;

	const isOwner = computed(
		() => !!user.value && !!ownerUid && user.value.uid === ownerUid,
	);

	async function login(): Promise<void> {
		const auth = nuxtApp.$auth as Auth;
		await signInWithPopup(auth, new GithubAuthProvider());
	}

	async function logout(): Promise<void> {
		const auth = nuxtApp.$auth as Auth;
		await signOut(auth);
	}

	return { user, isOwner, login, logout };
}
