/* =========================================================
   home.js: llena la portada desde Firestore
   1. La cinta (banner): 4 diapositivas que cambian solas
   2. Las 4 secciones en mosaico (color + ícono + descripción)
   3. "Recent studies": los últimos publicados
   4. "Coming soon": lo que Neil ya programó (lista pública site/upcoming)
   5. Cada sección (#good-news, etc.), About (#about) y Contact (#contact):
      en esta misma página, sin otro HTML

   LA CINTA se arma sola, sin que Neil haga nada:
     1. Verse of the week: cambia cada lunes (assets/verses.js)
     2. New: el estudio "nuevo". Si Neil sube varios de golpe, hacen FILA:
        cada uno es "el nuevo" durante 3 días (sin contar domingo) y luego
        pasa el siguiente. Cuando la fila se vacía, se queda el más reciente.
     3 y 4. From the library: 2 estudios que cambian cada 3 días (sin contar
        domingo). Van por turnos en un orden revuelto: cuando a uno ya le tocó,
        se va al final de la fila. Nunca repite el que está de "New".
   Todo se calcula con la fecha: cualquier persona ve lo mismo el mismo día,
   y no hace falta guardar nada.

   Si algún día existe el documento site/home con { slides: [...] }, se usan
   esas diapositivas en lugar de las automáticas (para el futuro "Site pages").
   ========================================================= */
import { db } from "./firebase.js";
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { SECTIONS, sectionName, sectionIcon } from "./sections.js";
import { verseOfTheWeek } from "./verses.js";
import { getPublished, readingLink, readTime } from "./studies.js";

const SLIDE_SECONDS = 6; // cada cuánto cambia la cinta sola
const TURN_DAYS = 3;     // cuántos días (sin contar domingo) dura cada turno

const $ = (id) => document.getElementById(id);

// Crea un elemento con texto (sin innerHTML para los datos)
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ---------- Turnos de la cinta ---------- */

// Número de "días que cuentan" (lunes a sábado) desde un lunes cualquiera.
// El domingo vale lo mismo que el sábado: así no avanza el turno.
const EPOCH = Date.UTC(2026, 10, 23); // lunes 23 de noviembre de 2026
function workday(dateLike) {
  const d = new Date(dateLike);
  const days = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 864e5);
  const weeks = Math.floor(days / 7);
  return weeks * 6 + Math.min(days - weeks * 7, 5);
}
const publishedMs = (x) => (x.data.publishAt && x.data.publishAt.toMillis ? x.data.publishAt.toMillis() : 0);

