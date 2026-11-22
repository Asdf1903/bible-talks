/* =========================================================
   category.js: la página de una sección (category.html?c=...)
   Muestra el nombre, ícono, color y descripción de la sección,
   y sus estudios publicados en "cápsulas", del más nuevo al más viejo.
   ========================================================= */
import { SECTIONS, sectionById, sectionIcon } from "./sections.js";
import { getPublished, readingLink, readTime } from "./studies.js";

const $ = (id) => document.getElementById(id);

// Qué sección: la de la dirección (?c=...); si no existe, Good News
const wanted = new URLSearchParams(location.search).get("c");
const section = sectionById(wanted) || SECTIONS[0];

document.title = section.name + " · Bible Talks";
document.body.classList.add("sec-" + section.id); // su color (--c) para toda la página
$("catIcon").innerHTML = sectionIcon(section.id); // dibujo fijo nuestro, no datos de afuera
$("catTitle").textContent = section.name;
$("catAbout").textContent = section.about;

// En el menú de arriba, marcar esta sección
document.querySelectorAll(".site-nav a").forEach((a) => {
  if (a.getAttribute("href") === "category.html?c=" + section.id) a.setAttribute("aria-current", "page");
});

// Crea un elemento con texto (sin innerHTML para los datos)
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Una cápsula: título, subtítulo, (pasaje bíblico ·) minutos de lectura, flecha
function capsule(item) {
  const r = item.data;
  const li = el("li");
  const a = el("a", "capsule");
  a.href = readingLink(item.id);
  const text = el("div", "capsule-text");
  text.append(el("h2", null, r.title || ""));
  if (r.subtitle) text.append(el("p", "capsule-sub", r.subtitle));
  const passage = [r.book, r.passage].filter(Boolean).join(" ");
  text.append(el("p", "meta-line", (passage ? passage + " · " : "") + readTime(r)));
  a.append(text, el("span", "capsule-arrow", "›"));
  a.lastChild.setAttribute("aria-hidden", "true");
  li.appendChild(a);
  return li;
}

$("catCount").textContent = "Loading…";
const studies = (await getPublished()).filter((x) => x.data.category === section.id);
const list = $("list");
studies.forEach((x) => list.appendChild(capsule(x)));
$("catCount").textContent = studies.length === 1 ? "1 study" : studies.length ? studies.length + " studies" : "";
$("empty").hidden = studies.length > 0;
