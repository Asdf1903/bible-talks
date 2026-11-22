/* =========================================================
   spoken-text.js
   Convierte un estudio en "texto para hablar": lo que se le manda a la voz
   de Neil (ElevenLabs) o a la voz del navegador.

   Por qué hace falta: lo que se LEE con los ojos no siempre se puede DECIR.
     "ROMANS 3v23"       → "Romans chapter 3, verse 23"
     "Luke 4 v 16-25"    → "Luke chapter 4, verses 16 to 25"
     "1st JOHN 1v10"     → "First John chapter 1, verse 10"
     "John 3:16"         → "John chapter 3, verse 16"
     "πνεύμα"            → "pneuma"
     * ** † (notas)      → se quitan
     "&"                 → "and"
     direcciones web     → se quitan

   Lo usan:
     - reader.js (la página de lectura): qué párrafos se leen y en qué orden
     - admin.js (el panel): arma el texto que se manda a ElevenLabs

   Uso:
     SpokenText.BLOCKS                 → qué elementos cuentan como párrafo
     SpokenText.titleText(reading)     → lo que se dice en la portada
     SpokenText.clean("ROMANS 3v23")   → "Romans chapter 3, verse 23"
     SpokenText.script(reading)        → { blocks: [texto, ...], chars }
     SpokenText.chunks(script, max)    → pedazos para mandar uno por uno
     SpokenText.fingerprint(texto)     → "huella" corta (para saber si cambió)
     SpokenText.countWords(html)       → número de palabras
   ========================================================= */
