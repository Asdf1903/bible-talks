/* =========================================================
   admin.js: la lógica del panel de Neil
   Qué hace, en orden:
     1. Datos fijos (secciones, libros) y fechas
     2. Entrar con Google y revisar que la cuenta tenga permiso (colección `admins`)
     3. Navegación: barra lateral + direcciones (#home, #studies, #study/abc…)
     4. Home, My studies y Bin (listas tipo Drive, menú ⋮)
     5. Nuevo estudio, paso 1: subir el Word (ventana o arrastrando)
     6. Editor, paso 2: datos a la izquierda + vista previa en vivo a la derecha
     7. Guardar, publicar, quitar del sitio, papelera, historial
     8. Messages: lo que la gente manda desde Contact
     9. Site pages: la cinta de la portada (qué se ve, qué sigue, ajustes)
   Los datos se guardan en Firestore, colección `readings`.
   ========================================================= */
import { auth, db, ENV } from "../assets/firebase.js";
import {
  GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, addDoc, collection, query, orderBy, limit, getDocs,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { planSlides, upcomingChanges, upcomingVerses, verseList, safeLink } from "../assets/ribbon.js";
import { VERSES } from "../assets/verses.js";
import { sectionIcon } from "../assets/sections.js";

const $ = (id) => document.getElementById(id);

/* ---------- 1. Datos fijos ---------- */

const CATEGORIES = [
  { id: "good-news",   name: "Good News",   biblical: false, about: "Stories from my life and what they taught me" },
  { id: "doctrine",    name: "Doctrine",    biblical: false, about: "Teachings about people and how to live as a Christian" },
  { id: "bible-study", name: "Bible Study", biblical: true,  about: "A book, chapter or verses of the Bible, explained" },
  { id: "prophecy",    name: "Prophecy",    biblical: true,  about: "Revelation, Daniel, Isaiah, Ezekiel, Matthew 24…" }
];

const BOOKS = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
  "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah",
  "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah",
  "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum",
  "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
  "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians",
  "Ephesians", "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy",
  "2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John",
  "3 John", "Jude", "Revelation"];

const catName = (id) => (CATEGORIES.find((c) => c.id === id) || {}).name || "";

/* Estado */
let user = null;
let allStudies = [];    // todos los estudios: [{ id, data, st }]
let study = null;       // el que está abierto en el editor
let savedSnapshot = ""; // cómo estaba el editor la última vez que se guardó (para saber si hay cambios)
let studiesTab = "published"; // pestaña de My studies (la que más usa Neil va primero)
let studiesSection = null;    // carpeta abierta: null = ver las 4 carpetas · "all" = todas juntas · o una sección
const NEIL = "Neil Whatmough";

/* ---------- Fechas ---------- */

const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const todayIso = () => isoOf(new Date());
const tsToIso = (ts) => isoOf(ts && ts.toDate ? ts.toDate() : new Date());
const millis = (ts) => (ts && ts.toMillis ? ts.toMillis() : 0);

function niceDate(iso, long) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", long
    ? { weekday: "long", month: "long", day: "numeric", year: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
}

// Fecha elegida → cuándo sale de verdad:
// hoy (o antes) = ahora mismo (hora del servidor); otro día = ese día a las 6 de la mañana
function publishMoment(iso) {
  if (iso <= todayIso()) return serverTimestamp();
  return Timestamp.fromDate(new Date(iso + "T06:00:00"));
}

function statusOf(r) {
  if (r.status === "published") {
    const when = r.publishAt && r.publishAt.toDate ? r.publishAt.toDate() : new Date();
    return when > new Date() ? { key: "scheduled", label: "Coming up" } : { key: "published", label: "On the website" };
  }
  if (r.status === "trashed") return { key: "trashed", label: "In the bin" };
  return { key: "draft", label: "Draft" };
}

/* ---------- Avisos cortos ("Published ✓") ---------- */

let toastTimer = null;
function toast(text, link) {
  const t = $("toast");
  t.textContent = text;
  if (link) {
    const a = document.createElement("a");
    a.href = link.href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = link.text;
    t.appendChild(a);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}

/* ---------- Tema claro / oscuro ---------- */
// Se guarda en "bt-theme", el mismo que usa el lector: así la vista previa
// y el sitio público también se ven en el tema que Neil eligió.
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function isDarkNow() {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === "dark" : systemDark.matches;
}

function paintThemeButton() {
  const dark = isDarkNow();
  document.body.classList.toggle("is-light", !dark);
  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  $("themeBtn").setAttribute("aria-label", label);
  $("themeBtn").title = label;
}

$("themeBtn").addEventListener("click", () => {
  const next = isDarkNow() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("bt-theme", next); } catch (e) { /* sin memoria: igual cambia ahora */ }
  paintThemeButton();
  if (document.body.dataset.view === "study") refreshPreview(true); // que la vista previa también cambie
});
systemDark.addEventListener("change", paintThemeButton);
paintThemeButton();

/* ---------- 2. Entrar ---------- */

if (ENV === "test") $("envBadge").hidden = false;

function showGate(name) {
  $("gate").hidden = false;
  $("app").hidden = true;
  ["loading", "signin", "noaccess"].forEach((n) => { $("gate-" + n).hidden = n !== name; });
}

$("signInBtn").addEventListener("click", async () => {
  $("signInError").hidden = true;
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
    $("signInError").textContent = "Something went wrong signing in. Please try again.";
    $("signInError").hidden = false;
    console.error(e);
  }
});

$("signOutBtn").addEventListener("click", () => {
  if (isDirty() && !confirm("You have changes that are not saved. Sign out anyway?")) return;
  signOut(auth);
});
$("noAccessSignOut").addEventListener("click", () => signOut(auth));

$("copyUidBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("uidBox").textContent);
    $("copyUidBtn").textContent = "Copied ✓";
  } catch (e) { /* si no se puede copiar, el número se puede seleccionar a mano */ }
});

onAuthStateChanged(auth, async (u) => {
  user = u;
  if (!u) { showGate("signin"); return; }

  let allowed = false;
  try {
    allowed = (await getDoc(doc(db, "admins", u.uid))).exists();
  } catch (e) {
    console.error(e);
  }
  if (!allowed) {
    $("noAccessEmail").textContent = u.email || "";
    $("uidBox").textContent = u.uid;
    showGate("noaccess");
    return;
  }

  const first = (u.displayName || "").split(" ")[0];
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  $("greeting").textContent = part + (first ? ", " + first : "");

  $("gate").hidden = true;
  $("app").hidden = false;
  await refreshStudies();
  route();
  refreshMessages(); // para el numerito de mensajes nuevos en el menú
});

/* ---------- 3. Navegación ---------- */
// La dirección dice qué cuarto se ve:
//   #home · #studies (= On the website) · #studies/<pestaña> (4 carpetas)
//   #studies/<pestaña>/<sección o all> (dentro de una carpeta)
//   #bin · #messages · #messages/archived · #site (Site pages)
//   #study/<id> (un estudio) · #new (el que se acaba de subir, aún sin guardar)

let currentHash = "";
let ignoreHash = false;

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== "view-" + name; });
  document.querySelectorAll("[data-nav]").forEach((a) => {
    a.classList.toggle("on", a.dataset.nav === name || (name === "study" && a.dataset.nav === "studies"));
  });
  document.body.dataset.view = name;
  closeMenu();
  closePop();
  $("main").scrollTo(0, 0); // la hoja de estudios es la que hace scroll
}

