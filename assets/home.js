/* =========================================================
   home.js: llena la portada desde Firestore
   1. La cinta (banner): hasta 4 diapositivas que cambian solas
   2. "Explore": las 4 secciones con cuántos estudios tiene cada una
   3. "Recent studies": los últimos publicados
   4. "Coming soon": lo que Neil ya programó (lista pública site/upcoming)

   La cinta:
   - Si existe el documento site/home (más adelante Neil lo arma desde su panel),
     se usan sus diapositivas: { slides: [ ... ] } con estos tipos:
       { kind: "verse",  text, ref, image? }          versículo del día/semana
       { kind: "study",  id, kicker? }                 un estudio que Neil elige
       { kind: "latest" }                              el estudio más nuevo
       { kind: "season", kicker, title, text, image?, link? }   aviso de temporada
   - Si no existe, se arma sola: versículo, lo más nuevo, uno recomendado
     de la biblioteca y lo próximo programado.
   ========================================================= */
import { db } from "./firebase.js";
import {
  collection, query, where, orderBy, limit, getDocs, getDoc, doc, Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// Descripciones públicas de cada sección (BORRADOR: Neil las revisa)
const SECTIONS = [
  { id: "good-news",   name: "Good News",   about: "Stories from Neil’s life and the way to salvation." },
  { id: "doctrine",    name: "Doctrine",    about: "How to live as a Christian." },
  { id: "bible-study", name: "Bible Study", about: "The Bible explained, passage by passage." },
  { id: "prophecy",    name: "Prophecy",    about: "Daniel, Isaiah, Ezekiel, Matthew 24, Revelation." }
];
const sectionName = (id) => (SECTIONS.find((s) => s.id === id) || {}).name || "";

const DEFAULT_VERSE = {
  kind: "verse",
  text: "All scripture is given by inspiration of God, and is profitable for doctrine, for reproof, for correction, for instruction in righteousness.",
  ref: "2 Timothy 3:16",
  image: "assets/img/hero-bible.webp"
};

const $ = (id) => document.getElementById(id);
const link = (id) => "reading.html?id=" + encodeURIComponent(id);

// ~200 palabras por minuto
function readTime(r) {
  const words = r.words || String(r.bodyHtml || "").replace(/<[^>]+>/g, " ").trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 200)) + " min read";
}

// Crea un elemento con texto (sin innerHTML para los datos)
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ---------- 1. La cinta ---------- */

function slideElement(s, studies) {
  let box, inner;
  const wrapText = () => { inner = el("div", "slide-text"); box.appendChild(inner); };

  if (s.kind === "verse") {
    box = el("div", "slide");
    wrapText();
    inner.append(el("p", "slide-kicker", s.kicker || "Verse of the week"),
                 el("p", "slide-verse", "“" + s.text + "”"),
                 el("p", "slide-ref", s.ref));
  } else if (s.kind === "season") {
    box = el(s.link ? "a" : "div", "slide");
    if (s.link) box.href = s.link;
    wrapText();
    inner.append(el("p", "slide-kicker", s.kicker || ""), el("h2", "slide-title", s.title || ""));
    if (s.text) inner.append(el("p", "slide-sub", s.text));
  } else {
    // Un estudio: el que eligió Neil ("study"), el más nuevo ("latest") o uno recomendado
    const item = s.kind === "latest" ? studies[0] : s.item || studies.find((x) => x.id === s.id);
    if (!item) return null;
    const r = item.data;
    box = el("a", "slide");
    box.href = link(item.id);
    s.image = s.image || r.image || null;
    wrapText();
    const kicker = s.kicker || (s.kind === "latest" ? "New this week" : "Recommended");
    inner.append(el("p", "slide-kicker", kicker + " · " + sectionName(r.category)),
                 el("h2", "slide-title", r.title));
    if (r.subtitle) inner.append(el("p", "slide-sub", r.subtitle));
    inner.append(el("p", "meta-line", readTime(r)),
                 el("span", "btn-read", "Read the study ›"));
  }

  if (s.image) {
    box.classList.add("has-img");
    box.style.backgroundImage = "url(\"" + encodeURI(s.image) + "\")";
  } else {
    box.classList.add("no-img");
  }
  return box;
}

function buildSlides(config, studies, upcoming) {
  if (config && Array.isArray(config.slides) && config.slides.length) return config.slides.slice(0, 4);

  // Automática (mientras Neil no la arme)
  const slides = [DEFAULT_VERSE];
  if (studies[0]) slides.push({ kind: "latest" });
  if (studies.length > 1) {
    // Recomendado: uno de la biblioteca (cambia cada semana, no en cada visita)
    const week = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
    const pool = studies.slice(1);
    slides.push({ kind: "study", item: pool[week % pool.length], kicker: "From the library" });
  }
  if (upcoming[0]) {
    const u = upcoming[0];
    slides.push({
      kind: "season",
      kicker: "Coming soon · " + new Date(u.date + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" }),
      title: u.title,
      text: sectionName(u.category)
    });
  }
  return slides;
}

// La cinta se arma dos veces (primero solo el versículo, luego con los estudios):
// el reloj y los controles viven aquí afuera para no duplicarse.
let timer = null;
let ribbon = null; // { go, current, count }
function stopTimer() { clearInterval(timer); }
function restart() {
  clearInterval(timer);
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (ribbon && ribbon.count > 1 && !calm) timer = setInterval(() => ribbon.go(ribbon.current + 1), 7000);
}
(function bindRibbonControls() {
  const box = $("ribbon");
  // Se detiene mientras el mouse o el teclado están encima
  box.addEventListener("mouseenter", stopTimer);
  box.addEventListener("mouseleave", restart);
  box.addEventListener("focusin", stopTimer);
  box.addEventListener("focusout", restart);
  $("ribbonPrev").addEventListener("click", () => { ribbon.go(ribbon.current - 1); restart(); });
  $("ribbonNext").addEventListener("click", () => { ribbon.go(ribbon.current + 1); restart(); });
  // Deslizar con el dedo
  let x0 = null;
  box.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  box.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) { ribbon.go(ribbon.current + (dx < 0 ? 1 : -1)); restart(); }
    x0 = null;
  });
})();

