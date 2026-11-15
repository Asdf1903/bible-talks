/* =========================================================
   site.js: lo que comparten todas las páginas públicas
   - Botón de modo claro/oscuro (se guarda en "bt-theme", igual que el lector)
   - Menú ☰ en celular
   - El año del pie
   ========================================================= */
(function () {
  var root = document.documentElement;
  var systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  var themeBtn = document.getElementById("themeBtn");
  var menuBtn = document.getElementById("menuBtn");

  function isDark() {
    return root.dataset.theme ? root.dataset.theme === "dark" : systemDark.matches;
  }

  function paintTheme() {
    var dark = isDark();
    document.body.classList.toggle("is-light", !dark);
    if (themeBtn) themeBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }

  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = isDark() ? "light" : "dark";
      root.dataset.theme = next;
      try { localStorage.setItem("bt-theme", next); } catch (e) {}
      paintTheme();
    });
  }
  systemDark.addEventListener("change", paintTheme);
  paintTheme();

  if (menuBtn) {
    menuBtn.addEventListener("click", function () {
      var open = document.body.classList.toggle("nav-open");
      menuBtn.setAttribute("aria-expanded", String(open));
    });
  }

  // PRUEBA TEMPORAL: comparar fondos con ?bg=creation | sinai | jacob | jupiter
  // (se recuerda en este navegador). Quitar cuando Neil elija.
  var BGS = { creation: "bg-dore-creation.jpg", sinai: "bg-dore-sinai.jpg", jacob: "bg-dore-jacob.jpg", jupiter: "bg-engraving-test.jpg" };
  var bg = new URLSearchParams(location.search).get("bg");
  try { if (bg) localStorage.setItem("bt-bg-test", bg); else bg = localStorage.getItem("bt-bg-test"); } catch (e) {}
  if (bg && BGS[bg]) {
    // Dirección completa: una ruta relativa dentro de una variable CSS se resuelve desde
    // site.css (y quedaría assets/assets/img/...)
    var full = new URL("assets/img/" + BGS[bg], location.href).href;
    document.body.style.setProperty("--bg-image", "url(\"" + full + "\")");
  }

  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
})();