(function (root) {
  "use strict";

  // Los párrafos que se leen en voz alta, en el orden en que aparecen.
  // El lector y el panel usan ESTA misma lista: así el audio y el texto
  // siempre hablan del mismo "párrafo número 5".
  var BLOCKS = ".body > p, .body > blockquote, .body > h2, .body > h3, .body > ul > li, .body > ol > li";

  // Libros de la Biblia (y cómo se dicen). La clave va en minúsculas y sin espacios.
  var BOOKS = {};
  ("Genesis Exodus Leviticus Numbers Deuteronomy Joshua Judges Ruth Samuel Kings Chronicles Ezra " +
   "Nehemiah Esther Job Psalms Psalm Proverbs Ecclesiastes Isaiah Jeremiah Lamentations Ezekiel " +
   "Daniel Hosea Joel Amos Obadiah Jonah Micah Nahum Habakkuk Zephaniah Haggai Zechariah Malachi " +
   "Matthew Mark Luke John Acts Romans Corinthians Galatians Ephesians Philippians Colossians " +
   "Thessalonians Timothy Titus Philemon Hebrews James Peter Jude Revelation Revelations")
    .split(" ").forEach(function (b) { BOOKS[b.toLowerCase()] = b; });
  // Abreviaturas comunes
  var ABBR = { gen: "Genesis", ex: "Exodus", exod: "Exodus", lev: "Leviticus", num: "Numbers",
    deut: "Deuteronomy", josh: "Joshua", judg: "Judges", sam: "Samuel", kgs: "Kings",
    chron: "Chronicles", neh: "Nehemiah", esth: "Esther", ps: "Psalm", psa: "Psalm",
    prov: "Proverbs", eccl: "Ecclesiastes", eccles: "Ecclesiastes", song: "Song of Solomon",
    isa: "Isaiah", jer: "Jeremiah", lam: "Lamentations", ezek: "Ezekiel", dan: "Daniel",
    hos: "Hosea", obad: "Obadiah", mic: "Micah", nah: "Nahum", hab: "Habakkuk",
    zeph: "Zephaniah", hag: "Haggai", zech: "Zechariah", mal: "Malachi", matt: "Matthew",
    mt: "Matthew", mk: "Mark", lk: "Luke", jn: "John", rom: "Romans", cor: "Corinthians",
    gal: "Galatians", eph: "Ephesians", phil: "Philippians", col: "Colossians",
    thess: "Thessalonians", tim: "Timothy", tit: "Titus", philem: "Philemon", heb: "Hebrews",
    jas: "James", pet: "Peter", rev: "Revelation" };

  var ORDINAL = { "1": "First", "1st": "First", "i": "First", "2": "Second", "2nd": "Second",
                  "ii": "Second", "3": "Third", "3rd": "Third", "iii": "Third" };

  function bookName(word) {
    var k = word.toLowerCase().replace(/\.$/, "");
    return BOOKS[k] || ABBR[k] || "";
  }

  // "16-25" → "verses 16 to 25" · "16" → "verse 16" · "16,18" → "verses 16 and 18"
  function versesSaid(v) {
    v = v.replace(/\s+/g, "");
    var range = v.split(/[-–—]/);
    if (range.length === 2 && range[1]) return "verses " + range[0] + " to " + range[1];
    var list = v.split(",").filter(Boolean);
    if (list.length > 1) return "verses " + list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
    return "verse " + v.replace(/[-–—]$/, "");
  }

  // Citas bíblicas. Formatos que usa Neil:
  //   ROMANS 3v23 · Luke 4 v 16-25 · 1st JOHN 1v10 · John 3:16 · Rom. 5:8 · 2 Cor 5:17-21
  var REF = new RegExp(
    "(?:\\b(1st|2nd|3rd|1|2|3|iii|ii|i)\\s?)?" +        // número del libro (opcional)
    "\\b(Song of Solomon|[A-Za-z]{2,14}\\.?)\\s?" +      // el libro
    "(\\d{1,3})\\s?(?:v|vv|:)\\s?" +                     // capítulo + "v" o ":"
    "(\\d{1,3}(?:\\s?[-–—]\\s?\\d{1,3}|\\s?,\\s?\\d{1,3}(?![\\d:v]))*)" + // versículo(s)
    "(?![\\d:])", "gi");

  function refs(text) {
    return text.replace(REF, function (all, num, book, chapter, verses, offset, whole) {
      var name = /^song of solomon$/i.test(book) ? "Song of Solomon" : bookName(book);
      if (!name) return all; // no es un libro: no se toca (ej. una hora "at 10:30")
      var ord = num ? ORDINAL[num.toLowerCase()] : "";
      // "I" suelto solo cuenta si está pegado a un libro que lleva número
      if (num && !ord) return all;
      var said = (ord ? ord + " " : "") + name + " chapter " + chapter + ", " + versesSaid(verses);
      // Neil pone la cita y sigue con otra oración sin punto ("…death.” ROMANS 3v23 Jesus paid").
      // Si lo que sigue empieza con mayúscula o comillas, se agrega un punto para que la voz haga pausa.
      var next = whole.slice(offset + all.length).match(/^\s*(\S)/);
      if (next && /[A-Z“"‘]/.test(next[1])) said += ".";
      return said;
    })
    // Sin libro: "chapter 4 v 16" no es común, pero "v16" o "vv. 16-18" sí
    .replace(/\bvv\.?\s?(\d{1,3}(?:\s?[-–—]\s?\d{1,3})?)/gi, function (a, v) {
      return "verses " + v.replace(/\s?[-–—]\s?/, " to ");
    })
    .replace(/\bv\.?\s?(\d{1,3}(?:\s?[-–—]\s?\d{1,3})?)\b/g, function (a, v) { return versesSaid(v); });
  }

  // Griego → letras latinas, como se pronuncia en inglés ("πνεύμα" → "pneuma")
  var GREEK = { "α": "a", "β": "b", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "e", "θ": "th",
    "ι": "i", "κ": "k", "λ": "l", "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "π": "p", "ρ": "r",
    "σ": "s", "ς": "s", "τ": "t", "υ": "u", "φ": "ph", "χ": "ch", "ψ": "ps", "ω": "o" };
  function greek(text) {
    return text.replace(/[Ͱ-Ͽἀ-῿]+/g, function (word) {
      var plain = word.normalize("NFD").replace(/[̀-ͯ̓̔͂ͅ]/g, "").toLowerCase();
      return plain.replace(/γγ/g, "ng").replace(/γκ/g, "nk").replace(/ου/g, "ou")
        .replace(/[α-ως]/g, function (c) { return GREEK[c] || ""; });
    });
  }

  // Limpia un pedazo de texto ya sin HTML
  function clean(text) {
    var t = String(text || "").replace(/ /g, " ");
    t = t.replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, "");     // direcciones web
    t = t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "");        // correos
    t = refs(t);
    t = greek(t);
    t = t.replace(/[*†‡§¶]+/g, "");                          // marcas de notas
    t = t.replace(/\s&\s/g, " and ");
    t = t.replace(/^\s*[-–•·]\s+/, "");                      // guion de lista al inicio
    t = t.replace(/\(\s*\)/g, "");                           // paréntesis que quedaron vacíos
    t = t.replace(/\s+([,.;:!?])/g, "$1");
    return t.replace(/\s+/g, " ").trim();
  }

  // El texto de un elemento, cuidando los superíndices:
  //   1<sup>st</sup> → "1st" · C<sup>14</sup> → "C-14" · palabra<sup>3</sup> (nota) → se quita
  function textOf(el) {
    var out = "";
    (function walk(node) {
      for (var n = node.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) { out += n.nodeValue; continue; }
        if (n.nodeType !== 1) continue;
        var tag = n.tagName.toLowerCase();
        if (tag === "sup") {
          var s = n.textContent.trim();
          if (/^(st|nd|rd|th)$/i.test(s)) out += s;
          else if (/^\d+$/.test(s) && /[A-Z]$/.test(out)) out += "-" + s;
          continue; // cualquier otra cosa en superíndice es una nota: no se lee
        }
        if (tag === "br") { out += " "; continue; }
        if (tag === "img" || tag === "figure") continue;
        walk(n);
      }
    })(el);
    return out;
  }

  // Lo que se dice en la portada del estudio (título y subtítulo)
  function titleText(reading) {
    return reading.title + ". " + (reading.subtitle ? reading.subtitle.replace(/·/g, ",") + ". " : "");
  }

  // El estudio entero, párrafo por párrafo, listo para decirse.
  // blocks[0] es la portada; blocks[1..] son los párrafos del cuerpo, en el mismo
  // orden en que el lector los marca. Un párrafo sin nada que decir queda como "".
  function script(reading, domParser) {
    var parser = domParser || new root.DOMParser();
    var doc = parser.parseFromString('<div class="body">' + (reading.bodyHtml || "") + "</div>", "text/html");
    var list = [clean(titleText(reading))];
    Array.prototype.forEach.call(doc.querySelectorAll(BLOCKS), function (el) {
      list.push(clean(textOf(el)));
    });
    var chars = list.reduce(function (n, b) { return n + b.length; }, 0);
    return { blocks: list, chars: chars };
  }

  // Parte el guion en pedazos de máximo `max` letras, sin cortar párrafos
  // (un párrafo enorme sí se parte, en un fin de oración).
  // Cada pedazo: { text, starts: [{ block, at }] } → "el párrafo N empieza en la letra X"
  function chunks(scr, max) {
    max = max || 2000;
    var out = [], cur = null;
    function open() { cur = { text: "", starts: [] }; out.push(cur); }
    scr.blocks.forEach(function (b, i) {
      if (!b) return;
      var pieces = [b];
      if (b.length > max) {
        pieces = [];
        var rest = b;
        while (rest.length > max) {
          var cut = rest.lastIndexOf(". ", max);
          if (cut < max / 3) cut = rest.lastIndexOf(" ", max);
          pieces.push(rest.slice(0, cut + 1).trim());
          rest = rest.slice(cut + 1).trim();
        }
        if (rest) pieces.push(rest);
      }
      pieces.forEach(function (p, k) {
        var sep = "\n\n";
        if (!cur || cur.text.length + sep.length + p.length > max) open();
        if (cur.text) cur.text += sep;
        if (k === 0) cur.starts.push({ block: i, at: cur.text.length });
        cur.text += p;
      });
    });
    return out;
  }

  // Huella corta de un texto (si el estudio cambia, la huella cambia)
  function fingerprint(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(36) + "-" + text.length.toString(36);
  }

  function countWords(html) {
    var t = String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").trim();
    return t ? t.split(/\s+/).length : 0;
  }

  var api = { BLOCKS: BLOCKS, clean: clean, titleText: titleText, script: script, chunks: chunks,
              fingerprint: fingerprint, countWords: countWords };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SpokenText = api;
})(typeof window !== "undefined" ? window : globalThis);