async function route() {
  const h = location.hash.slice(1) || "home";
  const [room, arg, sub] = h.split("/");

  if (room === "studies") {
    // #studies/<pestaña>/<carpeta>   ej. #studies/published/good-news · #studies/draft/all
    studiesTab = ["published", "scheduled", "draft", "all"].includes(arg) ? arg : "published";
    studiesSection = sub === "all" || CATEGORIES.some((c) => c.id === sub) ? sub : null;
    showView("studies");
    paintStudies();
  } else if (room === "bin") {
    showView("bin");
    paintBin();
  } else if (room === "site") {
    showView("site");
    await loadSiteConfig(); // lo que Neil haya guardado (versículos, estudio fijo, aviso)
    paintSite();
  } else if (room === "messages") {
    msgTab = arg === "archived" ? "archived" : "inbox";
    showView("messages");
    paintMessages();
    await refreshMessages(); // trae los más nuevos
    paintMessages();
  } else if (room === "study" && arg) {
    const id = decodeURIComponent(arg);
    if (!study || study.id !== id) {
      try {
        const snap = await getDoc(doc(db, "readings", id));
        if (!snap.exists()) { location.replace("#studies"); return; }
        loadStudy(snap.id, snap.data());
      } catch (e) {
        console.error(e);
        location.replace("#studies");
        return;
      }
    }
    showView("study");
    paintEditor();
  } else if (room === "new" && study && !study.id) {
    showView("study");
    paintEditor();
  } else {
    showView("home");
    paintHome();
  }
  currentHash = location.hash;
}

window.addEventListener("hashchange", () => {
  if (ignoreHash) { ignoreHash = false; return; }
  // Salir del editor con cambios sin guardar: preguntar primero
  if (document.body.dataset.view === "study" && isDirty() &&
      !confirm("You have changes that are not saved. Leave without saving?")) {
    ignoreHash = true;
    location.hash = currentHash;
    return;
  }
  if (!location.hash.startsWith("#study/") && location.hash !== "#new") {
    study = null; // al salir del editor se olvida el estudio abierto
  }
  route();
});

window.addEventListener("beforeunload", (e) => {
  if (isDirty()) { e.preventDefault(); e.returnValue = ""; }
});

// Menú ☰ en celular
function closeMenu() {
  document.body.classList.remove("menu-open");
  $("scrim").hidden = true;
  $("menuToggle").setAttribute("aria-expanded", "false");
}
$("menuToggle").addEventListener("click", () => {
  const open = !document.body.classList.contains("menu-open");
  document.body.classList.toggle("menu-open", open);
  $("scrim").hidden = !open;
  $("menuToggle").setAttribute("aria-expanded", String(open));
});
$("scrim").addEventListener("click", closeMenu);

/* ---------- 4. Listas ---------- */

async function refreshStudies() {
  try {
    const snap = await getDocs(query(collection(db, "readings"), orderBy("updatedAt", "desc"), limit(500)));
    allStudies = snap.docs.map((d) => ({ id: d.id, data: d.data(), st: statusOf(d.data()) }));
  } catch (e) {
    console.error(e);
  }
  const live = allStudies.filter((x) => x.st.key !== "trashed").length;
  const binned = allStudies.length - live;
  $("navStudiesCount").textContent = live || "";
  $("navBinCount").textContent = binned || "";
  publishUpcoming();
}

// "Coming soon" de la portada: el público no puede leer los estudios programados
// (las reglas los esconden hasta su fecha), así que el panel deja una lista pública
// solo con título, sección y fecha en site/upcoming. Se actualiza sola.
let lastUpcoming = null;
async function publishUpcoming() {
  const items = allStudies.filter((x) => x.st.key === "scheduled")
    .sort((p, q) => millis(p.data.publishAt) - millis(q.data.publishAt))
    .slice(0, 6)
    .map((x) => ({ title: x.data.title || "", category: x.data.category || "", date: tsToIso(x.data.publishAt) }));
  const json = JSON.stringify(items);
  if (json === lastUpcoming) return;
  try {
    await setDoc(doc(db, "site", "upcoming"), { items, updatedAt: serverTimestamp() });
    lastUpcoming = json;
  } catch (e) {
    console.error("site/upcoming:", e); // casi siempre: faltan las reglas nuevas en Firestore
  }
}

// Repinta lo que se esté viendo (después de mandar a la papelera, etc.)
async function refreshAndRepaint() {
  await refreshStudies();
  const v = document.body.dataset.view;
  if (v === "home") paintHome();
  if (v === "studies") paintStudies();
  if (v === "bin") paintBin();
}

const count = (key) => allStudies.filter((x) => x.st.key === key).length;

function headRow(kind) {
  const div = document.createElement("div");
  div.className = "file-row head" + (kind === "bin" ? " bin" : "");
  div.innerHTML = kind === "bin"
    ? "<span>Title</span><span>Section</span><span>Moved to the bin</span><span></span>"
    : "<span>Title</span><span>Section</span><span>Date</span><span>Status</span><span></span>";
  return div;
}

// Nombre de la sección con su puntito de color (cada sección tiene su color)
function paintSection(cell, id) {
  cell.textContent = "";
  if (!id) return;
  const dot = document.createElement("span");
  dot.className = "sec-dot sec-" + id;
  cell.append(dot, catName(id));
}

const KEBAB ='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/>' +
  '<circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';

// Un renglón tipo Drive: [W] Título | Sección | Fecha | Estado | ⋮
function fileRow(item) {
  const r = item.data;
  const row = document.createElement("div");
  row.className = "file-row";
  row.tabIndex = 0;
  row.innerHTML =
    '<div class="name"><span class="doc-icon" aria-hidden="true">W</span>' +
    '<div><strong></strong><span class="sub"></span></div></div>' +
    '<span class="cell c-section"></span><span class="cell c-date"></span>' +
    '<span><span class="chip"></span></span>' +
    '<button class="icon-btn" aria-label="More actions" aria-haspopup="menu">' + KEBAB + "</button>";
  const date = niceDate(tsToIso(r.publishAt));
  row.querySelector("strong").textContent = r.title || "(no title)";
  row.querySelector(".sub").textContent = catName(r.category) + " · " + date;
  paintSection(row.querySelector(".c-section"), r.category);
  row.querySelector(".c-date").textContent = date;
  const chip = row.querySelector(".chip");
  chip.textContent = item.st.label;
  chip.classList.add(item.st.key);

  const open = () => { location.hash = "#study/" + encodeURIComponent(item.id); };
  row.addEventListener("click", (e) => { if (!e.target.closest(".icon-btn")) open(); });
  row.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === row) open(); });
  row.querySelector(".icon-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    openPop(e.currentTarget, rowActions(item));
  });
  return row;
}

// Lo que ofrece el menú ⋮ de cada estudio
function rowActions(item) {
  const open = () => { location.hash = "#study/" + encodeURIComponent(item.id); };
  const acts = [{ label: "Open", run: open }];
  if (item.st.key === "published") {
    acts.push({ label: "View on the website", run: () => window.open("../reading.html?id=" + encodeURIComponent(item.id), "_blank") });
  }
  acts.push({ label: "Use a corrected Word file", run: () => {
    // El selector de archivos se abre aquí mismo (el navegador solo lo deja abrir justo después de un clic);
    // cuando Neil elige el archivo, se abre el estudio con el texto nuevo.
    pendingReplace = item.id;
    $("replaceInput").click();
  } });
  acts.push("-");
  acts.push({ label: "Move to the bin", danger: true, run: () => moveToBin(item.id, item.data) });
  return acts;
}

