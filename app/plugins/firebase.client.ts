import { initializeApp } from 'firebase/app';
import { initializeFirestore, type Firestore } from 'firebase/firestore';

/**
 * Initializes the Firebase app and Firestore from runtime config and exposes
 * the Firestore instance as `$firestore`. Client-only: reads (and the dev-only
 * seed writes) run in the browser this milestone; SSR data fetching is deferred.
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

  return {
    provide: {
      firestore: firestore as Firestore,
    },
  };
});
