/* =========================================================
   studies.js: trae los estudios publicados de Firestore
   Lo usa home.js (la portada y las secciones, que viven en index.html).
   Usa el índice (status + publishAt) de firestore.indexes.json: si falta,
   Firestore da un error con un enlace para crearlo (sale en la consola).
   ========================================================= */
import { db } from "./firebase.js";
import {
  collection, query, where, orderBy, limit, getDocs, Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// Todos los publicados, del más nuevo al más viejo: [{ id, data }]
export async function getPublished() {
  try {
    // Un par de minutos antes de "ahora", para que la hora del celular nunca vaya
    // adelantada respecto al servidor (si no, las reglas rechazan la consulta).
    const cutoff = Timestamp.fromMillis(Date.now() - 2 * 60 * 1000);
    const snap = await getDocs(query(
      collection(db, "readings"),
      where("status", "==", "published"),
      where("publishAt", "<=", cutoff),
      orderBy("publishAt", "desc"),
      limit(500)
    ));
    return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  } catch (e) {
    console.error("readings:", e); // si dice "requires an index", el error trae el enlace para crearlo
    return [];
  }
}

export const readingLink = (id) => "reading.html?id=" + encodeURIComponent(id);

// ~200 palabras por minuto
export function readTime(r) {
  const words = r.words || String(r.bodyHtml || "").replace(/<[^>]+>/g, " ").trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 200)) + " min read";
}
