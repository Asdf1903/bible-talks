/* =========================================================
   admin.js: la lógica del panel de Neil
   Qué hace, en orden:
     1. Pantallas: mostrar una a la vez
     2. Entrar con Google y revisar que la cuenta tenga permiso (colección `admins`)
     3. Inicio: saludo + lista de "My studies"
     4. Asistente: tipo → Word → datos → vista previa → Publish
   Los datos se guardan en Firestore, colección `readings`.
   ========================================================= */
import { auth, db, ENV } from "../assets/firebase.js";
import {
  GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, collection, query, orderBy, limit, getDocs,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

/* ---------- Datos fijos ---------- */

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

/* ---------- Lo que el asistente va armando ---------- */
// id: null mientras es nuevo; cuando se guarda el borrador, el id de Firestore.
let study = null;
let user = null;

function newStudy() {
  study = { id: null, category: null, title: "", subtitle: "", book: "", passage: "",
            bodyHtml: "", words: 0, sourceName: "", status: "draft", date: todayIso(), warnings: [] };
}

/* ---------- Fechas ---------- */

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function tsToIso(ts) {
  const d = ts && ts.toDate ? ts.toDate() : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function niceDate(iso) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US",
    { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

// Fecha elegida → cuándo sale de verdad:
// hoy = ahora mismo (hora del servidor); otro día = ese día a las 6 de la mañana
function publishMoment(iso) {
  if (iso === todayIso()) return serverTimestamp();
  return Timestamp.fromDate(new Date(iso + "T06:00:00"));
}

/* ---------- 1. Pantallas ---------- */

function show(name) {
  document.querySelectorAll(".screen").forEach((s) => { s.hidden = s.id !== "screen-" + name; });
  window.scrollTo(0, 0);
  if (name === "home") loadStudies();
}

document.querySelectorAll("[data-go]").forEach((b) =>
  b.addEventListener("click", () => show(b.dataset.go)));

if (ENV === "test") $("envBadge").hidden = false;

/* ---------- 2. Entrar ---------- */

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

$("signOutBtn").addEventListener("click", () => signOut(auth));

$("copyUidBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("uidBox").textContent);
    $("copyUidBtn").textContent = "Copied ✓";
  } catch (e) { /* si no se puede copiar, el número se puede seleccionar a mano */ }
});

onAuthStateChanged(auth, async (u) => {
  user = u;
  $("signOutBtn").hidden = !u;
  if (!u) { show("signin"); return; }

  let allowed = false;
  try {
    allowed = (await getDoc(doc(db, "admins", u.uid))).exists();
  } catch (e) {
    console.error(e);
  }
  if (!allowed) {
    $("noAccessEmail").textContent = u.email || "";
    $("uidBox").textContent = u.uid;
    show("noaccess");
    return;
  }

  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = (u.displayName || "").split(" ")[0];
  $("greeting").textContent = part + (first ? ", " + first : "") + " ☀️";
  show("home");
});

/* ---------- 3. Inicio: My studies ---------- */

function statusOf(r) {
  if (r.status === "published") {
    const when = r.publishAt && r.publishAt.toDate ? r.publishAt.toDate() : new Date();
    return when > new Date() ? { key: "scheduled", label: "Scheduled" } : { key: "published", label: "Published" };
  }
  if (r.status === "trashed") return { key: "trashed", label: "In the bin" };
  return { key: "draft", label: "Draft" };
}

async function loadStudies() {
  const list = $("studyList");
  list.innerHTML = "";
  let snap;
  try {
    snap = await getDocs(query(collection(db, "readings"), orderBy("updatedAt", "desc"), limit(30)));
  } catch (e) {
    console.error(e);
    return;
  }
  const rows = snap.docs.filter((d) => d.data().status !== "trashed");
  $("studyListEmpty").hidden = rows.length > 0;
  rows.forEach((d) => {
    const r = d.data();
    const st = statusOf(r);
    const cat = CATEGORIES.find((c) => c.id === r.category);
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.innerHTML = "<strong></strong><span class=\"meta\"><span class=\"status\"></span><span class=\"info\"></span></span>";
    btn.querySelector("strong").textContent = r.title;
    btn.querySelector(".status").textContent = st.label;
    btn.querySelector(".status").classList.add(st.key);
    btn.querySelector(".info").textContent = (cat ? cat.name : "") + " · " + niceDate(tsToIso(r.publishAt));
    btn.addEventListener("click", () => openStudy(d.id, r));
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function openStudy(id, r) {
  study = { id, category: r.category, title: r.title, subtitle: r.subtitle || "", book: r.book || "",
            passage: r.passage || "", bodyHtml: r.bodyHtml, words: r.words || 0,
            sourceName: r.sourceName || "", status: r.status, date: tsToIso(r.publishAt), warnings: [] };
  showPreview();
}

/* ---------- 4. Asistente ---------- */

// Paso 1: tipo de estudio
CATEGORIES.forEach((c) => {
  const b = document.createElement("button");
  b.className = "choice";
  b.innerHTML = "<strong></strong><span></span>";
  b.querySelector("strong").textContent = c.name;
  b.querySelector("span").textContent = c.about;
  b.addEventListener("click", () => {
    study.category = c.id;
    // Si ya había un Word (vino de "Back"), no lo pedimos otra vez
    if (study.bodyHtml) showDetails(); else show("file");
  });
  $("categoryChoices").appendChild(b);
});

$("newStudyBtn").addEventListener("click", () => {
  newStudy();
  $("fileInput").value = "";
  $("fileError").hidden = true;
  show("category");
});

// Paso 2: el Word
function fileProblem(msg) {
  $("fileWorking").hidden = true;
  $("fileError").innerHTML = msg;
  $("fileError").hidden = false;
  $("fileInput").value = "";
}

async function handleFile(file) {
  if (!file) return;
  $("fileError").hidden = true;
  const name = file.name.toLowerCase();

  if (name.endsWith(".doc")) {
    return fileProblem("This is an older Word file (.doc).<br>Please open it in Word, choose " +
      "<strong>File → Save As</strong>, pick <strong>Word Document (.docx)</strong>, and try again with the new file.");
  }
  if (name.endsWith(".rtf")) {
    return fileProblem("This file is saved as Rich Text (.rtf).<br>Please open it in Word, choose " +
      "<strong>File → Save As</strong>, pick <strong>Word Document (.docx)</strong>, and try again with the new file.");
  }
  if (name.endsWith(".pdf")) {
    return fileProblem("This is a PDF. Please choose the <strong>Word</strong> version of this study " +
      "(it keeps your bold, italics and underlines).");
  }
  if (!name.endsWith(".docx")) {
    return fileProblem("Please choose a Word document (its name ends in .docx).");
  }

  $("fileWorking").hidden = false;
  try {
    const result = await window.WordToReading.convert(await file.arrayBuffer());
    study.title = result.title;
    study.subtitle = result.subtitle;
    study.bodyHtml = result.bodyHtml;
    study.words = result.words;
    study.warnings = result.warnings;
    study.sourceName = file.name;
    $("fileWorking").hidden = true;
    showDetails();
  } catch (e) {
    console.error(e);
    if (e.message === "EMPTY") return fileProblem("This document looks empty. Is it the right file?");
    if (e.message === "TOO_BIG") return fileProblem("This document is too big for the website. Please send it to Israel.");
    fileProblem("Sorry, this document couldn’t be read. Please send it to Israel.");
  }
}

$("fileInput").addEventListener("change", (e) => handleFile(e.target.files[0]));

const drop = $("dropZone");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault(); drop.classList.add("over");
}));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault(); drop.classList.remove("over");
}));
drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

