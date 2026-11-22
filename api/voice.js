/* =========================================================
   api/voice.js: la "ventanilla" de la voz de Neil
   Es una función de Vercel: corre en el servidor de Vercel, no en el navegador.
   Vercel la publica sola con cada push (la dirección es /api/voice).

   Por qué existe: la llave de ElevenLabs NO puede estar en el repo (es público)
   ni en el navegador (cualquiera la vería). Vive en Vercel → Settings →
   Environment Variables, y solo esta función la usa.

   Variables que hay que poner en Vercel (Production y Preview):
     ELEVENLABS_API_KEY   la llave (secreta)
     ELEVENLABS_VOICE_ID  el número de la voz clonada de Neil
     ELEVENLABS_MODEL     (opcional) modelo de voz; si no está: eleven_multilingual_v2

   Quién puede usarla: solo Neil e Isra. El panel manda el "pase" de su sesión
   de Google (token de Firebase). Esta función le pregunta a Firestore, con ESE
   pase, por el documento admins/{uid}. Firestore revisa que el pase sea real
   y sus reglas solo dejan leerlo si eres admin. Así no hace falta otra llave.

   Qué sabe hacer (POST con JSON):
     { action: "speak", text, previousText?, nextText? }
        → { audio: base64 del MP3, alignment: tiempos de cada letra }
     { action: "credits" }
        → { used, limit, resetsAt }
   ========================================================= */

// Los dos proyectos de Firebase (los mismos que assets/firebase-config.js)
const PROJECTS = ["bible-talks-ee75e", "bible-talks-test"];

// Tope por petición: el panel manda pedazos de ~2,000 letras
const MAX_CHARS = 3000;

// MP3 de 64 kbps: suena bien para voz y pesa la mitad (8 minutos ≈ 4 MB)
const OUTPUT_FORMAT = "mp3_44100_64";

// Lee la parte de en medio del pase (sin comprobarlo: eso lo hace Firestore)
function tokenInfo(token) {
  try {
    const part = token.split(".")[1];
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch (e) {
    return null;
  }
}

// ¿Este pase es de un admin? Lo decide Firestore con sus reglas.
async function isAdmin(token) {
  const info = tokenInfo(token);
  if (!info || !info.sub || !PROJECTS.includes(info.aud)) return false;
  const url = "https://firestore.googleapis.com/v1/projects/" + info.aud +
    "/databases/(default)/documents/admins/" + encodeURIComponent(info.sub);
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  return r.ok; // 200 = existe y lo dejaron leer · 401/403/404 = no
}

// Respuesta de error con un código corto que el panel traduce a palabras
function fail(res, status, code, detail) {
  res.status(status).json({ error: code, detail: detail || "" });
}

// Traduce los errores de ElevenLabs a códigos sencillos
async function elevenError(res, r) {
  let body = {};
  try { body = await r.json(); } catch (e) {}
  const d = body.detail || {};
  const status = (d.status || d.code || "").toString();
  if (status.includes("quota")) return fail(res, 402, "no-credits", d.message);
  if (status.includes("permission")) return fail(res, 403, "key-permissions", d.message);
  if (r.status === 401) return fail(res, 502, "bad-key", d.message || "ElevenLabs rejected the key");
  if (r.status === 429) return fail(res, 429, "busy", d.message);
  return fail(res, 502, "eleven-error", (d.message || status || "HTTP " + r.status).toString());
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "method");

  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  const model = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
  if (!key || !voice) return fail(res, 500, "not-set-up", "Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID in Vercel");

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !(await isAdmin(token))) return fail(res, 401, "not-allowed");

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

  // --- ¿Cuántos créditos quedan este mes? ---
  if (body.action === "credits") {
    const r = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": key }
    });
    if (!r.ok) return elevenError(res, r);
    const s = await r.json();
    return res.status(200).json({
      used: s.character_count,
      limit: s.character_limit,
      resetsAt: s.next_character_count_reset_unix ? s.next_character_count_reset_unix * 1000 : null,
      model
    });
  }

  // --- Decir un pedazo de texto con la voz de Neil ---
  if (body.action === "speak") {
    const text = String(body.text || "").trim();
    if (!text) return fail(res, 400, "empty");
    if (text.length > MAX_CHARS) return fail(res, 400, "too-long");

    const r = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(voice) +
        "/with-timestamps?output_format=" + OUTPUT_FORMAT,
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: model,
          // El final del pedazo anterior y el inicio del siguiente: así la entonación
          // no "reinicia" en cada pedazo (no se leen, solo dan contexto)
          previous_text: body.previousText ? String(body.previousText).slice(-500) : undefined,
          next_text: body.nextText ? String(body.nextText).slice(0, 500) : undefined
        })
      }
    );
    if (!r.ok) return elevenError(res, r);
    const out = await r.json();
    const a = out.alignment || {};
    return res.status(200).json({
      audio: out.audio_base64,
      alignment: {
        chars: a.characters || [],
        starts: a.character_start_times_seconds || [],
        ends: a.character_end_times_seconds || []
      }
    });
  }

  return fail(res, 400, "unknown-action");
};