function paintHome() {
  $("statPublished").textContent = count("published");
  $("statScheduled").textContent = count("scheduled");
  $("statDraft").textContent = count("draft");

  // El programado más cercano; si no hay, el último publicado
  const next = allStudies.filter((x) => x.st.key === "scheduled")
    .sort((p, q) => millis(p.data.publishAt) - millis(q.data.publishAt))[0];
  const last = allStudies.filter((x) => x.st.key === "published")
    .sort((p, q) => millis(q.data.publishAt) - millis(p.data.publishAt))[0];
  const pick = next || last;
  const box = $("nextUp");
  box.hidden = !pick;
  if (pick) {
    box.innerHTML = '<span class="next-label"></span><strong></strong><span class="muted"></span>' +
      '<a class="link next-open">Open ›</a>';
    box.querySelector(".next-label").textContent = next ? "Next study goes out" : "Nothing is scheduled. Last one published";
    box.querySelector("strong").textContent = niceDate(tsToIso(pick.data.publishAt), true);
    box.querySelector(".muted").textContent = "“" + pick.data.title + "”";
    box.querySelector("a").href = "#study/" + encodeURIComponent(pick.id);
  }

  const recent = allStudies.filter((x) => x.st.key !== "trashed").slice(0, 5);
  const list = $("recentList");
  list.innerHTML = "";
  if (recent.length) list.appendChild(headRow());
  recent.forEach((x) => list.appendChild(fileRow(x)));
  $("recentEmpty").hidden = recent.length > 0;
}

/* My studies: primero 4 carpetas (una por sección); al abrir una, la lista.
   Cada pestaña (On the website, Drafts, Coming up, All) muestra sus propias
   carpetas: en "On the website" las carpetas solo traen lo publicado, etc.
   Si Neil escribe en el buscador, se salta las carpetas y busca en todo. */
const TAB_NAMES = { published: "On the website", draft: "Drafts", scheduled: "Coming up", all: "All" };

// Cada carpeta lleva el ícono de su sección (los mismos del sitio: assets/sections.js)

let sortBy = "new";
try { sortBy = localStorage.getItem("bt-admin-sort") || "new"; } catch (e) { /* sin memoria: el de siempre */ }

function sortItems(items) {
  const title = (x) => (x.data.title || "").toLowerCase();
  const by = {
    new: (p, q) => millis(q.data.publishAt) - millis(p.data.publishAt),
    old: (p, q) => millis(p.data.publishAt) - millis(q.data.publishAt),
    az: (p, q) => title(p).localeCompare(title(q)),
    za: (p, q) => title(q).localeCompare(title(p))
  };
  return items.sort(by[sortBy] || by.new);
}

function paintStudies() {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === studiesTab));
  const live = allStudies.filter((x) => x.st.key !== "trashed");
  const n = (k) => (k ? "(" + k + ")" : "");
  $("tabCountAll").textContent = n(live.length);
  $("tabCountPublished").textContent = n(count("published"));
  $("tabCountScheduled").textContent = n(count("scheduled"));
  $("tabCountDraft").textContent = n(count("draft"));

  const inTab = live.filter((x) => studiesTab === "all" || x.st.key === studiesTab);
  const words = $("searchInput").value.trim().toLowerCase();
  const showFolders = !studiesSection && !words;

  // --- Las 4 carpetas ---
  const folders = $("folders");
  folders.hidden = !showFolders;
  folders.innerHTML = "";
  if (showFolders) {
    CATEGORIES.forEach((c) => {
      const k = inTab.filter((x) => x.data.category === c.id).length;
      const a = document.createElement("a");
      a.className = "folder sec-" + c.id + (k ? "" : " is-empty");
      a.href = "#studies/" + studiesTab + "/" + c.id;
      a.innerHTML = '<span class="folder-icon">' + sectionIcon(c.id) + '</span>' +
        '<span class="folder-name"></span><span class="folder-count"></span>';
      a.querySelector(".folder-name").textContent = c.name;
      a.querySelector(".folder-count").textContent = k === 1 ? "1 study" : (k || "No") + " studies";
      folders.appendChild(a);
    });
    if (inTab.length) {
      const all = document.createElement("a");
      all.className = "folder-all link";
      all.href = "#studies/" + studiesTab + "/all";
      all.textContent = "See all " + inTab.length + " together ›";
      folders.appendChild(all);
    }
  }

  // --- La lista (dentro de una carpeta, o resultados de búsqueda) ---
  $("listBar").hidden = showFolders;
  $("pathTab").textContent = TAB_NAMES[studiesTab];
  $("pathBack").href = "#studies/" + studiesTab;
  $("pathHere").textContent = words ? "Search results"
    : studiesSection === "all" ? "All sections" : catName(studiesSection);
  $("sortInput").value = sortBy;

  const items = showFolders ? [] : sortItems(inTab.filter((x) =>
    (words || studiesSection === "all" || x.data.category === studiesSection) &&
    (!words || ((x.data.title || "") + " " + (x.data.subtitle || "")).toLowerCase().includes(words))));

  const list = $("studiesList");
  list.innerHTML = "";
  if (items.length) list.appendChild(headRow());
  items.forEach((x) => list.appendChild(fileRow(x)));

  const empty = $("studiesEmpty");
  empty.hidden = showFolders ? inTab.length > 0 || live.length > 0 : items.length > 0;
  empty.textContent = words ? "No studies match your search."
    : !live.length ? "No studies yet. Click “New study” or drag a Word document here."
    : studiesTab === "scheduled" ? "Nothing here. To publish on a later date, open “Publish it on a later date” when you publish."
    : studiesTab === "draft" ? "No drafts here."
    : "Nothing in this folder yet.";
}

$("searchInput").addEventListener("input", paintStudies);
$("sortInput").addEventListener("change", () => {
  sortBy = $("sortInput").value;
  try { localStorage.setItem("bt-admin-sort", sortBy); } catch (e) { /* no pasa nada */ }
  paintStudies();
});

function paintBin() {
  const items = allStudies.filter((x) => x.st.key === "trashed")
    .sort((p, q) => millis(q.data.trashedAt) - millis(p.data.trashedAt));
  const list = $("binList");
  list.innerHTML = "";
  if (items.length) list.appendChild(headRow("bin"));
  items.forEach((x) => {
    const row = document.createElement("div");
    row.className = "file-row bin";
    row.innerHTML =
      '<div class="name"><span class="doc-icon" aria-hidden="true">W</span>' +
      '<div><strong></strong><span class="sub"></span></div></div>' +
      '<span class="cell c-section"></span><span class="cell c-date"></span>' +
      '<button class="btn small">Put it back</button>';
    const when = x.data.trashedAt ? niceDate(tsToIso(x.data.trashedAt)) : "";
    row.querySelector("strong").textContent = x.data.title || "(no title)";
    row.querySelector(".sub").textContent = catName(x.data.category);
    paintSection(row.querySelector(".c-section"), x.data.category);
    row.querySelector(".c-date").textContent = when;
    const back = row.querySelector("button");
    back.addEventListener("click", async () => {
      back.disabled = true;
      try {
        await updateDoc(doc(db, "readings", x.id), {
          status: "draft", trashedAt: null, updatedAt: serverTimestamp(), updatedBy: user.uid
        });
        toast("“" + x.data.title + "” is back in My studies, as a draft.");
        refreshAndRepaint();
      } catch (e) { console.error(e); back.disabled = false; }
    });
    list.appendChild(row);
  });
  $("binEmpty").hidden = items.length > 0;
}

