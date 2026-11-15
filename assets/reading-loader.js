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

async function load() {
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

  if (r.status !== "published") {
    const banner = document.createElement("div");
    banner.className = "preview-banner";
    banner.textContent = "Preview · not published yet";
    document.body.appendChild(banner);
  }
}

load();
