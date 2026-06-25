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
  // Safari (and content blockers / proxies) intermittently kill the streaming
  // `Listen/channel` request with a CORS "access control" error, which hangs
  // reads. Long-polling uses ordinary XHR and sidesteps that.
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