async function moveToBin(id, r) {
  const onSite = r.status === "published";
  const msg = "Move “" + r.title + "” to the bin?" +
    (onSite ? " It will come off the website." : "") + " You can put it back later.";
  if (!confirm(msg)) return false;
  try {
    await updateDoc(doc(db, "readings", id), {
      status: "trashed", trashedAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: user.uid
    });
    toast("Moved to the bin.");
    await refreshAndRepaint();
    return true;
  } catch (e) {
    console.error(e);
    toast("It couldn’t be moved. Please try again.");
    return false;
  }
}

/* Menú ⋮ (uno solo para todo el panel) */
function openPop(anchor, actions) {
  const menu = $("popMenu");
  menu.innerHTML = "";
  actions.forEach((a) => {
    if (a === "-") { menu.appendChild(document.createElement("hr")); return; }
    const b = document.createElement("button");
    b.setAttribute("role", "menuitem");
    b.textContent = a.label;
    if (a.danger) b.className = "danger";
    b.addEventListener("click", () => { closePop(); a.run(); });
    menu.appendChild(b);
  });
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + "px";
  menu.style.top = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + "px";
  menu.querySelector("button").focus();
}
function closePop() { $("popMenu").hidden = true; }
document.addEventListener("click", (e) => {
  if (!e.target.closest("#popMenu") && !e.target.closest("[aria-haspopup]")) closePop();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });
window.addEventListener("scroll", closePop, true);

/* ---------- 5. Nuevo estudio, paso 1: el Word ---------- */

function newStudy() {
  return { id: null, category: "", title: "", subtitle: "", book: "", passage: "",
           bodyHtml: "", words: 0, sourceName: "", status: "draft", date: todayIso(),
           publishAt: null, warnings: [], author: NEIL, image: "" };
}

function startNew() {
  if (isDirty() && !confirm("You have changes that are not saved. Start a new study anyway?")) return;
  $("fileInput").value = "";
  $("fileError").hidden = true;
  $("fileWorking").hidden = true;
  $("pickerHint").hidden = true;
  closeMenu();
  $("newDialog").showModal();
}
$("newStudyBtn").addEventListener("click", startNew);

// Lee el Word. Devuelve { result } o { error } (un mensaje amable para Neil)
async function readWord(file) {
  const name = (file.name || "").toLowerCase();
  const saveAs = "<br>Please open it in Word, choose <strong>File → Save As</strong>, pick " +
    "<strong>Word Document (.docx)</strong>, and try again with the new file.";
  if (name.endsWith(".doc")) return { error: "This is an older Word file (.doc)." + saveAs };
  if (name.endsWith(".rtf")) return { error: "This file is saved as Rich Text (.rtf)." + saveAs };
  if (name.endsWith(".pdf")) return { error: "This is a PDF. Please choose the <strong>Word</strong> version " +
    "of this study (it keeps your bold, italics and underlines)." };
  if (!name.endsWith(".docx")) return { error: "Please choose a Word document (its name ends in .docx)." };
  try {
    const result = await window.WordToReading.convert(await file.arrayBuffer());
    return { result };
  } catch (e) {
    console.error(e);
    if (e.message === "EMPTY") return { error: "This document looks empty. Is it the right file?" };
    if (e.message === "TOO_BIG") return { error: "This document is too big for the website. Please send it to Israel." };
    return { error: "Sorry, this document couldn’t be read. Please send it to Israel." };
  }
}

async function handleNewFile(file) {
  if (!file) return;
  if (!$("newDialog").open) $("newDialog").showModal();
  $("fileError").hidden = true;
  $("fileWorking").hidden = false;
  const { result, error } = await readWord(file);
  $("fileWorking").hidden = true;
  if (error) {
    $("fileError").innerHTML = error;
    $("fileError").hidden = false;
    $("fileInput").value = "";
    return;
  }
  study = newStudy();
  Object.assign(study, {
    title: result.title, subtitle: result.subtitle, bodyHtml: result.bodyHtml,
    words: result.words, warnings: result.warnings, sourceName: file.name
  });
  savedSnapshot = ""; // nuevo = todavía no se ha guardado nada
  $("newDialog").close();
  if (location.hash === "#new") route();
  else { ignoreHash = true; location.hash = "#new"; route(); }
}

$("fileInput").addEventListener("change", (e) => {
  $("pickerHint").hidden = true;
  handleNewFile(e.target.files[0]);
});

// La ventana de Windows para elegir archivo bloquea la página mientras está abierta
// (y a veces sale en el otro monitor). Mientras tanto, un aviso dice dónde buscarla.
// Se quita al elegir, al darle Cancel o cuando la página vuelve a tener el foco.
$("fileInput").addEventListener("click", () => { $("pickerHint").hidden = false; });
$("fileInput").addEventListener("cancel", () => { $("pickerHint").hidden = true; });
window.addEventListener("focus", () => {
  setTimeout(() => { $("pickerHint").hidden = true; }, 400);
});

const dropZone = $("dropZone");
["dragenter", "dragover"].forEach((ev) => dropZone.addEventListener(ev, (e) => {
  e.preventDefault(); e.stopPropagation(); dropZone.classList.add("over");
}));
["dragleave", "drop"].forEach((ev) => dropZone.addEventListener(ev, (e) => {
  e.preventDefault(); e.stopPropagation(); dropZone.classList.remove("over");
}));
dropZone.addEventListener("drop", (e) => handleNewFile(e.dataTransfer.files[0]));

// Arrastrar un Word sobre cualquier parte del panel (menos el editor) = nuevo estudio
let dragDepth = 0;
const draggingFile = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
const canDropHere = () => !$("app").hidden && document.body.dataset.view !== "study" && !$("newDialog").open;
window.addEventListener("dragenter", (e) => {
  if (!draggingFile(e) || !canDropHere()) return;
  dragDepth++;
  $("dropOverlay").hidden = false;
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $("dropOverlay").hidden = true;
});
window.addEventListener("dragover", (e) => { if (draggingFile(e)) e.preventDefault(); });
window.addEventListener("drop", (e) => {
  e.preventDefault(); // que el navegador no abra el archivo
  dragDepth = 0;
  $("dropOverlay").hidden = true;
  if (canDropHere() && e.dataTransfer.files[0]) handleNewFile(e.dataTransfer.files[0]);
});

/* ---------- 6. Editor (paso 2): datos + vista previa ---------- */

// Paso "Choose the section": 4 botones, cada uno con el color de su sección
CATEGORIES.forEach((c) => {
  const label = document.createElement("label");
  label.className = "sec-option sec-" + c.id;
  label.innerHTML = '<input type="radio" name="category"><span class="sec-dot"></span><span></span>';
  label.querySelector("input").value = c.id;
  label.lastChild.textContent = c.name;
  $("sectionPick").appendChild(label);
});
const getCategory = () => (document.querySelector('input[name="category"]:checked') || {}).value || "";
function setCategory(id) {
  document.querySelectorAll('input[name="category"]').forEach((r) => { r.checked = r.value === id; });
}

