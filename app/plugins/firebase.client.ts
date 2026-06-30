import { initializeApp } from 'firebase/app';
import { initializeFirestore, type Firestore } from 'firebase/firestore';
import {
	getAuth,
	onAuthStateChanged,
	type Auth,
	type User,
} from 'firebase/auth';

/**
 * Initializes the Firebase app, Firestore, and Auth from runtime config, and
 * exposes them as `$firestore` / `$auth`. Client-only: reads, the dev-only seed
 * writes, and auth all run in the browser this milestone (SSR is deferred).
 *
 * A single `onAuthStateChanged` listener mirrors the current user into shared
 * state (`useState('auth-user')`) so `useAuth()` can read it app-wide.
 */
export default defineNuxtPlugin(() => {
	const { firebase } = useRuntimeConfig().public;

	const app = initializeApp({
		apiKey: firebase.apiKey,
		authDomain: firebase.authDomain,
		projectId: firebase.projectId,
		storageBucket: firebase.storageBucket,
		messagingSenderId: firebase.messagingSenderId,
		appId: firebase.appId,
	});

	// Force HTTP long-polling instead of the default streaming WebChannel.
	//
	// Why: Safari (and content blockers / proxies / some firewalls) intermittently
	// kill the streaming `Listen/channel` request with a CORS "access control"
	// error, which hangs reads. Long-polling uses ordinary discrete XHR requests
	// and sidesteps that whole class of transport failures.
	//
	// Why force rather than `experimentalAutoDetectLongPolling`: forcing is the
	// heavier hammer (it never uses streaming, even where streaming would work),
	// but its only real cost is slightly higher per-read latency — and that cost
	// is cheap *for this app specifically* because we do only one-shot reads
	// (`getDocs`/`getDoc`) and no realtime `onSnapshot` listeners. Streaming's
	// advantage is efficient realtime push, which we never use, so we give up
	// almost nothing and gain deterministic reliability (no auto-detect probe to
	// be flaky). If you add `onSnapshot` listeners later, or want to chase read
	// latency, reconsider `experimentalAutoDetectLongPolling` (verify on Safari +
	// a content blocker first) — but do NOT drop to bare default streaming, which
	// reintroduces the hangs above.
	const firestore = initializeFirestore(app, {
		experimentalForceLongPolling: true,
	});

	const auth = getAuth(app);
	const user = useState<User | null>('auth-user', () => null);

	// Resolves once the SDK has restored (or confirmed the absence of) a session.
	// Route guards await this so they don't redirect the owner before auth is known.
	let markReady: () => void;
	const authReady = new Promise<void>((resolve) => {
		markReady = resolve;
	});
	onAuthStateChanged(auth, (next) => {
		user.value = next;
		markReady();
	});

	return {
		provide: {
			firestore: firestore as Firestore,
			auth: auth as Auth,
			authReady,
		},
	};
});
