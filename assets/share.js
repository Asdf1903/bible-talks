/* =========================================================
   share.js: el botón de compartir (cuadrito con flecha hacia arriba)
   Lo usan la portada/secciones (index.html) y cada estudio (reading.html).
   - En celular abre el menú de compartir del teléfono (WhatsApp, Instagram,
     mensajes…), con la dirección de la página que se está viendo.
   - Donde no existe ese menú (casi todas las computadoras), copia el enlace
     y avisa "Link copied".
   Cualquier botón con  data-share  en la página queda listo solo (aunque aparezca después).
   ========================================================= */
(function () {
  "use strict";

  var toastTimer = null;
  function notice(text) {
    var t = document.getElementById("shareToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "shareToast";
      t.className = "share-toast";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("on"); }, 3500);
  }

  async function share() {
    // En la portada sin sección, compartir la dirección limpia (sin "#")
    var url = location.href.replace(/#$/, "");
    var data = { title: document.title, text: "A Bible study on Bible Talks", url: url };
    if (navigator.share) {
      try { await navigator.share(data); } catch (e) { /* la persona cerró el menú: no pasa nada */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      notice("Link copied. You can paste it in a message.");
    } catch (e) {
      window.prompt("Copy this link:", url);
    }
  }

  // Un solo "escucha" para toda la página: también sirve para botones que aparecen
  // después (como "Share this study" al final de cada estudio)
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("[data-share]")) share();
  });
})();
