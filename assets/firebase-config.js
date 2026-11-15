/*
 * firebase-config.js
 * ------------------
 * Las "direcciones" de los dos proyectos de Firebase de Bible Talks.
 * (La cuenta dueña está anotada en BITACORA.md, que no se sube.)
 *
 * Esto NO es secreto: cualquier sitio que usa Firebase muestra estos datos.
 * La seguridad real está en las reglas de Firestore (quién puede leer/escribir).
 *
 * Cuál se usa:
 *   - En el sitio de verdad (bible-talks.com, www.bible-talks.com,
 *     bible-talks.vercel.app)  → proyecto REAL  (bible-talks-ee75e)
 *   - En cualquier otro lado (tu compu, links de prueba de Vercel)
 *                               → proyecto TEST  (bible-talks-test)
 *   Así una prueba nunca toca las lecturas reales de Neil.
 *
 * Es un "módulo": lo importa assets/firebase.js (no se carga solo).
 */

const FIREBASE_CONFIGS = {
  real: {
    apiKey: "AIzaSyDi2yoQFw0y72390UrCr3KvUmWlJA1RH4I",
    authDomain: "bible-talks-ee75e.firebaseapp.com",
    projectId: "bible-talks-ee75e",
    storageBucket: "bible-talks-ee75e.firebasestorage.app",
    messagingSenderId: "254875459139",
    appId: "1:254875459139:web:2bd6904084808f59c27ef6"
  },

  test: {
    apiKey: "AIzaSyAwJywEm7S0WtGfk-A_mvE31y9s0jsn9D4",
    authDomain: "bible-talks-test.firebaseapp.com",
    projectId: "bible-talks-test",
    storageBucket: "bible-talks-test.firebasestorage.app",
    messagingSenderId: "654756455577",
    appId: "1:654756455577:web:6ef01542327c7eaeb28408"
  }
};

const REAL_HOSTS = ["bible-talks.com", "www.bible-talks.com", "bible-talks.vercel.app"];

export const FIREBASE_ENV = REAL_HOSTS.includes(location.hostname) ? "real" : "test";
export const firebaseConfig = FIREBASE_CONFIGS[FIREBASE_ENV];