// Paso "Whose name goes on it?": Neil, anónimo u otro nombre.
// En Firestore: author = "Neil Whatmough" · "" (anónimo) · el otro nombre
function getAuthor() {
  const pick = (document.querySelector('input[name="author"]:checked') || {}).value || "neil";
  if (pick === "anon") return "";
  if (pick === "other") return $("authorOther").value.trim();
  return NEIL;
}
function setAuthor(name) {
  const pick = name === NEIL ? "neil" : name === "" ? "anon" : "other";
  document.querySelectorAll('input[name="author"]').forEach((r) => { r.checked = r.value === pick; });
  $("authorOther").value = pick === "other" ? name : "";
  $("authorOther").hidden = pick !== "other";
}
const authorPick = () => (document.querySelector('input[name="author"]:checked') || {}).value || "neil";

$("bookInput").innerHTML = '<option value="">Choose a book…</option>';
BOOKS.forEach((b) => {
  const o = document.createElement("option");
  o.value = o.textContent = b;
  $("bookInput").appendChild(o);
});

function loadStudy(id, r) {
  study = { id, category: r.category, title: r.title, subtitle: r.subtitle || "", book: r.book || "",
            passage: r.passage || "", bodyHtml: r.bodyHtml, words: r.words || 0,
            sourceName: r.sourceName || "", status: r.status, date: tsToIso(r.publishAt),
            publishAt: r.publishAt || null, warnings: [],
            author: typeof r.author === "string" ? r.author : NEIL, image: r.image || "" };
  savedSnapshot = snapshot(study);
}

// Lo que importa para saber si hay cambios sin guardar
function snapshot(s) {
  return JSON.stringify([s.category, s.title, s.subtitle, s.book, s.passage, s.date, s.bodyHtml, s.author, s.image]);
}
function isDirty() {
  return !!study && document.body.dataset.view === "study" && snapshot(study) !== savedSnapshot;
}

const isBiblical = () => !!(CATEGORIES.find((c) => c.id === study.category) || {}).biblical;

// Llena el editor con el estudio abierto
function paintEditor() {
  setCategory(study.category);
  $("titleInput").value = study.title;
  $("subtitleInput").value = study.subtitle;
  $("bookInput").value = study.book;
  $("passageInput").value = study.passage;
  setAuthor(study.author);
  $("imageInput").value = study.image || "";
  checkImage();
  $("dateInput").value = study.date;
  $("laterBox").open = study.date > todayIso(); // si ya tiene fecha futura, que se vea
  $("docName").textContent = study.sourceName || "Word document";
  $("docWords").textContent = study.words ? study.words.toLocaleString("en-US") + " words" : "";
  $("docWarnings").hidden = !study.warnings.length;
  $("docWarnings").textContent = study.warnings.join(" ");
  $("replaceError").hidden = true;
  $("sectionPick").classList.remove("need");
  editorProblem("");
  syncEditor();
  refreshPreview(true);
}

// Lee los campos y los guarda en `study`
function readFields() {
  study.category = getCategory();
  study.title = $("titleInput").value.trim();
  study.subtitle = $("subtitleInput").value.trim();
  study.book = isBiblical() ? $("bookInput").value : "";
  study.passage = isBiblical() ? $("passageInput").value.trim() : "";
  study.author = getAuthor();
  study.image = $("imageInput").value.trim();
  study.date = $("dateInput").value || todayIso();
}

// Título, estado, botones, "cambios sin guardar" y cuál paso sigue
function syncEditor() {
  const isNew = !study.id;
  const published = study.status === "published";
  const dirty = isNew || isDirty();
  const st = isNew ? { key: "draft", label: "Not saved yet" } : statusOf({ status: study.status, publishAt: study.publishAt });
  const future = study.date > todayIso();

  $("editorStep").hidden = !isNew;
  $("editorTitle").textContent = study.title || "Untitled study";
  $("editorChip").className = "chip " + st.key;
  $("editorChip").textContent = st.label;
  $("saveState").textContent = isNew ? "" : dirty ? "Changes not saved" : "All changes saved";
  $("saveState").classList.toggle("dirty", dirty && !isNew);

  const c = CATEGORIES.find((x) => x.id === study.category);
  $("categoryAbout").textContent = c ? c.about : "Where it will appear on the website.";
  $("passageFields").hidden = !isBiblical();
  $("authorOther").hidden = authorPick() !== "other";

  $("publishTitle").textContent = published ? "Save your changes" : "Publish";
  $("saveDraftBtn").hidden = published;
  $("saveDraftBtn").disabled = !dirty;
  $("saveChangesBtn").hidden = !published;
  $("saveChangesBtn").disabled = !dirty;
  $("publishBtn").hidden = published;
  $("publishBtn").disabled = false;
  $("publishBtn").textContent = future ? "Schedule for " + niceDate(study.date) : "Publish now";

  // El paso que sigue se ilumina: sección → título → (otro nombre) → publicar
  const next = !study.category ? "stepSection"
    : !study.title ? "stepTitle"
    : authorPick() === "other" && !study.author ? "stepAuthor"
    : dirty ? "stepPublish" : "";
  ["stepSection", "stepTitle", "stepAuthor", "stepPublish"].forEach((id) => {
    $(id).classList.toggle("next", id === next);
  });
}

// Cada vez que Neil escribe o elige algo: actualizar y refrescar la vista previa
function onEdit(e) {
  readFields();
  if (e && e.target && e.target.name === "category") $("sectionPick").classList.remove("need");
  syncEditor();
  refreshPreview();
}
["titleInput", "subtitleInput", "bookInput", "passageInput", "dateInput", "authorOther", "imageInput"].forEach((id) => {
  $(id).addEventListener("input", onEdit);
});
$("sectionPick").addEventListener("change", onEdit);
document.querySelectorAll('input[name="author"]').forEach((r) => r.addEventListener("change", (e) => {
  onEdit(e);
  if (r.value === "other" && r.checked) $("authorOther").focus();
}));

/* Foto por enlace: revisa que el enlace sí abra una foto y enseña una miniatura.
   Solo https:// (los enlaces de Google Drive / Google Photos no sirven como foto directa). */
const NOT_A_PICTURE = /drive\.google\.com|photos\.google\.com|photos\.app\.goo\.gl|docs\.google\.com/i;
function imageProblem(url) {
  if (!url) return "";
  if (!/^https:\/\/\S+$/i.test(url)) return "The link must start with https://";
  if (NOT_A_PICTURE.test(url)) return "Links from Google Drive or Google Photos don’t work here. " +
    "Please use a picture from a web page: right-click it and choose “Copy image address”.";
  return "";
}
let imageTimer = null;
function checkImage() {
  clearTimeout(imageTimer);
  const url = $("imageInput").value.trim();
  const box = $("imageCheck"), img = $("imagePreview"), status = $("imageStatus");
  box.hidden = !url;
  if (!url) return;
  const problem = imageProblem(url);
  if (problem) {
    img.hidden = true;
    status.textContent = problem;
    status.className = "small error";
    return;
  }
  status.textContent = "Checking the picture…";
  status.className = "small muted";
  imageTimer = setTimeout(() => {
    img.onload = () => { img.hidden = false; status.textContent = "✓ The picture works."; status.className = "small ok"; };
    img.onerror = () => {
      img.hidden = true;
      status.textContent = "This link doesn’t open a picture. On the picture, right-click and choose “Copy image address”.";
      status.className = "small error";
    };
    img.src = url;
  }, 400);
}
$("imageInput").addEventListener("input", checkImage);
$("imageRemove").addEventListener("click", () => {
  $("imageInput").value = "";
  checkImage();
  onEdit();
});