// Orden revuelto pero fijo para cada estudio (sale de su id): así "From the library"
// parece al azar, pero todos ven lo mismo y cada estudio tiene su turno.
function scramble(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function pickRibbonStudies(studies) {
  if (!studies.length) return { fresh: null, library: [] };
  const today = workday(Date.now());

  // Fila de "nuevos", del más viejo al más nuevo
  const asc = studies.slice().sort((p, q) => publishedMs(p) - publishedMs(q));
  let end = -Infinity, fresh = null;
  asc.forEach((x) => {
    const start = Math.max(workday(publishedMs(x)), end);
    end = start + TURN_DAYS;
    if (today >= start && today < end) fresh = x;
  });
  if (!fresh) fresh = studies[0]; // fila vacía: el más reciente

  // "From the library": todos menos el que está de "nuevo", en orden revuelto;
  // cada turno toma los 2 siguientes de la fila (los que ya salieron quedan al final)
  const pool = studies.filter((x) => x !== fresh);
  pool.sort((p, q) => scramble(p.id) - scramble(q.id));
  const turn = Math.floor(today / TURN_DAYS);
  const library = [];
  for (let k = 0; k < Math.min(2, pool.length); k++) {
    library.push(pool[(((turn * 2 + k) % pool.length) + pool.length) % pool.length]);
  }
  return { fresh, library };
}

/* ---------- 1. La cinta ---------- */

function verseSlide() {
  const v = verseOfTheWeek();
  return { kind: "verse", text: v.text, ref: v.ref, image: "assets/img/hero-bible.webp" };
}

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
    // Un estudio (ya elegido en s.item, o por id si viene de site/home)
    const item = s.item || studies.find((x) => x.id === s.id);
    if (!item) return null;
    const r = item.data;
    box = el("a", "slide sec-" + r.category);
    box.href = readingLink(item.id);
    s.image = s.image || r.image || null;
    wrapText();
    inner.append(el("p", "slide-kicker", (s.kicker || "From the library") + " · " + sectionName(r.category)),
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

function buildSlides(config, studies) {
  if (config && Array.isArray(config.slides) && config.slides.length) return config.slides.slice(0, 4);
  const { fresh, library } = pickRibbonStudies(studies);
  const slides = [verseSlide()];
  if (fresh) slides.push({ kind: "study", item: fresh, kicker: "New" });
  library.forEach((item) => slides.push({ kind: "study", item, kicker: "From the library" }));
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
  if (ribbon && ribbon.count > 1 && !calm) timer = setInterval(() => ribbon.go(ribbon.current + 1), SLIDE_SECONDS * 1000);
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
  restart(); // cambia sola (nunca si la persona pidió "menos movimiento")
}

/* ---------- 2. Las 4 secciones en mosaico ---------- */

// Pinta el mosaico en cada lugar que lo pida (class="sections"): la portada y About
function paintSections(items) {
  document.querySelectorAll(".sections").forEach((grid) => {
    grid.innerHTML = "";
    SECTIONS.forEach((s) => {
      const n = items.filter((x) => x.data.category === s.id).length;
      const a = el("a", "tile sec-" + s.id);
      a.href = "#" + s.id;
      const icon = el("span", "tile-icon");
      icon.innerHTML = sectionIcon(s.id); // dibujo fijo nuestro, no datos de afuera
      a.append(icon, el("h3", null, s.name), el("p", null, s.about));
      if (n) a.append(el("span", "tile-count", n === 1 ? "1 study" : n + " studies"));
      grid.appendChild(a);
    });
  });
}

/* ---------- 3-4. Recientes y próximos ---------- */

function paintRecent(items) {
  const list = $("recent");
  list.innerHTML = "";
  items.forEach((item) => {
    const r = item.data;
    const a = el("a", "recent-item");
    a.href = readingLink(item.id);
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

/* ---------- 5. Una sección (#good-news, etc.), en esta misma página ---------- */
// Arriba: marco redondeado con el grabado de fondo (ícono, nombre, descripción).
// Abajo: sus estudios en mosaico, del más nuevo al más viejo.

let allStudies = null; // null = todavía cargando

function studyTile(item) {
  const r = item.data;
  const a = el("a", "study-tile");
  a.href = readingLink(item.id);
  a.append(el("h2", null, r.title || ""));
  if (r.subtitle) a.append(el("p", "study-sub", r.subtitle));
  const passage = [r.book, r.passage].filter(Boolean).join(" ");
  a.append(el("p", "meta-line", (passage ? passage + " · " : "") + readTime(r)));
  return a;
}

function paintSectionView(s) {
  document.body.classList.remove(...SECTIONS.map((x) => "sec-" + x.id));
  document.body.classList.add("sec-" + s.id); // su color (--c) para toda la vista
  $("catIcon").innerHTML = sectionIcon(s.id); // dibujo fijo nuestro, no datos de afuera
  $("catTitle").textContent = s.name;
  $("catAbout").textContent = s.about;

  const grid = $("studyGrid");
  grid.innerHTML = "";
  if (allStudies === null) { $("catCount").textContent = "Loading…"; $("catEmpty").hidden = true; return; }
  const items = allStudies.filter((x) => x.data.category === s.id);
  items.forEach((x) => grid.appendChild(studyTile(x)));
  $("catCount").textContent = items.length === 1 ? "1 study" : items.length ? items.length + " studies" : "";
  $("catEmpty").hidden = items.length > 0;
}

// Qué se ve según lo que va después del # en la dirección
//   (nada) o #     → portada
//   #good-news…    → una sección
//   #about         → About
//   #contact       → Contact (el formulario lo maneja contact.js)
const PAGES = {
  about: { view: "aboutView", title: "About Neil Whatmough · Bible Talks" },
  contact: { view: "contactView", title: "Contact · Bible Talks" }
};
function route() {
  const s = SECTIONS.find((x) => "#" + x.id === location.hash);
  const page = PAGES[location.hash.slice(1)] || null;
  $("homeView").hidden = !!(s || page);
  $("sectionView").hidden = !s;
  Object.values(PAGES).forEach((p) => { $(p.view).hidden = p !== page; });
  document.title = s ? s.name + " · Bible Talks"
    : page ? page.title
    : "Bible Talks · Studies by Neil Whatmough";
  if (s) paintSectionView(s);
  else document.body.classList.remove(...SECTIONS.map((x) => "sec-" + x.id));
  if (s || page) stopTimer(); else restart(); // la cinta solo gira en la portada

  // Menú de arriba: marcar dónde estás y cerrarlo (en celular)
  const current = s || page ? location.hash : "#";
  document.querySelectorAll(".site-nav a").forEach((a) => {
    if (a.getAttribute("href") === current) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.body.classList.remove("nav-open");
  const menuBtn = $("menuBtn");
  if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

/* ---------- Cargar todo ---------- */

async function getSiteDoc(name) {
  try {
    const snap = await getDoc(doc(db, "site", name));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error("site/" + name + ":", e);
    return null;
  }
}

// Mientras carga: el versículo y las secciones ya se ven
startRibbon([verseSlide()], []);
paintSections([]);
route();

const [studies, home, upcomingDoc] = await Promise.all([getPublished(), getSiteDoc("home"), getSiteDoc("upcoming")]);
const today = new Date().toISOString().slice(0, 10);
const upcoming = ((upcomingDoc && upcomingDoc.items) || []).filter((u) => u.date > today);

allStudies = studies;
startRibbon(buildSlides(home, studies), studies);
paintSections(studies);
paintRecent(studies.slice(0, 6));
paintUpcoming(upcoming);
route(); // si se abrió directo en una sección, ahora ya con sus estudios
