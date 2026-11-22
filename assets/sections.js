/* =========================================================
   sections.js: las 4 secciones del sitio (los "cuartos de la casa")
   Las usan la portada (home.js) y la página de cada sección (category.js).
   - about: la descripción que Neil aprobó (2026-11-21)
   - icon:  dibujo de líneas (SVG). Sin símbolos religiosos: a Neil no le gustan.
   - El color de cada una está en styles.css (--sec-good-news, etc.)
   ========================================================= */

export const SECTIONS = [
  {
    id: "good-news",
    name: "Good News",
    about: "Stories from Neil’s life and the way to salvation.",
    // Amanecer: sol saliendo sobre el horizonte
    icon: '<path d="M3 18h18M8 21h8"/><path d="M7 18a5 5 0 0 1 10 0"/>' +
          '<path d="M12 5v3M5.2 9.2l2 2M18.8 9.2l-2 2M2.5 14h2.5M19 14h2.5"/>'
  },
  {
    id: "doctrine",
    name: "Doctrine",
    about: "How to live as a Christian.",
    // Columnas sobre una base: los cimientos de cómo vivir
    icon: '<path d="M3 21h18M5 18h14M6 18v-8M10 18v-8M14 18v-8M18 18v-8M4 10h16M12 3l8 4.5H4z"/>'
  },
  {
    id: "bible-study",
    name: "Bible Study",
    about: "The Bible explained, passage by passage.",
    // Libro abierto
    icon: '<path d="M12 6.5C10 5 7 4.5 3.5 5v14c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/>' +
          '<path d="M12 6.5V20.5"/>'
  },
  {
    id: "prophecy",
    name: "Prophecy",
    about: "Daniel, Isaiah, Ezekiel, Matthew 24, Revelation.",
    // Reloj de arena: el tiempo, lo que viene
    icon: '<path d="M6 3h12M6 21h12"/>' +
          '<path d="M7.5 3v2.5c0 3 4.5 4.5 4.5 6.5s-4.5 3.5-4.5 6.5V21M16.5 3v2.5c0 3-4.5 4.5-4.5 6.5s4.5 3.5 4.5 6.5V21"/>'
  }
];

export const sectionById = (id) => SECTIONS.find((s) => s.id === id) || null;
export const sectionName = (id) => (sectionById(id) || {}).name || "";

// El ícono listo para meter en la página
export function sectionIcon(id) {
  const s = sectionById(id);
  return s ? '<svg viewBox="0 0 24 24" aria-hidden="true">' + s.icon + "</svg>" : "";
}
