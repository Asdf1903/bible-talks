/* =========================================================
   ribbon.js: LAS REGLAS de la cinta de la portada (el banner que cambia solo)
   Lo usan la portada (home.js, para pintarla) y el panel (Site pages,
   para enseñarle a Neil qué se ve hoy y qué sigue). Así los dos calculan
   exactamente lo mismo. No usa Firebase: solo fechas y la lista de estudios.

   Las diapositivas, en orden:
     0. Featured (opcional): un estudio que Neil fija. Se queda siempre, primero,
        y ocupa el lugar de uno de los "From the library".
     1. Verse of the week: cambia cada lunes. Lista estándar (verses.js) o la
        lista propia de Neil, si la guardó en Site pages.
     2. New: si Neil sube varios de golpe, hacen FILA: cada uno es "el nuevo"
        durante 3 días (sin contar domingo) y luego pasa el siguiente.
        Si la fila está vacía, se queda el más reciente.
     3 y 4. From the library: 2 estudios que cambian cada 3 días (sin contar
        domingo), por turnos en un orden revuelto fijo. Nunca el mismo que "New".
     5. Seasonal message (opcional): un aviso que Neil prende y apaga.

   La configuración de Neil vive en Firestore, documento site/home:
     { verses: [{ ref, text }] | null, pinnedId: "id" | null,
       season: { on, kicker, title, text, link } | null }
   ========================================================= */
import { VERSES, verseOfTheWeek } from "./verses.js";

export const TURN_DAYS = 3; // cuántos días (sin contar domingo) dura cada turno

// Número de "días que cuentan" (lunes a sábado) desde un lunes cualquiera.
// El domingo vale lo mismo que el sábado: así no avanza el turno.
const EPOCH = Date.UTC(2026, 10, 23); // lunes 23 de noviembre de 2026
export function workday(dateLike) {
  const d = new Date(dateLike);
  const days = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 864e5);
  const weeks = Math.floor(days / 7);
  return weeks * 6 + Math.min(days - weeks * 7, 5);
}

const publishedMs = (x) => (x.data.publishAt && x.data.publishAt.toMillis ? x.data.publishAt.toMillis() : 0);

// Orden revuelto pero fijo para cada estudio (sale de su id)
function scramble(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// studies: publicados, del más nuevo al más viejo → { fresh, library: [a, b] }
export function pickRibbonStudies(studies, now = Date.now()) {
  if (!studies.length) return { fresh: null, library: [] };
  const today = workday(now);

  // Fila de "nuevos", del más viejo al más nuevo
  const asc = studies.slice().sort((p, q) => publishedMs(p) - publishedMs(q));
  let end = -Infinity, fresh = null;
  asc.forEach((x) => {
    const start = Math.max(workday(publishedMs(x)), end);
    end = start + TURN_DAYS;
    if (today >= start && today < end) fresh = x;
  });
  if (!fresh) fresh = studies[0]; // fila vacía: el más reciente

  // "From the library": todos menos el nuevo, en orden revuelto; cada turno, los 2 siguientes
  const pool = studies.filter((x) => x !== fresh);
  pool.sort((p, q) => scramble(p.id) - scramble(q.id));
  const turn = Math.floor(today / TURN_DAYS);
  const library = [];
  for (let k = 0; k < Math.min(2, pool.length); k++) {
    library.push(pool[(((turn * 2 + k) % pool.length) + pool.length) % pool.length]);
  }
  return { fresh, library };
}

// La lista de versículos que se usa: la de Neil (si guardó una) o la estándar
export const verseList = (config) =>
  (config && Array.isArray(config.verses) && config.verses.length ? config.verses : VERSES);

// Solo enlaces seguros para el aviso de temporada: del mismo sitio o http(s)
export function safeLink(link) {
  const s = String(link || "").trim();
  return /^(https?:\/\/|#|reading\.html|index\.html)/i.test(s) ? s : "";
}

// Las diapositivas de un día: [{ kind: "verse" | "study" | "season", ... }]
export function planSlides(studies, config, now = Date.now()) {
  config = config || {};
  const verse = verseOfTheWeek(new Date(now), verseList(config));
  const pinned = config.pinnedId ? studies.find((x) => x.id === config.pinnedId) || null : null;
  const rest = pinned ? studies.filter((x) => x !== pinned) : studies;
  const { fresh, library } = pickRibbonStudies(rest, now);

  const slides = [];
  if (pinned) slides.push({ kind: "study", item: pinned, kicker: "Featured", role: "pinned" });
  slides.push({ kind: "verse", text: verse.text, ref: verse.ref, role: "verse" });
  if (fresh) slides.push({ kind: "study", item: fresh, kicker: "New", role: "new" });
  library.slice(0, pinned ? 1 : 2).forEach((item) =>
    slides.push({ kind: "study", item, kicker: "From the library", role: "library" }));
  const s = config.season;
  if (s && s.on && s.title) {
    slides.push({ kind: "season", kicker: s.kicker || "", title: s.title, text: s.text || "",
      link: safeLink(s.link), role: "season" });
  }
  return slides;
}

// Para el panel: los próximos cambios de los estudios de la cinta.
// [{ date, fresh, library }] — el primero es hoy; los demás, cada día en que algo cambia.
export function upcomingChanges(studies, config, count = 5, maxDays = 90) {
  const out = [];
  let last = "";
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  for (let d = 0; d < maxDays && out.length < count; d++) {
    const day = new Date(start.getTime() + d * 864e5);
    const slides = planSlides(studies, config, day.getTime()).filter((x) => x.kind === "study" && x.role !== "pinned");
    const sig = slides.map((x) => x.role + ":" + x.item.id).join("|");
    if (sig !== last) {
      out.push({ date: day, fresh: (slides.find((x) => x.role === "new") || {}).item || null,
        library: slides.filter((x) => x.role === "library").map((x) => x.item) });
      last = sig;
    }
  }
  return out;
}

// Para el panel: los versículos de las próximas semanas [{ monday, verse }]
export function upcomingVerses(config, weeks = 5) {
  const list = verseList(config);
  const out = [];
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // el lunes de esta semana
  for (let w = 0; w < weeks; w++) {
    const monday = new Date(d.getTime() + w * 7 * 864e5);
    out.push({ monday, verse: verseOfTheWeek(monday, list) });
  }
  return out;
}
