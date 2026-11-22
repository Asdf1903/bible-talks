/* =========================================================
   qr.js: el botón de QR (el reemplazo de los panfletos)
   Lo usan la portada/secciones (index.html) y cada estudio (reading.html).

   Neil toca el botón → la pantalla muestra un código QR grande de la página
   que está viendo (la portada, una sección o un estudio). La otra persona
   abre la cámara de su celular, apunta, y le sale el enlace. Sin pedir números.

   - El dibujo lo hace la librería "qrcode-generator" (se carga por CDN en el
     HTML, ANTES de este archivo, al abrir la página). Como el QR se dibuja en el
     mismo teléfono, funciona aunque se vaya la señal con la página ya abierta.
   - El cuadro del código siempre es blanco con negro (aun en modo nocturno):
     así lo leen bien todas las cámaras.
   - Mientras el QR está abierto, se le pide al teléfono que no apague la
     pantalla (si el navegador lo permite).
   Cualquier botón con  data-qr  en la página queda listo solo (aunque aparezca después).
   ========================================================= */
(function () {
  "use strict";

  var dialog = null;
  var wakeLock = null;

  // La dirección de lo que se está viendo (sin un "#" suelto al final)
  function pageUrl() {
    return location.href.replace(/#$/, "");
  }

  // Lo que se muestra debajo del código: "bible-talks.com" (sin https:// ni www.)
  function shortUrl(url) {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  }

  // El título de la página sin "Bible Talks" (ya va arriba en grande):
  //   "God's Heart · Bible Talks" → "God's Heart"
  //   "Bible Talks · Studies by Neil Whatmough" (portada) → "Studies by Neil Whatmough"
  function pageTitle() {
    return document.title
      .replace(/\s*·\s*Bible Talks\s*$/, "")
      .replace(/^Bible Talks\s*·\s*/, "")
      .replace(/^Bible Talks$/, "")
      .trim();
  }

  // Se arma la ventana una sola vez, la primera vez que se pide
  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "qr-sheet";
    dialog.setAttribute("aria-labelledby", "qrHeading");
    dialog.innerHTML =
      '<p class="qr-brand" id="qrHeading">Bible Talks</p>' +
      '<p class="qr-title" id="qrTitle"></p>' +
      '<div class="qr-code" id="qrCode" role="img" aria-label="QR code with the link to this page"></div>' +
      '<p class="qr-hint">Open your phone\'s camera and point it at the code.</p>' +
      '<p class="qr-url" id="qrUrl"></p>' +
      '<button class="qr-close" type="button">Close</button>';

    dialog.querySelector(".qr-close").addEventListener("click", function () { dialog.close(); });
    // Tocar fuera del cuadro también cierra
    dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });
    // Al cerrar (botón, fuera o tecla Esc): soltar el "no apagues la pantalla"
    dialog.addEventListener("close", function () {
      if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
    });
    document.body.appendChild(dialog);
  }

  function open() {
    if (typeof qrcode !== "function") {
      // La librería no cargó (sin internet al abrir la página)
      window.alert("The QR code could not load. Please check the internet connection and try again.");
      return;
    }
    if (!dialog) build();

    var url = pageUrl();
    var qr = qrcode(0, "M");   // 0 = tamaño automático; "M" = aguanta algo de reflejo o suciedad
    qr.addData(url);
    qr.make();
    dialog.querySelector("#qrCode").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });

    var title = pageTitle();
    var titleEl = dialog.querySelector("#qrTitle");
    titleEl.textContent = title;
    titleEl.hidden = !title;
    dialog.querySelector("#qrUrl").textContent = shortUrl(url);

    dialog.showModal();

    // Que la pantalla no se apague mientras la otra persona saca su cámara
    if (navigator.wakeLock) {
      navigator.wakeLock.request("screen").then(function (lock) { wakeLock = lock; }).catch(function () {});
    }
  }

  // Un solo "escucha" para toda la página (sirve también para botones que aparecen después)
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("[data-qr]")) open();
  });
})();
