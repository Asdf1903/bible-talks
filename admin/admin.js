/* =========================================================
   admin.js: la lógica del panel de Neil
   Qué hace, en orden:
     1. Datos fijos (secciones, libros) y fechas
     2. Entrar con Google y revisar que la cuenta tenga permiso (colección `admins`)
     3. Navegación: barra lateral + direcciones (#home, #studies, #study/abc…)
     4. Home, My studies y Bin (listas tipo Drive, menú ⋮)
     5. Nuevo estudio, paso 1: subir el Word (ventana o arrastrando)
     6. Editor, paso 2: datos a la izquierda + vista previa en vivo a la derecha
     7. Guardar, publicar, quitar del sitio, papelera, historial, nota
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
let studiesTab = "all";

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
  $("userName").textContent = u.displayName || u.email || "";

  $("gate").hidden = true;
  $("app").hidden = false;
  await refreshStudies();
  route();
});

/* ---------- 3. Navegación ---------- */
// La dirección dice qué cuarto se ve:
//   #home · #studies · #studies/published · #studies/scheduled · #studies/draft
//   #bin · #study/<id> (un estudio) · #new (el que se acaba de subir, aún sin guardar)

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
  window.scrollTo(0, 0);
}

async function route() {
  const h = location.hash.slice(1) || "home";
  const [room, arg] = h.split("/");

  if (room === "studies") {
    studiesTab = ["published", "scheduled", "draft"].includes(arg) ? arg : "all";
    showView("studies");
    paintStudies();
  } else if (room === "bin") {
    showView("bin");
    paintBin();
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

const KEBAB = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/>' +
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
  row.querySelector(".c-section").textContent = catName(r.category);
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

function paintStudies() {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === studiesTab));
  const live = allStudies.filter((x) => x.st.key !== "trashed");
  const n = (k) => (k ? "(" + k + ")" : "");
  $("tabCountAll").textContent = n(live.length);
  $("tabCountPublished").textContent = n(count("published"));
  $("tabCountScheduled").textContent = n(count("scheduled"));
  $("tabCountDraft").textContent = n(count("draft"));

  const words = $("searchInput").value.trim().toLowerCase();
  const section = $("sectionFilter").value;
  const items = live.filter((x) =>
    (studiesTab === "all" || x.st.key === studiesTab) &&
    (!section || x.data.category === section) &&
    (!words || ((x.data.title || "") + " " + (x.data.subtitle || "")).toLowerCase().includes(words)));

  // Orden: lo próximo primero en "Coming up"; en lo demás, lo más reciente primero
  if (studiesTab === "scheduled") items.sort((p, q) => millis(p.data.publishAt) - millis(q.data.publishAt));
  else if (studiesTab === "published") items.sort((p, q) => millis(q.data.publishAt) - millis(p.data.publishAt));

  const list = $("studiesList");
  list.innerHTML = "";
  if (items.length) list.appendChild(headRow());
  items.forEach((x) => list.appendChild(fileRow(x)));

  const empty = $("studiesEmpty");
  empty.hidden = items.length > 0;
  empty.textContent = (words || section) ? "No studies match your search."
    : studiesTab === "scheduled" ? "Nothing is scheduled. Pick a later date when you publish, and it will wait here."
    : studiesTab === "draft" ? "No drafts."
    : "No studies yet. Click “New study” or drag a Word document here.";
}

CATEGORIES.forEach((c) => {
  const o = document.createElement("option");
  o.value = c.id;
  o.textContent = c.name;
  $("sectionFilter").appendChild(o);
});
$("searchInput").addEventListener("input", paintStudies);
$("sectionFilter").addEventListener("change", paintStudies);

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
    row.querySelector(".c-section").textContent = catName(x.data.category);
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
           publishAt: null, warnings: [] };
}

function startNew() {
  if (isDirty() && !confirm("You have changes that are not saved. Start a new study anyway?")) return;
  $("fileInput").value = "";
  $("fileError").hidden = true;
  $("fileWorking").hidden = true;
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

$("fileInput").addEventListener("change", (e) => handleNewFile(e.target.files[0]));

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

$("categoryInput").innerHTML = '<option value="">Choose a section…</option>';
CATEGORIES.forEach((c) => {
  const o = document.createElement("option");
  o.value = c.id;
  o.textContent = c.name;
  $("categoryInput").appendChild(o);
});
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
            publishAt: r.publishAt || null, warnings: [] };
  savedSnapshot = snapshot(study);
}