/* Vista previa en vivo: la página real del lector (reading.html?preview=1)
   dentro de un "celular". Cuando carga, nos avisa y le mandamos la lectura
   tal como está en el editor, sin guardar nada en Firestore. */
let previewTimer = null;
function refreshPreview(now) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const f = $("previewFrame");
    if (f.getAttribute("src")) f.contentWindow.location.reload();
    else f.src = "../reading.html?preview=1";
  }, now ? 0 : 700);
}
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data || e.data.type !== "bt-preview-ready" || !study) return;
  $("previewFrame").contentWindow.postMessage({
    type: "bt-preview",
    reading: {
      id: study.id || "new",
      category: study.category || "good-news",
      title: study.title || "Untitled study",
      subtitle: study.subtitle,
      author: study.author,
      publishedAt: study.date,
      pdfUrl: null,
      bodyHtml: study.bodyHtml,
      image: study.image || ""
    }
  }, location.origin);
});

document.querySelectorAll(".seg-btn").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".seg-btn").forEach((x) => {
    x.classList.toggle("on", x === b);
    x.setAttribute("aria-pressed", String(x === b));
  });
  $("previewBox").className = "preview-box " + b.dataset.size;
}));

// "Use a corrected Word file": cambia el texto, conserva los datos.
// Se puede pedir desde el editor o desde el ⋮ de la lista (pendingReplace = qué estudio).
let pendingReplace = null;
$("replaceBtn").addEventListener("click", () => { pendingReplace = null; $("replaceInput").click(); });
$("replaceInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const { result, error } = await readWord(file);

  // Desde la lista: primero abrir ese estudio
  if (pendingReplace) {
    const id = pendingReplace;
    pendingReplace = null;
    location.hash = "#study/" + encodeURIComponent(id);
    // Esperar a que el editor tenga ese estudio abierto (máximo 10 segundos)
    for (let i = 0; i < 100 && !(study && study.id === id && document.body.dataset.view === "study"); i++) {
      await new Promise((ok) => setTimeout(ok, 100));
    }
    if (!study || study.id !== id) return;
  }
  $("replaceError").hidden = true;
  if (error) {
    $("replaceError").innerHTML = error;
    $("replaceError").hidden = false;
    return;
  }
  study.bodyHtml = result.bodyHtml;
  study.words = result.words;
  study.warnings = result.warnings;
  study.sourceName = file.name;
  paintEditor();
  toast("New text loaded. Check the preview, then save.");
});

/* ---------- 7. Guardar y publicar ---------- */

function editorProblem(msg) {
  $("editorError").textContent = msg;
  $("editorError").hidden = !msg;
}

function checkFields() {
  readFields();
  if (!study.category) {
    $("sectionPick").classList.add("need");
    $("stepSection").scrollIntoView({ behavior: "smooth", block: "center" });
    editorProblem("Please choose a section for this study (step 1).");
    return false;
  }
  if (!study.title) {
    $("titleInput").focus();
    editorProblem("Please write a title.");
    return false;
  }
  if (imageProblem(study.image)) {
    $("imageInput").focus();
    editorProblem("Please check the picture link: " + imageProblem(study.image));
    return false;
  }
  if (authorPick() === "other" && !study.author) {
    $("authorOther").focus();
    editorProblem("Please write the name that goes on the study, or choose another option.");
    return false;
  }
  editorProblem("");
  return true;
}

// Guarda en Firestore. mode: "draft" | "publish" | "changes" (uno que ya está publicado)
async function save(mode) {
  if (!checkFields()) return false;
  const data = {
    category: study.category, title: study.title, subtitle: study.subtitle,
    book: study.book, passage: study.passage, bodyHtml: study.bodyHtml, words: study.words,
    image: study.image || "",
    sourceName: study.sourceName, author: study.author,
    updatedAt: serverTimestamp(), updatedBy: user.uid
  };
  if (mode === "publish") {
    data.status = "published";
    data.publishAt = publishMoment(study.date);
  } else if (mode === "draft") {
    data.status = "draft";
    data.publishAt = Timestamp.fromDate(new Date(study.date + "T06:00:00"));
  } else {
    // Ya publicado: la fecha solo cambia si Neil la cambió
    data.status = "published";
    const oldDate = savedSnapshot ? JSON.parse(savedSnapshot)[5] : "";
    if (study.date !== oldDate) data.publishAt = publishMoment(study.date);
  }

  if (study.id) {
    await keepOldVersion(study.id, data);
    await updateDoc(doc(db, "readings", study.id), data);
  } else {
    const ref = doc(collection(db, "readings"));
    data.createdAt = serverTimestamp();
    data.createdBy = user.uid;
    await setDoc(ref, data);
    study.id = ref.id;
    // La dirección pasa de #new a #study/<id> sin volver a cargar
    history.replaceState(null, "", "#study/" + encodeURIComponent(study.id));
    currentHash = location.hash;
  }
  study.status = data.status;
  if (data.publishAt) {
    // serverTimestamp() todavía no tiene valor aquí: para pintar, "ahora" basta
    study.publishAt = data.publishAt instanceof Timestamp ? data.publishAt : Timestamp.now();
  }
  savedSnapshot = snapshot(study);
  refreshStudies();
  return true;
}

async function withBusy(btn, fn) {
  btn.disabled = true;
  try {
    await fn();
  } catch (e) {
    console.error(e);
    editorProblem("It couldn’t be saved. Please check the internet connection and try again.");
  } finally {
    syncEditor();
  }
}

function liveLink() {
  return statusOf({ status: study.status, publishAt: study.publishAt }).key === "published"
    ? { href: "../reading.html?id=" + encodeURIComponent(study.id), text: "View it" } : null;
}

$("saveDraftBtn").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
  if (await save("draft")) toast("Saved as a draft. It is not on the website.");
}));

$("saveChangesBtn").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
  if (await save("changes")) toast("Changes saved.", liveLink());
}));

$("publishBtn").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
  const future = study.date > todayIso();
  if (!(await save("publish"))) return;
  if (future) toast("All set! It will appear on the website on " + niceDate(study.date, true) + ".");
  else toast("Published! “" + study.title + "” is on the website.", liveLink());
}));

// ⋮ del editor
$("editorMoreBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const acts = [];
  const st = study.id ? statusOf({ status: study.status, publishAt: study.publishAt }).key : "new";
  if (st === "published") {
    acts.push({ label: "View on the website", run: () => window.open(liveLink().href, "_blank") });
  }
  if (study.status === "published") {
    acts.push({ label: st === "scheduled" ? "Cancel the date (back to draft)" : "Take it off the website", run: unpublish });
  }
  if (study.id) {
    if (acts.length) acts.push("-");
    acts.push({ label: "Move to the bin", danger: true, run: async () => {
      if (await moveToBin(study.id, study)) { savedSnapshot = snapshot(study); location.hash = "#studies"; }
    } });
  } else {
    acts.push({ label: "Discard this study", danger: true, run: () => {
      if (!confirm("Discard this study? Nothing has been saved yet.")) return;
      savedSnapshot = snapshot(study);
      location.hash = "#studies";
    } });
  }
  openPop(e.currentTarget, acts);
});

