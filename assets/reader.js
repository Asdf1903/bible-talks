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
// reading-loader.js llama a BibleReader.start(lectura) cuando ya tiene la lectura
window.BibleReader = { start: function (reading) {
  "use strict";

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

  // Vista previa del panel (reading.html?preview=1): siempre abre en la página 1
  // y no recuerda dónde se quedó (si no, cada estudio nuevo abría donde se quedó el anterior).
  var isPreview = /[?&]preview=/.test(location.search);

  function render() {
    var category = CATEGORIES[reading.category] || "";
    var words = reading.bodyHtml.replace(/<[^>]+>/g, " ").trim().split(/\s+/).length;
    var minutes = Math.max(1, Math.round(words / 200));
    var author = (reading.author || "").trim();

    document.title = reading.title + " · Bible Talks";
    $("backLabel").textContent = category || "Back";
    $("backLink").href = "category.html?c=" + reading.category;

    var spoken = reading.title + ". " + (reading.subtitle ? reading.subtitle.replace(/·/g, ",") + ". " : "");

    pagesEl.innerHTML =
      '<header class="title-block" data-say="' + escapeHtml(spoken) + '">' +
        (category ? '<p class="eyebrow">' + escapeHtml(category) + "</p>" : "") +
        "<h1>" + escapeHtml(reading.title) + "</h1>" +
        (reading.subtitle ? '<p class="subtitle">' + escapeHtml(reading.subtitle) + "</p>" : "") +
        // Cada dato en su cajita: si no cabe, baja completo (sin puntos huérfanos).
        // Sin fecha: Neil no quiere que se vea. Sin autor = anónimo (no sale "By").
        '<p class="meta">' + (author ? "<span>By " + escapeHtml(author) + "</span> <span>· " : "<span>") +
        minutes + " min read</span></p>" +
      "</header>" +
      '<div class="body">' + reading.bodyHtml + "</div>" +
      '<footer class="end-card">' +
        '<div class="fleuron" aria-hidden="true">✦</div>' +
        (author ? '<p class="sign">' + escapeHtml(author) + "</p>" : "") +
        '<p>Questions or thoughts? <a href="mailto:neil@whatmough.ca">' +
          (author === "Neil Whatmough" ? "Write to Neil" : "Write to us") + "</a></p>" +
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
    if (!isPreview) save("bt-pos-" + reading.id, String(firstBlockInView()));
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

  // Un título con una palabra muy larga ("PROPITIATION") no se parte en dos renglones:
  // se achica la letra del título hasta que la palabra quepa en la página.
  function fitTitle() {
    var h1 = pagesEl.querySelector(".title-block h1");
    if (!h1) return;
    h1.style.fontSize = "";
    var size = 2.1; // el mismo de reader.css
    while (h1.scrollWidth > h1.clientWidth + 1 && size > 1.2) {
      size -= 0.1;
      h1.style.fontSize = size.toFixed(1) + "em";
    }
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
    fitTitle();

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

    if (!isPreview) save("bt-pos-" + reading.id, String(firstBlockInView()));
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
  // Lee ORACIÓN por oración (los párrafos de Neil son largos): resalta la oración
  // que va leyendo y, si la voz lo permite, también la palabra. Cuando lo que lee
  // ya está en la página siguiente, cambia de página solo.
  //
  // Cómo resalta sin tocar el texto: con "rangos" (un pedazo de texto marcado del
  // carácter X al Y) y la función de resaltado del navegador (CSS Custom Highlight).
  // Si el navegador es viejo y no la tiene, resalta el párrafo completo.

  var ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';

  var synth = window.speechSynthesis;
  var voice = null;
  var playing = false;
  var session = 0;     // cambia cada vez que se detiene, para ignorar avisos viejos
  var current = null;  // dónde va: { block: párrafo, unit: pedazo dentro del párrafo }

  var canHighlight = !!(window.CSS && CSS.highlights && window.Highlight);
  var hlSentence = canHighlight ? new Highlight() : null;
  var hlWord = canHighlight ? new Highlight() : null;
  if (canHighlight) {
    CSS.highlights.set("bt-sentence", hlSentence);
    CSS.highlights.set("bt-word", hlWord);
  }

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

  // --- El texto de un párrafo como una sola tira, sabiendo de qué nodo sale cada letra ---
  function textMap(el) {
    var nodes = [], text = "", n;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while ((n = walker.nextNode())) {
      nodes.push({ node: n, start: text.length });
      text += n.nodeValue;
    }
    return { text: text, nodes: nodes };
  }

  // Rango del carácter `from` al `to` dentro de un párrafo
  function rangeFor(map, from, to) {
    function at(pos, isEnd) {
      for (var i = 0; i < map.nodes.length; i++) {
        var item = map.nodes[i], end = item.start + item.node.nodeValue.length;
        if (pos < end || (isEnd && pos === end)) return { node: item.node, offset: Math.max(0, pos - item.start) };
      }
      var last = map.nodes[map.nodes.length - 1];
      return { node: last.node, offset: last.node.nodeValue.length };
    }
    var a = at(from, false), b = at(to, true);
    var r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    return r;
  }

  // Parte el texto en oraciones. Un punto cuenta como fin de oración solo si:
  //   - lo sigue un espacio (así "3.16" no se corta),
  //   - lo que sigue NO empieza en minúscula o número ("1 Cor. 13" no se corta), y
  //   - no es una abreviatura conocida ("Mr. Smith", "Rom. 5").
  // Pedacitos muy cortos se pegan al siguiente.
  var ABBR = /(?:^|[\s(])(mr|mrs|ms|dr|st|rev|gen|ex|lev|num|deut|josh|judg|sam|kgs|chron|neh|esth|ps|prov|eccl|isa|jer|lam|ezek|dan|hos|obad|mic|nah|hab|zeph|hag|zech|mal|matt|mk|lk|jn|rom|cor|gal|eph|phil|col|thess|tim|tit|philem|heb|jas|pet|vs|cf|ch|vv|e\.g|i\.e|etc|no)\.$/i;
  function sentenceSpans(text) {
    var out = [], start = 0, i = 0, L = text.length;
    function push(a, b) {
      while (a < b && /\s/.test(text[a])) a++;
      while (b > a && /\s/.test(text[b - 1])) b--;
      if (b > a) out.push({ from: a, to: b });
    }
    while (i < L) {
      if (/[.!?…]/.test(text[i])) {
        var j = i + 1;
        while (j < L && /[.!?…"”’)\]]/.test(text[j])) j++;
        var after = text.slice(j).match(/^\s+(\S)/);
        var isEnd = j >= L || (after && !/[a-z0-9]/.test(after[1]));
        if (isEnd && text[i] === "." && j === i + 1 && ABBR.test(text.slice(Math.max(start, i - 8), i + 1))) isEnd = false;
        if (isEnd) { push(start, j); start = j; i = j; continue; }
      }
      i++;
    }
    push(start, L);
    for (var k = 0; k < out.length - 1; k++) {
      if (out[k].to - out[k].from < 12) { out[k + 1].from = out[k].from; out.splice(k, 1); k--; }
    }
    return out;
  }

  // Lo que se le da a la voz de un jalón. Oraciones muy largas se parten en comas,
  // porque algunas voces se cortan solas a los ~15 segundos.
  var MAX_CHUNK = 180;
  function speechUnits(text) {
    var units = [];
    sentenceSpans(text).forEach(function (s) {
      var from = s.from;
      while (s.to - from > MAX_CHUNK) {
        var piece = text.slice(from, from + MAX_CHUNK);
        var cut = Math.max(piece.lastIndexOf(", "), piece.lastIndexOf("; "), piece.lastIndexOf(": "),
                           piece.lastIndexOf(" — "), piece.lastIndexOf(" – "));
        if (cut < 40) cut = piece.lastIndexOf(" ");
        if (cut < 1) break;
        units.push({ from: from, to: from + cut + 1, sFrom: s.from, sTo: s.to });
        from += cut + 1;
        while (from < s.to && /\s/.test(text[from])) from++;
      }
      units.push({ from: from, to: s.to, sFrom: s.from, sTo: s.to });
    });
    return units.map(function (u) { u.text = text.slice(u.from, u.to); return u; });
  }

  // Los pedazos de un bloque. El encabezado trae su propio texto (data-say="…"):
  // se lee entero y se resalta el bloque.
  function unitsOf(el) {
    var say = el.getAttribute("data-say");
    if (say) return { map: null, list: [{ text: say }] };
    var map = textMap(el);
    return { map: map, list: map.nodes.length ? speechUnits(map.text) : [] };
  }

  // ¿En qué vista (pantalla de páginas) está este rango? -1 si no se sabe
  function viewOfRange(r) {
    var rect = r.getClientRects()[0];
    if (!rect) return -1;
    var page = Math.max(0, Math.floor((rect.left - pagesEl.getBoundingClientRect().left + 2) / step));
    return Math.floor(page / perView);
  }

  // Que se vea lo que se está leyendo: cambia de página (o hace scroll) si hace falta
  function showRange(r) {
    if (scrollMode) {
      var rect = r.getClientRects()[0], vr = viewport.getBoundingClientRect();
      if (rect && (rect.top < vr.top || rect.bottom > vr.bottom)) {
        viewport.scrollBy({ top: rect.top - vr.top - vr.height / 3, behavior: "smooth" });
      }
      return;
    }
    var v = viewOfRange(r);
    if (v >= 0 && v !== view) goTo(v);
  }

  function showBlock(el) {
    if (scrollMode) { el.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    var v = viewOf(el);
    if (v !== view) goTo(v);
  }

  function clearMarks() {
    pagesEl.querySelectorAll(".speaking").forEach(function (el) { el.classList.remove("speaking"); });
    if (canHighlight) { hlSentence.clear(); hlWord.clear(); }
  }

  // Resalta la oración que empieza a leer
  function markUnit(el, info, unit) {
    clearMarks();
    if (!info.map) { el.classList.add("speaking"); showBlock(el); return; }
    if (canHighlight) hlSentence.add(rangeFor(info.map, unit.sFrom, unit.sTo));
    else el.classList.add("speaking");
    showRange(rangeFor(info.map, unit.from, unit.to));
  }

  // Resalta la palabra que está diciendo (solo si la voz avisa en qué palabra va)
  function markWord(info, unit, charIndex, charLength) {
    var from = unit.from + charIndex;
    var len = charLength || ((/^\S+/.exec(info.map.text.slice(from, unit.to)) || [""])[0].length);
    var to = Math.min(from + len, unit.to);
    if (to <= from) return;
    var r = rangeFor(info.map, from, to);
    if (canHighlight) { hlWord.clear(); hlWord.add(r); }
    showRange(r); // la página cambia justo en la palabra que pasa a la otra hoja
  }

  function speakFrom(bi, ui, mySession) {
    if (mySession !== session) return;
    var list = blocks();
    if (bi >= list.length) { stopListening(); clearMarks(); current = null; return; }
    var el = list[bi];
    var info = unitsOf(el);
    if (ui >= info.list.length) { speakFrom(bi + 1, 0, mySession); return; }
    var unit = info.list[ui];
    current = { block: bi, unit: ui };
    markUnit(el, info, unit);

    var u = new SpeechSynthesisUtterance(unit.text);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = "en-US"; }
    u.rate = 0.92; // un poco más pausado que lo normal
    u.onboundary = function (e) {
      if (mySession !== session || !info.map || (e.name && e.name !== "word")) return;
      markWord(info, unit, e.charIndex, e.charLength);
    };
    u.onend = function () { speakFrom(bi, ui + 1, mySession); };
    u.onerror = function (e) {
      if (e.error === "interrupted" || e.error === "canceled") return;
      speakFrom(bi, ui + 1, mySession);
    };
    synth.speak(u);
  }

  // Desde dónde empezar: lo que se quedó resaltado si sigue a la vista;
  // si no, la primera oración que se ve en esta página.
  function startPoint() {
    var list = blocks();
    if (current && list[current.block]) {
      var info0 = unitsOf(list[current.block]), u0 = info0.list[current.unit];
      if (scrollMode || !u0) return current;
      var v0 = info0.map ? viewOfRange(rangeFor(info0.map, u0.from, u0.to)) : viewOf(list[current.block]);
      if (v0 === view) return current;
    }
    var bi = firstBlockInView();
    var el = list[bi];
    if (!el || scrollMode) return { block: bi, unit: 0 };
    var info = unitsOf(el);
    if (info.map) {
      for (var k = 0; k < info.list.length; k++) {
        if (viewOfRange(rangeFor(info.map, info.list[k].from, info.list[k].to)) >= view) return { block: bi, unit: k };
      }
    }
    return { block: bi, unit: 0 };
  }

  function startListening() {
    if (!voice) pickVoice();
    synth.cancel();
    var from = startPoint();
    playing = true;
    session++;
    paintListenButton();
    speakFrom(from.block, from.unit, session);
  }

  // Pausa: la oración se queda resaltada para saber dónde iba
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

  var savedBlock = isPreview ? 0 : (parseInt(load("bt-pos-" + reading.id, "0"), 10) || 0);
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
} };
