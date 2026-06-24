import { initializeApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';

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

  const firestore = getFirestore(app);

  return {
    provide: {
      firestore: firestore as Firestore,
    },
  };
});
