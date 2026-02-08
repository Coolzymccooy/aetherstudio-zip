import { initializeApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getAnalytics } from 'firebase/analytics';
import { getFirestore, type Firestore } from "firebase/firestore";

console.log("FB authDomain:", import.meta.env.VITE_FIREBASE_AUTH_DOMAIN);
console.log("FB projectId:", import.meta.env.VITE_FIREBASE_PROJECT_ID);
console.log("FB appId:", import.meta.env.VITE_FIREBASE_APP_ID);
console.log("FB apiKey exists?", !!import.meta.env.VITE_FIREBASE_API_KEY);


const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const hasFirebaseConfig = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);

let app = null;
export let auth: Auth | null = null;
let firestore: Firestore | null = null;

if (hasFirebaseConfig) {
  // Initialize Firebase
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  firestore = getFirestore(app);
} else {
  console.warn("Firebase config missing. Set VITE_FIREBASE_* env vars in production.");
}

// Initialize Analytics only in browser environment
let analytics = null;
if (typeof window !== 'undefined') {
  try {
     if (app) analytics = getAnalytics(app);
  } catch (e) {
     console.warn("Firebase Analytics failed to load (likely due to ad blocker or placeholder config).");
  }
}

export { analytics, firestore };
