import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  version: "2",
  projectNumber: "883304829240",
  projectId: "listner-mvp-justus",
  appId: "1:883304829240:web:47f15d130932b89ee6b1cd",
  storageBucket: "listner-mvp-justus.firebasestorage.app",
  apiKey: "AIzaSyCWnFo5_xytHkllkPRmWufIbbYCAdhHn3w",
  authDomain: "listner-mvp-justus.firebaseapp.com",
  messagingSenderId: "883304829240"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
