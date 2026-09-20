import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);

// Handle firestoreDatabaseId correctly
const databaseId = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)' 
  ? firebaseConfig.firestoreDatabaseId 
  : undefined;

// Initialize Firestore with long polling to avoid connection issues in some environments
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, databaseId);

export const auth = getAuth();
