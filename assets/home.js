/* =========================================================
   home.js: llena la portada con los estudios publicados (Firestore)
   - "This week": el más nuevo
   - "Explore": las 4 secciones con cuántos estudios tiene cada una
   - "Recent studies": los siguientes 6
   El público solo puede leer estudios publicados cuya fecha ya llegó
   (lo cuidan las reglas de Firestore); por eso la consulta pide eso mismo.
   ========================================================= */
import { db } from "./firebase.js";
import {
  collection, query, where, orderBy, limit, getDocs, Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// Descripciones públicas de cada sección (BORRADOR: Neil las revisa)
const SECTIONS = [
  { id: "good-news",   name: "Good News",   about: "Stories from Neil’s life and what they taught him about the way to salvation." },
  { id: "doctrine",    name: "Doctrine",    about: "Teachings on how to live as a Christian, from people in the Bible and beyond." },
  { id: "bible-study", name: "Bible Study", about: "Books, chapters and verses of the Bible, explained one passage at a time." },
  { id: "prophecy",    name: "Prophecy",    about: "What the prophets foretold: Daniel, Isaiah, Ezekiel, Matthew 24 and Revelation." }
];
const sectionName = (id) => (SECTIONS.find((s) => s.id === id) || {}).name || "";

const $ = (id) => document.getElementById(id);

function niceDate(ts) {
  const d = ts && ts.toDate ? ts.toDate() : new Date();
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ~200 palabras por minuto
function readTime(r) {
  const words = r.words || r.bodyHtml.replace(/<[^>]+>/g, " ").trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 200)) + " min read";
}

const link = (id) => "reading.html?id=" + encodeURIComponent(id);

function paintFeature(item) {
  const box = $("feature");
  if (!item) {
    box.innerHTML = '<p class="empty-note">The first study is coming soon.</p>';
    return;
  }
  const r = item.data;
  box.innerHTML =
    '<a class="feature"><span class="label"></span><h3></h3><p class="sub"></p>' +
    '<span class="meta-line"></span><span class="btn-read read">Read the study ›</span></a>';
  const a = box.querySelector("a");
  a.href = link(item.id);
  a.querySelector(".label").textContent = sectionName(r.category);
  a.querySelector("h3").textContent = r.title;
  a.querySelector(".sub").textContent = r.subtitle || "";
  a.querySelector(".sub").hidden = !r.subtitle;
  a.querySelector(".meta-line").textContent = niceDate(r.publishAt) + " · " + readTime(r);
}

function paintSections(items) {
  const grid = $("sections");
  grid.innerHTML = "";
  SECTIONS.forEach((s) => {
    const n = items.filter((x) => x.data.category === s.id).length;
    const a = document.createElement("a");
    a.className = "section-card";
    a.href = "category.html?c=" + s.id;
    a.innerHTML = "<h3></h3><p></p><span class=\"count\"></span>";
    a.querySelector("h3").textContent = s.name;
    a.querySelector("p").textContent = s.about;
    a.querySelector(".count").textContent = n ? n + (n === 1 ? " study" : " studies") + " ›" : "Coming soon";
    grid.appendChild(a);
  });
}

function paintRecent(items) {
  const list = $("recent");
  list.innerHTML = "";
  items.forEach((item) => {
    const r = item.data;
    const a = document.createElement("a");
    a.className = "recent-item";
    a.href = link(item.id);
    a.innerHTML = '<span class="label"></span><h3></h3><span class="meta-line"></span>';
    a.querySelector(".label").textContent = sectionName(r.category);
    a.querySelector("h3").textContent = r.title;
    a.querySelector(".meta-line").textContent = niceDate(r.publishAt) + " · " + readTime(r);
    list.appendChild(a);
  });
  $("recentBlock").hidden = items.length === 0;
}

async function load() {
  let items = [];
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
    items = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  } catch (e) {
    // La primera vez, Firestore pide crear un "índice": el error trae el enlace.
    console.error(e);
  }
  paintFeature(items[0]);
  paintSections(items);
  paintRecent(items.slice(1, 7));
}

paintSections([]);
load();
