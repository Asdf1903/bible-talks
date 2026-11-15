/* =========================================================
   reading-loader.js
   Decide QUÉ lectura mostrar y se la pasa al lector (reader.js).

   - reading.html?id=abc  → la trae de Firestore
   - reading.html         → la lectura de prueba (assets/sample-reading.js)

   El público solo puede abrir lecturas publicadas (lo cuidan las reglas
   de Firestore). Neil e Isra, con sesión iniciada, también ven borradores:
   así funciona la vista previa del panel.
   ========================================================= */
import { db, auth } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const id = new URLSearchParams(location.search).get("id");

// Convierte una fecha de Firestore en "2026-11-15"
function isoDate(ts) {
  const d = ts && ts.toDate ? ts.toDate() : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function showMissing() {
  document.getElementById("pages").innerHTML =
    '<div class="reading-missing"><h1>Reading not found</h1>' +
    "<p>This reading may have been moved, or it is not published yet.</p>" +
    '<p><a href="index.html">Go to the home page</a></p></div>';
  document.querySelector(".pager").hidden = true;
}

// Vista previa del panel (reading.html?preview=1, dentro de un iframe):
// la lectura no viene de Firestore, la manda el panel tal como está en el editor.
function previewMode() {
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== "bt-preview") return;
    window.BibleReader.start(e.data.reading);
  }, { once: true });
  window.parent.postMessage({ type: "bt-preview-ready" }, location.origin);
}

async function load() {
  if (new URLSearchParams(location.search).get("preview") && window.parent !== window) {
    previewMode();
    return;
  }
  if (!id) {
    window.BibleReader.start(window.SAMPLE_READING);
    return;
  }

  // Esperar a saber si hay sesión iniciada (para la vista previa de borradores)
  await auth.authStateReady();

  let snap;
  try {
    snap = await getDoc(doc(db, "readings", id));
  } catch (e) {
    // "permission-denied" = no está publicada y no eres Neil/Isra
    showMissing();
    return;
  }
  if (!snap.exists()) { showMissing(); return; }

  const r = snap.data();
  window.BibleReader.start({
    id: snap.id,
    category: r.category,
    title: r.title,
    subtitle: r.subtitle || "",
    author: r.author || "Neil Whatmough",
    publishedAt: isoDate(r.publishAt),
    pdfUrl: r.pdfUrl || null,
    bodyHtml: r.bodyHtml
  });

  // Vista previa de un borrador: aviso que también sirve para regresar al panel.
  // (Dentro del "celular" del panel no hace falta: ahí ya están los botones.)
  if (r.status !== "published" && window.self === window.top) {
    const banner = document.createElement("a");
    banner.className = "preview-banner";
    banner.href = "admin/#study/" + encodeURIComponent(snap.id); // el panel abre este estudio
    banner.textContent = "Preview · not published yet · ‹ Back to the desk";
    document.body.appendChild(banner);
  }
}

load();
