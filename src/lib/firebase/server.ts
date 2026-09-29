import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

const config: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const serverProjectId = config.projectId ?? "";

if (!config.apiKey || !config.projectId || !config.authDomain || !config.appId) {
  throw new Error(
    "Firebase is not configured. Copy the NEXT_PUBLIC_FIREBASE_* values from the Buraq Public School Firebase project into .env.local.",
  );
}

function getServerApp(): FirebaseApp {
  const name = "buraq-sms-server";
  return getApps().some((app) => app.name === name)
    ? getApp(name)
    : initializeApp(config, name);
}

let firestoreInstance: Firestore | null = null;

export function getFirestoreDatabase(): Firestore {
  if (firestoreInstance) return firestoreInstance;
  const app = getServerApp();
  // Node 18+ ships a global WebSocket, so the default transport works here.
  // Passing both experimentalAutoDetectLongPolling and experimentalForceLongPolling
  // makes initializeFirestore throw, and re-initialising an app then fails for good.
  firestoreInstance = getFirestore(app);
  return firestoreInstance;
}
