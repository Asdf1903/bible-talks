/* =========================================================
   contact.js: el formulario de Contact (index.html#contact)
   Guarda cada mensaje en Firestore, colección `messages`:
     { name, email, type, message, status: "new", createdAt }
   Las reglas de Firestore dejan que CUALQUIERA cree un mensaje (bien formado),
   pero solo Neil e Isra los pueden leer, desde el panel (Messages).
   ========================================================= */
import { db } from "./firebase.js";
import {
  collection, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const form = $("contactForm");

function showError(msg, field) {
  $("cfError").textContent = msg;
  $("cfError").hidden = !msg;
  if (field) field.focus();
}

// Si alguien acaba de mandar uno, que no mande el mismo 5 veces seguidas
const WAIT_SECONDS = 30;
function sentRecently() {
  try { return Date.now() - Number(localStorage.getItem("bt-msg-sent") || 0) < WAIT_SECONDS * 1000; }
  catch (e) { return false; }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("cfName").value.trim();
  const email = $("cfEmail").value.trim();
  const type = $("cfType").value;
  const message = $("cfMessage").value.trim();

  if (!name) return showError("Please write your name.", $("cfName"));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showError("Please check your email address.", $("cfEmail"));
  if (!type) return showError("Please choose what kind of message it is.", $("cfType"));
  if (!message) return showError("Please write your message.", $("cfMessage"));
  if (sentRecently()) return showError("Your message was just sent. Please wait a moment before sending another.");
  showError("");

  // Trampa para robots: si el campo escondido viene lleno, se "acepta" pero no se guarda
  if ($("cfWebsite").value) { done(); return; }

  const btn = $("cfSend");
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    await addDoc(collection(db, "messages"), {
      name, email, type, message, status: "new", createdAt: serverTimestamp()
    });
    try { localStorage.setItem("bt-msg-sent", String(Date.now())); } catch (err) { /* no pasa nada */ }
    done();
  } catch (err) {
    console.error("messages:", err);
    showError("Sorry, the message could not be sent. Please check your internet connection and try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Send message";
  }
});

function done() {
  form.reset();
  form.hidden = true;
  $("cfDone").hidden = false;
  window.scrollTo(0, 0);
}

// Si vuelve a entrar a Contact después de mandar uno, se ve el formulario otra vez
window.addEventListener("hashchange", () => {
  if (location.hash === "#contact") { form.hidden = false; $("cfDone").hidden = true; }
});