// Paso 3: datos
BOOKS.forEach((b) => {
  const o = document.createElement("option");
  o.value = o.textContent = b;
  $("bookInput").appendChild(o);
});
$("bookInput").insertAdjacentHTML("afterbegin", '<option value="">Choose a book…</option>');

function isBiblical() {
  const c = CATEGORIES.find((x) => x.id === study.category);
  return !!(c && c.biblical);
}

function showDetails() {
  $("titleInput").value = study.title;
  $("subtitleInput").value = study.subtitle;
  $("bookInput").value = study.book;
  $("passageInput").value = study.passage;
  $("dateInput").value = study.date;
  $("passageFields").hidden = !isBiblical();
  $("detailsError").hidden = true;
  $("detailsWarnings").hidden = !study.warnings.length;
  $("detailsWarnings").textContent = study.warnings.join(" ");
  show("details");
}

// "Back": si es nuevo, regresa al tipo de estudio; si ya existía, a la vista previa
$("detailsBackBtn").addEventListener("click", () => {
  if (study.id) showPreview(); else show("category");
});

$("toPreviewBtn").addEventListener("click", async () => {
  study.title = $("titleInput").value.trim();
  study.subtitle = $("subtitleInput").value.trim();
  study.book = isBiblical() ? $("bookInput").value : "";
  study.passage = isBiblical() ? $("passageInput").value.trim() : "";
  study.date = $("dateInput").value || todayIso();

  if (!study.title) {
    $("detailsError").textContent = "Please write a title.";
    $("detailsError").hidden = false;
    return;
  }

  const btn = $("toPreviewBtn");
  btn.disabled = true;
  try {
    await saveDraft();
    showPreview();
  } catch (e) {
    console.error(e);
    $("detailsError").textContent = "It couldn’t be saved. Please check the internet connection and try again.";
    $("detailsError").hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// Guarda (o actualiza) en Firestore. Si es nuevo, entra como borrador.
async function saveDraft() {
  const data = {
    category: study.category,
    title: study.title,
    subtitle: study.subtitle,
    book: study.book,
    passage: study.passage,
    bodyHtml: study.bodyHtml,
    words: study.words,
    sourceName: study.sourceName,
    author: "Neil Whatmough",
    status: study.status,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid
  };
  // Un borrador guarda la fecha elegida; una publicada la conserva hasta que se vuelva a publicar
  if (study.status !== "published") data.publishAt = Timestamp.fromDate(new Date(study.date + "T06:00:00"));

  if (study.id) {
    await updateDoc(doc(db, "readings", study.id), data);
  } else {
    const ref = doc(collection(db, "readings"));
    data.createdAt = serverTimestamp();
    data.createdBy = user.uid;
    await setDoc(ref, data);
    study.id = ref.id;
  }
}

// Paso 4: vista previa
function showPreview() {
  const url = "../reading.html?id=" + encodeURIComponent(study.id);
  $("previewFrame").src = url + "&v=" + Date.now(); // &v= para que no muestre una versión vieja
  $("previewFullLink").href = url;
  $("publishError").hidden = true;

  const published = study.status === "published";
  const future = study.date > todayIso();
  $("previewStep").hidden = published;
  $("publishBtn").hidden = published;
  $("publishBtn").textContent = future ? "✓ Publish on " + niceDate(study.date) : "✓ Publish now";
  $("unpublishBtn").hidden = !published;
  show("preview");
}

$("editBtn").addEventListener("click", showDetails);

$("publishBtn").addEventListener("click", async () => {
  const btn = $("publishBtn");
  btn.disabled = true;
  try {
    await updateDoc(doc(db, "readings", study.id), {
      status: "published",
      publishAt: publishMoment(study.date),
      updatedAt: serverTimestamp(),
      updatedBy: user.uid
    });
    study.status = "published";
    const future = study.date > todayIso();
    $("doneTitle").textContent = future ? "All set!" : "Published!";
    $("doneText").textContent = future
      ? "It will appear on the website on " + niceDate(study.date) + "."
      : "“" + study.title + "” is now on the website.";
    $("doneLink").href = "../reading.html?id=" + encodeURIComponent(study.id);
    $("doneLink").hidden = future;
    show("done");
  } catch (e) {
    console.error(e);
    $("publishError").textContent = "It couldn’t be published. Please check the internet connection and try again.";
    $("publishError").hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$("unpublishBtn").addEventListener("click", async () => {
  if (!confirm("Take “" + study.title + "” off the website? It will stay here as a draft.")) return;
  try {
    await updateDoc(doc(db, "readings", study.id), {
      status: "draft", updatedAt: serverTimestamp(), updatedBy: user.uid
    });
    study.status = "draft";
    showPreview();
  } catch (e) {
    console.error(e);
    $("publishError").textContent = "It couldn’t be changed. Please try again.";
    $("publishError").hidden = false;
  }
});
