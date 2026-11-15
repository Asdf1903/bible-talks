/* =========================================================
   Bible Talks: lógica de la página de lectura
   Qué hace este archivo, en orden:
     1. Pinta la lectura (portada + texto + cierre)
     2. La parte en páginas del tamaño de la pantalla (modo libro)
     3. Cambio de página: botones, swipe, toque en los bordes, teclado
     4. Tamaño de letra (A− / A+)
     5. Modo nocturno
     6. Escuchar (el navegador lee en voz alta)
     7. Recordar dónde se quedó el lector
   Sin librerías: JavaScript normal.
   ========================================================= */
(function () {
  "use strict";

  var reading = window.SAMPLE_READING;

  var CATEGORIES = {
    "good-news": "Good News",
    "doctrine": "Doctrine",
    "bible-study": "Bible Study",
    "prophecy": "Prophecy"
  };

  // Elementos de la página
  var $ = function (id) { return document.getElementById(id); };
  var viewport = $("viewport");
  var pagesEl = $("pages");
  var prevBtn = $("prevBtn");
  var nextBtn = $("nextBtn");
  var pageLabel = $("pageLabel");
  var progressFill = $("progressFill");
  var listenBtn = $("listenBtn");
  var themeBtn = $("themeBtn");

  // localStorage puede fallar (modo incógnito, etc.): siempre con try/catch
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  /* ---------- 1. Pintar la lectura ---------- */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function formatDate(iso) {
    var d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  function render() {
    var category = CATEGORIES[reading.category] || "";
    var words = reading.bodyHtml.replace(/<[^>]+>/g, " ").trim().split(/\s+/).length;
    var minutes = Math.max(1, Math.round(words / 200));

    document.title = reading.title + " · Bible Talks";
    $("backLabel").textContent = category || "Back";
    $("backLink").href = "category.html?c=" + reading.category;

    var spoken = reading.title + ". " + (reading.subtitle ? reading.subtitle.replace(/·/g, ",") + ". " : "");

    pagesEl.innerHTML =
      '<header class="title-block" data-say="' + escapeHtml(spoken) + '">' +
        (category ? '<p class="eyebrow">' + escapeHtml(category) + "</p>" : "") +
        "<h1>" + escapeHtml(reading.title) + "</h1>" +
        (reading.subtitle ? '<p class="subtitle">' + escapeHtml(reading.subtitle) + "</p>" : "") +
        '<p class="meta">By ' + escapeHtml(reading.author) + " · " + formatDate(reading.publishedAt) +
        " · " + minutes + " min read</p>" +
      "</header>" +
      '<div class="body">' + reading.bodyHtml + "</div>" +
      '<footer class="end-card">' +
        '<div class="fleuron" aria-hidden="true">✦</div>' +
        '<p class="sign">' + escapeHtml(reading.author) + "</p>" +
        '<p>Questions or thoughts? <a href="mailto:neil@whatmough.ca">Write to Neil</a></p>' +
        '<div class="end-actions">' +
          (reading.pdfUrl ? '<a class="btn" href="' + encodeURI(reading.pdfUrl) + '" download>Download PDF</a>' : "") +
          '<a class="btn ghost" href="category.html?c=' + reading.category + '">More ' + escapeHtml(category) + "</a>" +
        "</div>" +
        '<span id="endMark"></span>' +
      "</footer>";

    // Cada párrafo es un "bloque" que se puede leer en voz alta
    pagesEl.querySelectorAll(".body > p, .body > blockquote, .body > h2, .body > h3, .body > li")
      .forEach(function (el) { el.setAttribute("data-say", ""); });
  }

  /* ---------- 2. Partir en páginas ---------- */
  // Truco: el texto se acomoda en columnas del alto de la pantalla.
  // Cada columna es una página. Para "cambiar de página" movemos el texto
  // hacia la izquierda el ancho de una página (o de dos, en pantallas grandes).

  var perView = 1;     // páginas visibles a la vez (1 en celular, 2 en pantalla grande)
  var step = 0;        // ancho de una página + el espacio entre páginas
  var totalPages = 1;
  var totalViews = 1;
  var view = 0;        // vista actual (0 = la primera)

  function blocks() {
    return pagesEl.querySelectorAll("[data-say]");
  }

  // Modo de respaldo: lectura con scroll normal (sin páginas)
  var scrollMode = false;
  function setScrollMode(on) {
    scrollMode = on;
    document.body.classList.toggle("scroll-mode", on);
    if (on) {
      pagesEl.style.transform = "none";
      pageLabel.textContent = "Scroll to read";
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      updateScrollProgress();
    }
  }

  function updateScrollProgress() {
    var max = viewport.scrollHeight - viewport.clientHeight;
    progressFill.style.width = (max > 0 ? viewport.scrollTop / max * 100 : 100) + "%";
  }

  viewport.addEventListener("scroll", function () {
    if (!scrollMode) return;
    updateScrollProgress();
    save("bt-pos-" + reading.id, String(firstBlockInView()));
  }, { passive: true });

  // ¿En qué página (0, 1, 2...) cae este elemento?
  function pageOf(el) {
    var left = el.getBoundingClientRect().left - pagesEl.getBoundingClientRect().left;
    return Math.max(0, Math.floor((left + 2) / step));
  }

  function viewOf(el) {
    return Math.floor(pageOf(el) / perView);
  }

  // Primer párrafo visible en la vista actual (para no perder el lugar)
  function firstBlockInView() {
    var list = blocks();
    if (scrollMode) {
      var top = viewport.getBoundingClientRect().top;
      for (var j = 0; j < list.length; j++) {
        if (list[j].getBoundingClientRect().bottom > top + 4) return j;
      }
      return 0;
    }
    var firstPage = view * perView;
    for (var i = 0; i < list.length; i++) {
      var rects = list[i].getClientRects();
      var last = rects[rects.length - 1];
      if (!last) continue;
      var endPage = Math.floor((last.left - pagesEl.getBoundingClientRect().left + 2) / step);
      if (endPage >= firstPage) return i;
    }
    return 0;
  }

  function layout(keepBlock) {
    var width = viewport.clientWidth;
    var height = viewport.clientHeight;
    if (!width || !height) return; // la página aún no tiene tamaño
    perView = window.innerWidth >= 900 ? 2 : 1; // igual que el @media de reader.css
    var gap = perView === 2 ? 112 : 44;

    setScrollMode(false);
    var colWidth = (width - (perView - 1) * gap) / perView;
    pagesEl.style.height = height + "px";
    // Ancho de columna (y no "número de columnas"): así lo hacen los lectores de
    // libros en iPhone. El -1 evita que un redondeo deje una columna menos.
    pagesEl.style.columnCount = "auto";
    pagesEl.style.columnWidth = Math.floor(colWidth - 1) + "px";
    pagesEl.style.columnGap = gap + "px";

    step = colWidth + gap;
    var endMark = $("endMark");
    totalPages = pageOf(endMark) + 1;
    totalViews = Math.ceil(totalPages / perView);

    // Respaldo: si el navegador no partió el texto en páginas (el final del texto
    // quedó más abajo de la pantalla), se lee con scroll normal.
    if (endMark.getBoundingClientRect().bottom > viewport.getBoundingClientRect().bottom + 4) {
      setScrollMode(true);
      var b0 = blocks()[keepBlock];
      if (b0 && keepBlock > 0) b0.scrollIntoView({ block: "start" });
      return;
    }

    var target = 0;
    if (typeof keepBlock === "number") {
      var b = blocks()[keepBlock];
      if (b) target = viewOf(b);
    }
    goTo(target, false);
  }

  function goTo(v, animate) {
    if (scrollMode) return;
    view = Math.max(0, Math.min(v, totalViews - 1));
    pagesEl.classList.toggle("dragging", animate === false);
    pagesEl.style.transform = "translateX(" + (-view * perView * step) + "px)";
    if (animate === false) {
      pagesEl.offsetWidth; // fuerza el repintado antes de reactivar la animación
      pagesEl.classList.remove("dragging");
    }

    var first = view * perView + 1;
    var last = Math.min(first + perView - 1, totalPages);
    pageLabel.textContent = (first === last ? "Page " + first : "Pages " + first + "–" + last) +
      " of " + totalPages;
    prevBtn.disabled = view === 0;
    nextBtn.disabled = view >= totalViews - 1;
    progressFill.style.width = ((view + 1) / totalViews * 100) + "%";

    save("bt-pos-" + reading.id, String(firstBlockInView()));
  }

  function next() { goTo(view + 1); }
  function prev() { goTo(view - 1); }

  /* ---------- 3. Cambiar de página ---------- */

  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);

  document.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight" || e.key === "PageDown") { next(); e.preventDefault(); }
    if (e.key === "ArrowLeft" || e.key === "PageUp") { prev(); e.preventDefault(); }
  });

  // Swipe con el dedo: el texto sigue al dedo y al soltar cambia de página
  var touch = null;

  viewport.addEventListener("touchstart", function (e) {
    if (scrollMode || e.touches.length !== 1) return;
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, horizontal: null };
  }, { passive: true });

  viewport.addEventListener("touchmove", function (e) {
    if (!touch) return;
    touch.dx = e.touches[0].clientX - touch.x;
    var dy = e.touches[0].clientY - touch.y;
    if (touch.horizontal === null && (Math.abs(touch.dx) > 8 || Math.abs(dy) > 8)) {
      touch.horizontal = Math.abs(touch.dx) > Math.abs(dy);
    }
    if (touch.horizontal) {
      pagesEl.classList.add("dragging");
      // Resistencia al jalar más allá de la primera o la última página
      var edge = (view === 0 && touch.dx > 0) || (view === totalViews - 1 && touch.dx < 0);
      var dx = edge ? touch.dx * 0.25 : touch.dx;
      pagesEl.style.transform = "translateX(" + (-view * perView * step + dx) + "px)";
    }
  }, { passive: true });

  viewport.addEventListener("touchend", function () {
    if (!touch) return;
    pagesEl.classList.remove("dragging");
    if (touch.horizontal && Math.abs(touch.dx) > 50) {
      touch.dx < 0 ? next() : prev();
    } else {
      goTo(view); // regresa a su lugar
    }
    touch = null;
  });

  // Toque o click en el borde izquierdo / derecho de la página
  viewport.addEventListener("click", function (e) {
    if (scrollMode || e.target.closest("a, button")) return;
    if (window.getSelection && String(window.getSelection())) return; // está seleccionando texto
    var r = viewport.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width;
    if (x < 0.25) prev();
    else if (x > 0.75) next();
  });

  /* ---------- 4. Tamaño de letra ---------- */

  var SIZES = [16, 17, 19, 21, 24, 27, 30];
  var sizeIndex = Math.min(SIZES.length - 1, Math.max(0, parseInt(load("bt-size", "2"), 10) || 2));

  function applySize(newIndex) {
    var keep = firstBlockInView();
    sizeIndex = newIndex;
    pagesEl.style.setProperty("--read-size", SIZES[sizeIndex] + "px");
    $("fontDown").disabled = sizeIndex === 0;
    $("fontUp").disabled = sizeIndex === SIZES.length - 1;
    save("bt-size", String(sizeIndex));
    layout(keep);
  }

  $("fontDown").addEventListener("click", function () { if (sizeIndex > 0) applySize(sizeIndex - 1); });
  $("fontUp").addEventListener("click", function () { if (sizeIndex < SIZES.length - 1) applySize(sizeIndex + 1); });

  /* ---------- 5. Modo nocturno ---------- */

  var ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  function isDark() {
    var t = document.documentElement.dataset.theme;
    return t ? t === "dark" : systemDark.matches;
  }

  function paintThemeButton() {
    themeBtn.innerHTML = isDark() ? ICON_SUN : ICON_MOON;
    themeBtn.setAttribute("aria-label", isDark() ? "Day mode" : "Night mode");
  }

  themeBtn.addEventListener("click", function () {
    var theme = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    save("bt-theme", theme);
    paintThemeButton();
  });
  systemDark.addEventListener("change", paintThemeButton);

  /* ---------- 6. Escuchar ---------- */
  // Usa la voz que ya trae el celular o la computadora (gratis).
  // Lee párrafo por párrafo, resalta el que va leyendo y cambia de página solo.

  var ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';

  var synth = window.speechSynthesis;
  var voice = null;
  var playing = false;
  var session = 0;     // cambia cada vez que se detiene, para ignorar avisos viejos
  var current = -1;    // párrafo que se está leyendo

  function paintListenButton() {
    listenBtn.innerHTML = (playing ? ICON_PAUSE : ICON_PLAY) +
      '<span class="listen-label">' + (playing ? "Pause" : "Listen") + "</span>";
    listenBtn.setAttribute("aria-label", playing ? "Pause reading" : "Listen to this reading");
  }

  // Escoge la voz en inglés que suene más natural
  function pickVoice() {
    if (!synth) return;
    var english = synth.getVoices().filter(function (v) { return /^en/i.test(v.lang); });
    var preferred = /natural|neural|google|samantha|daniel|karen|moira|serena|aria|jenny|guy/i;
    voice = english.filter(function (v) { return preferred.test(v.name); })[0] ||
            english.filter(function (v) { return v.localService; })[0] ||
            english[0] || null;
  }

  // Algunos navegadores se cortan con textos largos: se lee oración por oración
  function sentences(text) {
    var parts = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+[”’"]*|[^.!?]+$/g) || [text];
    var out = [];
    parts.forEach(function (p) {
      p = p.trim();
      if (!p) return;
      if (out.length && (out[out.length - 1].length + p.length) < 160) out[out.length - 1] += " " + p;
      else out.push(p);
    });
    return out;
  }

  function markSpeaking(i) {
    pagesEl.querySelectorAll(".speaking").forEach(function (el) { el.classList.remove("speaking"); });
    var b = blocks()[i];
    if (!b) return;
    b.classList.add("speaking");
    if (scrollMode) { b.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    var v = viewOf(b);
    if (v !== view) goTo(v);
  }

  function speakBlock(i, mySession) {
    var list = blocks();
    if (i >= list.length) { stopListening(); return; }
    current = i;
    markSpeaking(i);
    var el = list[i];
    var text = el.getAttribute("data-say") || el.textContent;
    var queue = sentences(text);
    var n = 0;

    (function speakNext() {
      if (mySession !== session) return;
      if (n >= queue.length) { speakBlock(i + 1, mySession); return; }
      var u = new SpeechSynthesisUtterance(queue[n]);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = "en-US"; }
      u.rate = 0.92; // un poco más pausado que lo normal
      u.onend = function () { n++; speakNext(); };
      u.onerror = function (e) {
        if (e.error === "interrupted" || e.error === "canceled") return;
        n++; speakNext();
      };
      synth.speak(u);
    })();
  }

  function startListening() {
    if (!voice) pickVoice();
    synth.cancel();
    playing = true;
    session++;
    // Si el párrafo resaltado está en esta vista, sigue desde ahí; si no, desde lo que se ve
    var start = firstBlockInView();
    var b = blocks()[current];
    if (b && !scrollMode && viewOf(b) === view) start = current;
    paintListenButton();
    speakBlock(start, session);
  }

  function stopListening() {
    playing = false;
    session++;
    if (synth) synth.cancel();
    paintListenButton();
  }

  if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
    listenBtn.hidden = true; // este navegador no puede leer en voz alta
  } else {
    pickVoice();
    if (synth.addEventListener) synth.addEventListener("voiceschanged", pickVoice);
    listenBtn.addEventListener("click", function () { playing ? stopListening() : startListening(); });
    window.addEventListener("pagehide", stopListening);
  }

  /* ---------- 7. Arrancar ---------- */

  render();
  paintThemeButton();
  paintListenButton();

  var savedBlock = parseInt(load("bt-pos-" + reading.id, "0"), 10) || 0;
  pagesEl.style.setProperty("--read-size", SIZES[sizeIndex] + "px");
  $("fontDown").disabled = sizeIndex === 0;
  $("fontUp").disabled = sizeIndex === SIZES.length - 1;
  layout(savedBlock);

  // Cuando terminan de cargar las letras, o si se gira el celular, se vuelve a acomodar
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { layout(firstBlockInView()); });
  }
  // Se vuelve a acomodar cada vez que cambia el tamaño del espacio del libro
  // (girar el celular, la barra del navegador que aparece y desaparece, etc.)
  var resizeTimer, keepOnResize = null, lastSize = "";
  function onResize() {
    var size = viewport.clientWidth + "x" + viewport.clientHeight;
    if (size === lastSize) return;
    lastSize = size;
    if (keepOnResize === null) keepOnResize = firstBlockInView();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      layout(keepOnResize);
      keepOnResize = null;
    }, 150);
  }
  lastSize = viewport.clientWidth + "x" + viewport.clientHeight;
  window.addEventListener("resize", onResize);
  window.addEventListener("load", function () { layout(firstBlockInView()); });
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(viewport);
})();