function startRibbon(slides, studies) {
  const track = $("ribbonTrack");
  const dots = $("ribbonDots");
  const els = slides.map((s) => slideElement(s, studies)).filter(Boolean);
  track.innerHTML = "";
  dots.innerHTML = "";
  els.forEach((e, i) => {
    e.setAttribute("role", "group");
    e.setAttribute("aria-roledescription", "slide");
    e.setAttribute("aria-label", (i + 1) + " of " + els.length);
    track.appendChild(e);
    const d = document.createElement("button");
    d.setAttribute("aria-label", "Show slide " + (i + 1));
    d.addEventListener("click", () => { ribbon.go(i); restart(); });
    dots.appendChild(d);
  });

  const many = els.length > 1;
  $("ribbonPrev").hidden = !many;
  $("ribbonNext").hidden = !many;
  dots.hidden = !many;

  const api = { current: 0, count: els.length, go(i) {
    api.current = (i + els.length) % els.length;
    track.style.transform = "translateX(" + (-100 * api.current) + "%)";
    els.forEach((e, k) => {
      const on = k === api.current;
      e.setAttribute("aria-hidden", String(!on));
      if (e.tagName === "A") e.tabIndex = on ? 0 : -1;
      e.querySelectorAll("a").forEach((x) => { x.tabIndex = on ? 0 : -1; });
    });
    Array.from(dots.children).forEach((d, k) => d.setAttribute("aria-current", String(k === api.current)));
  } };
  ribbon = api;
  api.go(0);
  restart(); // cambia sola cada 7 segundos (nunca si la persona pidió "menos movimiento")
}

/* ---------- 2-4. Secciones, recientes, próximos ---------- */

function paintSections(items) {
  const grid = $("sections");
  grid.innerHTML = "";
  SECTIONS.forEach((s) => {
    const n = items.filter((x) => x.data.category === s.id).length;
    const a = el("a", "section-link");
    a.href = "category.html?c=" + s.id;
    const h = el("h3", null, s.name);
    h.appendChild(el("small", null, n ? String(n) : ""));
    a.append(h, el("p", null, s.about));
    grid.appendChild(a);
  });
}

function paintRecent(items) {
  const list = $("recent");
  list.innerHTML = "";
  items.forEach((item) => {
    const r = item.data;
    const a = el("a", "recent-item");
    a.href = link(item.id);
    a.append(el("span", "label", sectionName(r.category)), el("h3", null, r.title),
             el("span", "meta-line", readTime(r)));
    list.appendChild(a);
  });
  $("recentBlock").hidden = items.length === 0;
}

function paintUpcoming(items) {
  const ul = $("upcoming");
  ul.innerHTML = "";
  items.forEach((u) => {
    const d = new Date(u.date + "T12:00:00");
    const li = el("li");
    const date = el("span", "date");
    date.append(el("b", null, String(d.getDate())),
                el("span", null, d.toLocaleDateString("en-US", { month: "short" })));
    li.append(date, el("strong", null, u.title), el("span", "label", sectionName(u.category)));
    ul.appendChild(li);
  });
  $("upcomingBlock").hidden = items.length === 0;
}

/* ---------- Cargar todo ---------- */

async function getStudies() {
  try {
    // Un par de minutos antes de "ahora", para que la hora del celular nunca vaya
    // adelantada respecto al servidor (si no, las reglas rechazan la consulta).
    const cutoff = Timestamp.fromMillis(Date.now() - 2 * 60 * 1000);
    const snap = await getDocs(query(
      collection(db, "readings"),
      where("status", "==", "published"),
      where("publishAt", "<=", cutoff),
      orderBy("publishAt", "desc"),
      limit(200)
    ));
    return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  } catch (e) {
    console.error("readings:", e); // la primera vez Firestore pide crear un índice (el error trae el enlace)
    return [];
  }
}

async function getSiteDoc(name) {
  try {
    const snap = await getDoc(doc(db, "site", name));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error("site/" + name + ":", e); // faltan las reglas nuevas en Firestore
    return null;
  }
}

// Mientras carga: el versículo y las secciones ya se ven
startRibbon([DEFAULT_VERSE], []);
paintSections([]);

const [studies, home, upcomingDoc] = await Promise.all([getStudies(), getSiteDoc("home"), getSiteDoc("upcoming")]);
const today = new Date().toISOString().slice(0, 10);
const upcoming = ((upcomingDoc && upcomingDoc.items) || []).filter((u) => u.date > today);

startRibbon(buildSlides(home, studies, upcoming), studies);
paintSections(studies);
paintRecent(studies.slice(0, 6));
paintUpcoming(upcoming);
