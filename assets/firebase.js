/* =========================================================
   firebase.js
   Abre la conexión con Firebase una sola vez y la comparte.
   Lo usan el panel (/admin/) y la página de lectura.

   La versión de Firebase está fija (11.0.2) para que nada cambie solo.
   ========================================================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { firebaseConfig, FIREBASE_ENV } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const ENV = FIREBASE_ENV; // "real" o "test"

