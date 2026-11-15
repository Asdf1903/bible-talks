/* =========================================================
   word-to-reading.js
   Convierte un Word (.docx) de Neil en una lectura lista para el sitio.

   Usa mammoth.js (se carga aparte, por CDN) y luego "limpia" el resultado:
     1. Saca el título y el subtítulo (para ponerlos en sus casillas)
     2. Quita párrafos vacíos
     3. Quita su correo del final (el sitio ya pone el pie de autor)
     4. Revisa los enlaces (solo http, https y mailto; abren en otra pestaña)
     5. Si las imágenes pesan demasiado, las quita y avisa
     6. Cuenta las palabras

   Uso:  WordToReading.convert(arrayBuffer).then(function (r) { ... })
   r = { title, subtitle, bodyHtml, words, warnings: [] }
   ========================================================= */
(function (root) {
  "use strict";

  // Cómo traducir los estilos de Word a HTML.
  // Lo que no está aquí, mammoth lo convierte a su manera (negrita, cursiva,
  // superíndice y enlaces ya los conserva solo).
  var STYLE_MAP = [
    "p[style-name='Title'] => h1.doc-title:fresh",
    "p[style-name='Subtitle'] => p.doc-subtitle:fresh",
    "p[style-name='Heading 1'] => h2:fresh",
    "p[style-name='Heading 2'] => h3:fresh",
    "p[style-name='Heading 3'] => h3:fresh",
    "u => u",                    // subrayado
    "strike => s",               // tachado
    "small-caps => span.sc"      // versalitas: "JOHN 1v14"
  ];

  // Límite de Firestore: 1 MB por lectura. Dejamos espacio para lo demás.
  var MAX_HTML_BYTES = 700 * 1024;

  var EMAIL_ONLY = /^\s*(e-?mail:?\s*)?[\w.+-]+@[\w-]+(\.[\w-]+)+\s*$/i;

  function text(el) {
    return (el.textContent || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
  }

  function isEmpty(el) {
    return !text(el) && !el.querySelector("img");
  }

  function convert(arrayBuffer, options) {
    options = options || {};
    var mammoth = options.mammoth || root.mammoth;
    var parser = options.domParser || new root.DOMParser();
    var warnings = [];

    // En el navegador mammoth recibe un arrayBuffer; en las pruebas con Node, un Buffer
    var input = options.nodeBuffer ? { buffer: options.nodeBuffer } : { arrayBuffer: arrayBuffer };

    return mammoth.convertToHtml(input, { styleMap: STYLE_MAP })
      .then(function (result) {
        var doc = parser.parseFromString("<body>" + result.value + "</body>", "text/html");
        var body = doc.body;

        // 2. Quitar párrafos vacíos
        Array.prototype.slice.call(body.children).forEach(function (el) {
          if (isEmpty(el)) el.remove();
        });

        // 1. Título y subtítulo
        var title = "", subtitle = "";
        var titleEl = body.querySelector("h1.doc-title") || body.querySelector("h1, h2");
        if (!titleEl) {
          // Sin estilo "Título" en Word: usamos el primer párrafo si es corto
          var first = body.firstElementChild;
          if (first && text(first).length <= 120) titleEl = first;
        }
        if (titleEl) {
          title = text(titleEl);
          var next = titleEl.nextElementSibling;
          titleEl.remove();
          var subEl = body.querySelector("p.doc-subtitle");
          if (!subEl && next && next.tagName === "P" && text(next).length <= 100 &&
              !/[.:;]$/.test(text(next))) {
            // Línea corta justo después del título, que no termina como oración: es subtítulo
            subEl = next;
          }
          if (subEl) { subtitle = text(subEl); subEl.remove(); }
        }

        // 3. Quitar su correo de los últimos párrafos
        var tail = Array.prototype.slice.call(body.children, -3);
        tail.forEach(function (el) {
          if (EMAIL_ONLY.test(text(el))) el.remove();
        });

        // 4. Enlaces seguros
        Array.prototype.slice.call(body.querySelectorAll("a")).forEach(function (a) {
          var href = a.getAttribute("href") || "";
          if (/^(https?:|mailto:)/i.test(href)) {
            if (!/^mailto:/i.test(href)) {
              a.setAttribute("target", "_blank");
              a.setAttribute("rel", "noopener");
            }
          } else if (/^#/.test(href)) {
            // enlaces internos de notas al pie: se quedan
          } else {
            // cualquier otra cosa (javascript:, archivos locales...) se vuelve texto normal
            a.replaceWith.apply(a, Array.prototype.slice.call(a.childNodes));
          }
        });

        var html = body.innerHTML.trim();

        // 5. Imágenes demasiado pesadas
        if (html.length > MAX_HTML_BYTES && body.querySelector("img")) {
          Array.prototype.slice.call(body.querySelectorAll("img")).forEach(function (img) { img.remove(); });
          Array.prototype.slice.call(body.children).forEach(function (el) {
            if (isEmpty(el)) el.remove();
          });
          html = body.innerHTML.trim();
          warnings.push("The pictures in this document were too big, so they were left out.");
        }
        if (html.length > MAX_HTML_BYTES) {
          throw new Error("TOO_BIG");
        }

        // 6. Palabras
        var words = text(body) ? text(body).split(" ").length : 0;
        if (!words) throw new Error("EMPTY");

        return { title: title, subtitle: subtitle, bodyHtml: html, words: words, warnings: warnings,
                 mammothMessages: result.messages };
      });
  }

  var api = { convert: convert, STYLE_MAP: STYLE_MAP };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WordToReading = api;
})(typeof window !== "undefined" ? window : globalThis);
