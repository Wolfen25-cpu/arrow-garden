// Optional accounts and cloud saves with Firebase (free Spark plan).
// The SDK is downloaded on demand from Google's CDN, so players who never
// open "Cuenta" never load it, and the game works fully without it.

import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

// Fields mirrored to Firestore. Must match firestore.rules.
const SYNCED = ['level', 'maxLevel', 'muted', 'vibration', 'showMoves', 'theme', 'progressAt', 'settingsAt'];

export const cloudEnabled = Boolean(firebaseConfig?.apiKey);

let fb = null;

export const isReady = () => fb !== null;

async function load() {
  if (fb) return fb;
  const [app, auth, store] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const instance = app.initializeApp(firebaseConfig);
  fb = { authApi: auth, storeApi: store, auth: auth.getAuth(instance), db: store.getFirestore(instance) };
  fb.auth.languageCode = 'es';
  return fb;
}

// Loads the SDK and reports the signed-in user now and on every change.
export async function start(onUser) {
  if (!cloudEnabled) throw new Error('cloud-disabled');
  const { auth, authApi } = await load();
  authApi.onAuthStateChanged(auth, (user) => {
    onUser(user ? { uid: user.uid, email: user.email ?? '', name: user.displayName ?? '' } : null);
  });
  // Surfaces errors from a redirect sign-in (the popup fallback on some phones).
  authApi.getRedirectResult(auth).catch(() => {});
}

// Must run straight from a click handler (no awaits before the popup opens),
// otherwise browsers block the popup. Requires start() to have finished.
export function signInWithGoogle() {
  const { auth, authApi } = fb;
  const provider = new authApi.GoogleAuthProvider();
  return authApi.signInWithPopup(auth, provider).catch((err) => {
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
      return authApi.signInWithRedirect(auth, provider);
    }
    throw err;
  });
}

export async function signIn(email, password) {
  const { auth, authApi } = await load();
  return authApi.signInWithEmailAndPassword(auth, email, password);
}

export async function signUp(email, password) {
  const { auth, authApi } = await load();
  return authApi.createUserWithEmailAndPassword(auth, email, password);
}

export async function resetPassword(email) {
  const { auth, authApi } = await load();
  return authApi.sendPasswordResetEmail(auth, email);
}

export async function signOut() {
  const { auth, authApi } = await load();
  return authApi.signOut(auth);
}

export async function pull(uid) {
  const { db, storeApi } = await load();
  const snap = await storeApi.getDoc(storeApi.doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

export async function push(uid, state) {
  const { db, storeApi } = await load();
  const data = Object.fromEntries(SYNCED.map((key) => [key, state[key]]));
  data.updatedAt = storeApi.serverTimestamp();
  return storeApi.setDoc(storeApi.doc(db, 'users', uid), data);
}