async function unpublish() {
  if (!confirm("Take “" + study.title + "” off the website? It will stay in My studies as a draft.")) return;
  try {
    await updateDoc(doc(db, "readings", study.id), {
      status: "draft", updatedAt: serverTimestamp(), updatedBy: user.uid
    });
    study.status = "draft";
    syncEditor();
    refreshStudies();
    toast("It is off the website. It stays here as a draft.");
  } catch (e) {
    console.error(e);
    editorProblem("It couldn’t be changed. Please try again.");
  }
}

// Historial: antes de cambiar el texto o el título, guarda una copia de cómo estaba
// (readings/{id}/versions). Así un error nunca borra el trabajo de Neil.
async function keepOldVersion(id, next) {
  const snap = await getDoc(doc(db, "readings", id));
  if (!snap.exists()) return;
  const old = snap.data();
  if (old.bodyHtml === next.bodyHtml && old.title === next.title && old.subtitle === next.subtitle) return;
  await addDoc(collection(db, "readings", id, "versions"), {
    title: old.title || "", subtitle: old.subtitle || "", bodyHtml: old.bodyHtml || "",
    category: old.category || "", sourceName: old.sourceName || "", status: old.status || "",
    savedAt: serverTimestamp(), savedBy: user.uid
  });
}

/* ---------- 8. Messages: lo que la gente manda desde Contact ----------
   Vienen de la colección `messages` ({ name, email, type, message, status, createdAt }).
   status: "new" (sin leer) → "read" (al abrirlo) → "archived" (si Neil lo archiva).
   Responder = abre el correo de Neil con la dirección de esa persona ya puesta. */

const MSG_TYPES = { question: "Question", suggestion: "Suggestion", observation: "Observation",
  request: "Request", thanks: "Thank you" };
let messages = [];       // [{ id, data }]
let msgTab = "inbox";    // "inbox" (nuevos y leídos) o "archived"
let openMsgId = null;    // el que está abierto

function paintMsgBadge() {
  const unread = messages.filter((m) => m.data.status === "new").length;
  $("navMsgCount").textContent = unread;
  $("navMsgCount").hidden = !unread;
}

async function refreshMessages() {
  try {
    const snap = await getDocs(query(collection(db, "messages"), orderBy("createdAt", "desc"), limit(300)));
    messages = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  } catch (e) {
    console.error("messages:", e); // casi siempre: faltan las reglas nuevas en Firestore
  }
  paintMsgBadge();
}

