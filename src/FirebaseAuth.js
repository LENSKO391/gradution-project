import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
  updateProfile
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// TODO: Replace with your actual Firebase Project Configuration
// You can find this in your Firebase Console -> Project Settings -> General
export const firebaseConfig = {
  apiKey: "AIzaSyDvi1I4VLxny6aspAAbJnYFDEE-e7oru-E",
  authDomain: "encryption-decryption-de3cd.firebaseapp.com",
  projectId: "encryption-decryption-de3cd",
  storageBucket: "encryption-decryption-de3cd.firebasestorage.app",
  messagingSenderId: "595294222148",
  appId: "1:595294222148:web:4cdb7633d2c288cb7ec911",
  measurementId: "G-NRGMHB32M4"
};

let app;
export let auth;
export let db;
export let storage;

console.log("Firebase Auth/DB initialized. Please ensure Email/Password and Google providers are enabled in Firebase Console.");

try {
  if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY") {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
  }
} catch(e) {
  console.warn("Firebase not properly configured:", e.message);
}

export const registerWithEmail = async (name, email, password) => {
  if (!auth) throw new Error("Firebase not initialized.");
  const res = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(res.user, { displayName: name });
  return res.user;
};

export const loginWithEmail = async (email, password) => {
  if (!auth) throw new Error("Firebase not initialized.");
  const res = await signInWithEmailAndPassword(auth, email, password);
  return res.user;
};

export const resetPassword = async (email) => {
  if (!auth) throw new Error("Firebase not initialized.");
  // Check if the email is registered before sending a reset link
  const methods = await fetchSignInMethodsForEmail(auth, email);
  if (!methods || methods.length === 0) {
    throw new Error("No account found with this email address. Please sign up first.");
  }
  await sendPasswordResetEmail(auth, email);
};

export const googleSignIn = async () => {
  if (!auth) throw new Error("Firebase config is missing in src/FirebaseAuth.js. Please update it with your actual keys from Firebase Console.");
  
  const provider = new GoogleAuthProvider();
  // Request Gmail Send scope so the user can send emails from their account
  provider.addScope('https://www.googleapis.com/auth/gmail.send');
  
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const token = credential.accessToken;
    const user = result.user;
    
    return {
      user: {
        name: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
        historyPin: '' // Maintain compatibility with your History system
      },
      accessToken: token
    };
  } catch (error) {
    throw new Error(error.message);
  }
};

export const logoutUser = () => {
    if(!auth) return;
    return signOut(auth);
};
