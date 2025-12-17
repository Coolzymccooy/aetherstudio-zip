import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getAnalytics } from 'firebase/analytics';

console.log("FB authDomain:", import.meta.env.VITE_FIREBASE_AUTH_DOMAIN);
console.log("FB projectId:", import.meta.env.VITE_FIREBASE_PROJECT_ID);
console.log("FB appId:", import.meta.env.VITE_FIREBASE_APP_ID);
console.log("FB apiKey exists?", !!import.meta.env.VITE_FIREBASE_API_KEY);


const firebaseConfig = {
  apiKey: "AIzaSyAuc_qVtzxpk1EeahGt-_KoBEMxOTdBm5U",
  authDomain: "tiwaton-family-adventure.firebaseapp.com",
  projectId: "tiwaton-family-adventure",
  storageBucket: "tiwaton-family-adventure.firebasestorage.app",
  messagingSenderId: "53083980470",
  appId: "1:53083980470:web:43aac5d4d5f76c08f61c17"
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