function msgWhen(ts) {
  const d = ts && ts.toDate ? ts.toDate() : new Date();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

async function setMsgStatus(m, status) {
  try {
    await updateDoc(doc(db, "messages", m.id), { status });
    m.data.status = status;
  } catch (e) {
    console.error(e);
    toast("It couldn’t be changed. Please try again.");
  }
  paintMsgBadge();
  paintMessages();
}

function paintMessages() {
  document.querySelectorAll("[data-msgtab]").forEach((t) => t.classList.toggle("on", t.dataset.msgtab === msgTab));
  const inbox = messages.filter((m) => m.data.status !== "archived");
  const archived = messages.filter((m) => m.data.status === "archived");
  $("msgCountInbox").textContent = inbox.length ? "(" + inbox.length + ")" : "";
  $("msgCountArchived").textContent = archived.length ? "(" + archived.length + ")" : "";

  const items = msgTab === "archived" ? archived : inbox;
  const list = $("msgList");
  list.innerHTML = "";
  items.forEach((m) => {
    const r = m.data;
    const open = m.id === openMsgId;
    const box = document.createElement("article");
    box.className = "msg" + (r.status === "new" ? " unread" : "") + (open ? " open" : "");

    // Renglón: • Nombre · [Tipo] · primeras palabras · fecha
    const head = document.createElement("button");
    head.className = "msg-head";
    head.setAttribute("aria-expanded", String(open));
    head.innerHTML = '<span class="msg-dot" aria-hidden="true"></span><strong class="msg-name"></strong>' +
      '<span class="msg-type"></span><span class="msg-preview"></span><span class="msg-date"></span>';
    head.querySelector(".msg-name").textContent = r.name || "(no name)";
    head.querySelector(".msg-type").textContent = MSG_TYPES[r.type] || "Message";
    head.querySelector(".msg-preview").textContent = (r.message || "").slice(0, 120);
    head.querySelector(".msg-date").textContent = msgWhen(r.createdAt);
    head.addEventListener("click", () => {
      openMsgId = open ? null : m.id;
      if (!open && r.status === "new") setMsgStatus(m, "read"); // al abrirlo, queda leído
      else paintMessages();
    });
    box.appendChild(head);

    // Abierto: el mensaje completo + botones
    if (open) {
      const body = document.createElement("div");
      body.className = "msg-body";
      body.innerHTML = '<p class="msg-from"></p><p class="msg-text"></p><div class="msg-actions"></div>';
      body.querySelector(".msg-from").textContent = (r.name || "") + " · " + (r.email || "");
      body.querySelector(".msg-text").textContent = r.message || "";
      const acts = body.querySelector(".msg-actions");

      const reply = document.createElement("a");
      reply.className = "btn primary small";
      reply.textContent = "Reply by email";
      reply.href = "mailto:" + encodeURIComponent(r.email || "") +
        "?subject=" + encodeURIComponent("Re: your message on Bible Talks");
      acts.appendChild(reply);

      const btn = (label, fn) => {
        const b = document.createElement("button");
        b.className = "btn small";
        b.textContent = label;
        b.addEventListener("click", fn);
        acts.appendChild(b);
      };
      if (r.status === "archived") {
        btn("Move back to the inbox", () => { openMsgId = null; setMsgStatus(m, "read"); });
      } else {
        btn("Mark as unread", () => { openMsgId = null; setMsgStatus(m, "new"); });
        btn("Archive", () => { openMsgId = null; setMsgStatus(m, "archived"); toast("Archived. It is in the Archived tab."); });
      }
      box.appendChild(body);
    }
    list.appendChild(box);
  });

  $("msgEmpty").hidden = items.length > 0;
  $("msgEmpty").textContent = msgTab === "archived" ? "Nothing archived."
    : "No messages yet. When someone writes from the Contact page of the website, it appears here.";
}

/* ---------- 9. Site pages: la cinta de la portada ----------
   Enseña qué se ve hoy y qué sigue (con las MISMAS reglas que la portada:
   assets/ribbon.js) y deja cambiar 3 cosas, guardadas en Firestore site/home:
     verses   → lista propia de versículos (null = la estándar de verses.js)
     pinnedId → un estudio fijo, primero en la cinta (null = ninguno)
     season   → aviso de temporada { on, kicker, title, text, link } */

let siteConfig = {};     // lo que hay en site/home
let verseDraft = [];     // la lista mientras Neil la edita

const fmtDay = (d) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
const publishedNewestFirst = () => allStudies.filter((x) => x.st.key === "published")
  .sort((p, q) => millis(q.data.publishAt) - millis(p.data.publishAt));

async function loadSiteConfig() {
  try {
    const snap = await getDoc(doc(db, "site", "home"));
    siteConfig = snap.exists() ? snap.data() : {};
  } catch (e) {
    console.error("site/home:", e);
    siteConfig = {};
  }
}

async function saveSiteConfig(changes, okText) {
  try {
    await setDoc(doc(db, "site", "home"), Object.assign({}, changes, { updatedAt: serverTimestamp() }), { merge: true });
    Object.assign(siteConfig, changes);
    toast(okText);
    paintSite();
    return true;
  } catch (e) {
    console.error(e);
    toast("It couldn’t be saved. Please try again.");
    return false;
  }
}

function li(parent, label, title, note) {
  const item = document.createElement("li");
  const b = document.createElement("span");
  b.className = "slide-label";
  b.textContent = label;
  const t = document.createElement("strong");
  t.textContent = title;
  item.append(b, t);
  if (note) {
    const n = document.createElement("span");
    n.className = "muted small";
    n.textContent = note;
    item.append(n);
  }
  parent.appendChild(item);
}

function paintSite() {
  const studies = publishedNewestFirst();
  const changes = upcomingChanges(studies, siteConfig, 5);
  const nextChange = changes[1] ? "until " + fmtDay(new Date(changes[1].date.getTime() - 864e5)) : "";
  const verses = upcomingVerses(siteConfig, 5);
  const verseUntil = "until Sunday, " + new Date(verses[1].monday.getTime() - 864e5)
    .toLocaleDateString("en-US", { month: "long", day: "numeric" });

  // Hoy, en el orden de la cinta
  const now = $("siteNow");
  now.innerHTML = "";
  planSlides(studies, siteConfig).forEach((s) => {
    if (s.role === "pinned") li(now, "Kept on the banner", s.item.data.title, "Always, until you take it off");
    else if (s.role === "verse") li(now, "Verse of the week", s.ref, verseUntil);
    else if (s.role === "new") li(now, "New", s.item.data.title, nextChange);
    else if (s.role === "library") li(now, "From the library", s.item.data.title, nextChange);
    else if (s.role === "season") li(now, "Seasonal message", s.title, "While it is turned on");
  });

  // Lo que sigue
  const next = $("siteNext");
  next.innerHTML = "";
  changes.slice(1).forEach((c) => {
    const parts = [];
    if (c.fresh) parts.push("New: " + c.fresh.data.title);
    if (c.library.length) parts.push("From the library: " + c.library.map((x) => x.data.title).join(", "));
    li(next, fmtDay(c.date), parts.join(" · "));
  });
  if (!changes.slice(1).length) li(next, "", "Nothing changes for now.");

  // Versículos
  const custom = Array.isArray(siteConfig.verses) && siteConfig.verses.length;
  $("verseSource").textContent = custom
    ? "Your own list (" + siteConfig.verses.length + " verses). It changes every Monday."
    : "The standard list (" + VERSES.length + " verses, King James Version). It changes every Monday.";
  const vl = $("siteVerses");
  vl.innerHTML = "";
  verses.forEach((v, i) => li(vl, i === 0 ? "This week" : "From " + fmtDay(v.monday), v.verse.ref, v.verse.text));
  $("resetVersesBtn").hidden = !custom;

  // Estudio fijo
  const sel = $("pinSelect");
  sel.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "None (the banner chooses by itself)";
  sel.appendChild(none);
  studies.forEach((x) => {
    const o = document.createElement("option");
    o.value = x.id;
    o.textContent = x.data.title + " · " + catName(x.data.category);
    sel.appendChild(o);
  });
  sel.value = studies.some((x) => x.id === siteConfig.pinnedId) ? siteConfig.pinnedId : "";

  // Aviso de temporada
  const s = siteConfig.season || {};
  $("seasonOn").checked = !!s.on;
  $("seasonKicker").value = s.kicker || "";
  $("seasonTitle").value = s.title || "";
  $("seasonText").value = s.text || "";
  $("seasonLink").value = s.link || "";
}

/* Editor de versículos */
function paintVerseRows() {
  const box = $("verseRows");
  box.innerHTML = "";
  const thisWeek = upcomingVerses({ verses: verseDraft }, 1)[0].verse;
  verseDraft.forEach((v, i) => {
    const row = document.createElement("div");
    row.className = "verse-row" + (v === thisWeek ? " this-week" : "");
    row.innerHTML = '<span class="verse-num"></span><div class="verse-fields">' +
      '<input type="text" class="verse-ref" placeholder="Reference, e.g. John 3:16" maxlength="60">' +
      '<textarea class="verse-text" rows="2" placeholder="The verse" maxlength="600"></textarea></div>' +
      '<button class="icon-btn" aria-label="Remove this verse" title="Remove">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
    row.querySelector(".verse-num").textContent = v === thisWeek ? (i + 1) + " · this week" : String(i + 1);
    const ref = row.querySelector(".verse-ref"), text = row.querySelector(".verse-text");
    ref.value = v.ref || "";
    text.value = v.text || "";
    ref.addEventListener("input", () => { v.ref = ref.value; });
    text.addEventListener("input", () => { v.text = text.value; });
    row.querySelector("button").addEventListener("click", () => { verseDraft.splice(i, 1); paintVerseRows(); });
    box.appendChild(row);
  });
}

$("editVersesBtn").addEventListener("click", () => {
  verseDraft = verseList(siteConfig).map((v) => ({ ref: v.ref, text: v.text }));
  paintVerseRows();
  $("verseEditor").hidden = false;
  $("editVersesBtn").hidden = true;
});
$("addVerseBtn").addEventListener("click", () => {
  verseDraft.push({ ref: "", text: "" });
  paintVerseRows();
  const refs = document.querySelectorAll(".verse-ref");
  refs[refs.length - 1].focus();
});
function closeVerseEditor() {
  $("verseEditor").hidden = true;
  $("editVersesBtn").hidden = false;
}
$("cancelVersesBtn").addEventListener("click", closeVerseEditor);
$("saveVersesBtn").addEventListener("click", async () => {
  const list = verseDraft.map((v) => ({ ref: (v.ref || "").trim(), text: (v.text || "").trim() }))
    .filter((v) => v.ref || v.text);
  if (!list.length || list.some((v) => !v.ref || !v.text)) {
    toast("Each verse needs its reference and its text.");
    return;
  }
  if (await saveSiteConfig({ verses: list }, "Verses saved.")) closeVerseEditor();
});
$("resetVersesBtn").addEventListener("click", async () => {
  if (!confirm("Go back to the standard list of " + VERSES.length + " verses? Your own list will be removed.")) return;
  if (await saveSiteConfig({ verses: null }, "Back to the standard list.")) closeVerseEditor();
});

$("savePinBtn").addEventListener("click", () => {
  const id = $("pinSelect").value || null;
  saveSiteConfig({ pinnedId: id }, id ? "That study will stay on the banner." : "No study is kept on the banner now.");
});

$("saveSeasonBtn").addEventListener("click", () => {
  const season = {
    on: $("seasonOn").checked,
    kicker: $("seasonKicker").value.trim(),
    title: $("seasonTitle").value.trim(),
    text: $("seasonText").value.trim(),
    link: $("seasonLink").value.trim()
  };
  if (season.on && !season.title) { toast("Please write a title for the seasonal message."); return; }
  if (season.link && !safeLink(season.link)) {
    toast("The link must start with https:// (or be a page of this website).");
    return;
  }
  saveSiteConfig({ season }, season.on ? "The seasonal message is on the banner." : "Seasonal message saved (turned off).");
});
