import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Initialize Analytics only in browser environment
let analytics = null;
if (typeof window !== 'undefined') {
  try {
     analytics = getAnalytics(app);
  } catch (e) {
     console.warn("Firebase Analytics failed to load (likely due to ad blocker or placeholder config).");
  }
}

export { analytics };