// Lo que importa para saber si hay cambios sin guardar
function snapshot(s) {
  return JSON.stringify([s.category, s.title, s.subtitle, s.book, s.passage, s.date, s.bodyHtml]);
}
function isDirty() {
  return !!study && document.body.dataset.view === "study" && snapshot(study) !== savedSnapshot;
}

const isBiblical = () => !!(CATEGORIES.find((c) => c.id === study.category) || {}).biblical;

// Llena el editor con el estudio abierto
function paintEditor() {
  $("categoryInput").value = study.category;
  $("titleInput").value = study.title;
  $("subtitleInput").value = study.subtitle;
  $("bookInput").value = study.book;
  $("passageInput").value = study.passage;
  $("dateInput").value = study.date;
  $("docName").textContent = study.sourceName || "Word document";
  $("docWords").textContent = study.words ? study.words.toLocaleString("en-US") + " words" : "";
  $("docWarnings").hidden = !study.warnings.length;
  $("docWarnings").textContent = study.warnings.join(" ");
  $("replaceError").hidden = true;
  $("categoryInput").classList.remove("need");
  editorProblem("");
  loadNote();
  syncEditor();
  refreshPreview(true);
}

// Lee los campos y los guarda en `study`
function readFields() {
  study.category = $("categoryInput").value;
  study.title = $("titleInput").value.trim();
  study.subtitle = $("subtitleInput").value.trim();
  study.book = isBiblical() ? $("bookInput").value : "";
  study.passage = isBiblical() ? $("passageInput").value.trim() : "";
  study.date = $("dateInput").value || todayIso();
}

// Título, estado, botones y "cambios sin guardar"
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

  $("saveDraftBtn").hidden = published;
  $("saveDraftBtn").disabled = !dirty;
  $("saveChangesBtn").hidden = !published;
  $("saveChangesBtn").disabled = !dirty;
  $("publishBtn").hidden = published;
  $("publishBtn").disabled = false;
  $("publishBtn").textContent = future ? "Schedule for " + niceDate(study.date) : "Publish now";
}

// Cada vez que Neil escribe: actualizar y refrescar la vista previa
["categoryInput", "titleInput", "subtitleInput", "bookInput", "passageInput", "dateInput"].forEach((id) => {
  $(id).addEventListener("input", () => {
    readFields();
    if (id === "categoryInput") $("categoryInput").classList.remove("need");
    syncEditor();
    refreshPreview();
  });
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
      author: "Neil Whatmough",
      publishedAt: study.date,
      pdfUrl: null,
      bodyHtml: study.bodyHtml
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
    $("categoryInput").classList.add("need");
    $("categoryInput").focus();
    editorProblem("Please choose a section for this study.");
    return false;
  }
  if (!study.title) {
    $("titleInput").focus();
    editorProblem("Please write a title.");
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
    sourceName: study.sourceName, author: "Neil Whatmough",
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
    loadNote();
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

/* ---------- Nota privada ---------- */
// Va en la colección `notes` (no dentro del estudio), porque las reglas de Firestore
// no pueden esconder un solo campo: si estuviera en el estudio publicado, sería pública.

let noteTimer = null;
let noteFor = null; // de qué estudio es la nota que se está escribiendo

async function loadNote() {
  if (noteTimer) await saveNote(); // no perder lo que se estaba escribiendo
  noteFor = study.id;
  $("noteInput").value = "";
  $("noteStatus").textContent = "";
  $("noteInput").hidden = !study.id;
  $("noteLater").hidden = !!study.id;
  if (!study.id) return;
  try {
    const snap = await getDoc(doc(db, "notes", study.id));
    if (snap.exists() && noteFor === study.id) $("noteInput").value = snap.data().text || "";
  } catch (e) { console.error(e); }
}

async function saveNote() {
  clearTimeout(noteTimer);
  noteTimer = null;
  if (!noteFor) return;
  try {
    await setDoc(doc(db, "notes", noteFor), {
      text: $("noteInput").value, updatedAt: serverTimestamp(), updatedBy: user.uid
    });
    $("noteStatus").textContent = "Saved ✓";
  } catch (e) {
    console.error(e);
    $("noteStatus").textContent = "The note couldn’t be saved. Please try again.";
  }
}

$("noteInput").addEventListener("input", () => {
  $("noteStatus").textContent = "Saving…";
  clearTimeout(noteTimer);
  noteTimer = setTimeout(saveNote, 1000);
});
$("noteInput").addEventListener("blur", () => { if (noteTimer) saveNote(); });
