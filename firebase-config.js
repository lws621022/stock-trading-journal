import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// Firebase Web API key 是公開的專案識別資訊；真正的存取權限由 Authentication 與 Firestore Rules 控制。
export const firebaseConfig = Object.freeze({
  apiKey: "AIzaSyCWashYDL3e4yaHyhjZ9C22FSJc_1xxrAs",
  authDomain: "stock-dividend-tracker-66494.firebaseapp.com",
  projectId: "stock-dividend-tracker-66494",
  storageBucket: "stock-dividend-tracker-66494.firebasestorage.app",
  messagingSenderId: "494181301214",
  appId: "1:494181301214:web:64382ffdf6b72ebf7f7b4f"
});

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);
export const googleProvider = new GoogleAuthProvider();

export function initializeAuthPersistence() {
  return setPersistence(auth, browserLocalPersistence);
}
