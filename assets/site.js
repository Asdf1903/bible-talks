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

  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
})();
