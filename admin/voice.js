/* =========================================================
   admin/voice.js: la voz de Neil (ElevenLabs) desde el panel
   Habla con la "ventanilla" /api/voice (api/voice.js en Vercel), que es la
   única que conoce la llave de ElevenLabs.

   Cómo se arma el audio de un estudio:
     1. SpokenText convierte el estudio en "texto para hablar", párrafo por párrafo
     2. Se parte en pedazos de ~2,000 letras (sin cortar párrafos)
     3. Cada pedazo se pide a la ventanilla, uno tras otro → MP3 + tiempos
     4. Los MP3 se pegan en uno solo y se anota en qué segundo empieza cada
        párrafo (para que el lector cambie de página solo mientras habla)

   Hoy (sin Firebase Storage) el MP3 se queda en la memoria del navegador para
   escucharlo. Cuando haya Storage (plan Blaze), el mismo resultado se sube a
   audio/{id}.mp3 y se guarda en el estudio.

   Gastar créditos: solo al ARMAR el audio. Escucharlo no gasta.
   ========================================================= */
import { auth } from "../assets/firebase.js";

const CHUNK_CHARS = 2000;

// Mensajes para cada código de error de la ventanilla
const MESSAGES = {
  "not-set-up": "Neil’s voice isn’t connected yet (the key is missing in Vercel).",
  "not-allowed": "Your account can’t use Neil’s voice. Try signing out and in again.",
  "no-credits": "There are no voice credits left this month.",
  "key-permissions": "The ElevenLabs key is missing a permission (it needs Text to Speech, and User → Read to see the credits).",
  "bad-key":"ElevenLabs didn’t accept the key. It may have been changed or deleted.",
  "busy": "ElevenLabs is busy right now. Please try again in a minute.",
  "too-long": "One part of the study is too long to read in one go.",
  "offline": "Neil’s voice only works on the website, not on this computer’s test copy.",
  "network": "Couldn’t reach the internet. Check the connection and try again."
};
export function voiceMessage(err) {
  return MESSAGES[err && err.code] || "Something went wrong with Neil’s voice" +
    (err && err.detail ? " (" + err.detail + ")" : "") + ".";
}

// Llama a la ventanilla con el "pase" de la sesión
async function call(payload) {
  if (!auth.currentUser) throw { code: "not-allowed" };
  const token = await auth.currentUser.getIdToken();
  let r;
  try {
    r = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    throw { code: "network" };
  }
  // En la compu (servidor sencillo) /api/voice no existe: responde 404 o una página HTML
  const type = r.headers.get("content-type") || "";
  if (r.status === 404 || r.status === 405 || !type.includes("json")) throw { code: "offline" };
  const data = await r.json();
  if (!r.ok) throw { code: data.error, detail: data.detail };
  return data;
}

// ¿Cuántos créditos quedan? → { used, limit, left, resetsAt }
// (Se guarda un minuto para no preguntar cada vez que se abre un estudio.)
let creditsCache = null;
export async function getCredits(fresh) {
  if (!fresh && creditsCache && Date.now() - creditsCache.at < 60000) return creditsCache.data;
  const d = await call({ action: "credits" });
  const data = { used: d.used, limit: d.limit, left: Math.max(0, d.limit - d.used), resetsAt: d.resetsAt };
  creditsCache = { at: Date.now(), data };
  return data;
}

// El guion del estudio y lo que costaría (1 crédito ≈ 1 letra en el modelo normal)
export function plan(reading) {
  const script = window.SpokenText.script(reading);
  const parts = window.SpokenText.chunks(script, CHUNK_CHARS);
  return {
    script,
    parts,
    cost: parts.reduce((n, p) => n + p.text.length, 0),
    fingerprint: window.SpokenText.fingerprint(script.blocks.join("\n")),
    words: window.SpokenText.countWords(reading.bodyHtml)
  };
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Cuánto dura un pedazo de MP3, en segundos (lo mide el navegador)
let audioCtx = null;
async function durationOf(bytes, fallback) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const buf = await audioCtx.decodeAudioData(bytes.slice().buffer);
    return buf.duration;
  } catch (e) {
    return fallback;
  }
}

// Arma el audio completo de un estudio.
// onProgress(hechos, total) se llama después de cada pedazo.
// Regresa { blob, duration, blockTimes, fingerprint, chars }
//   blockTimes[n] = segundo en que empieza el párrafo n (0 = portada) o null si no se lee
export async function makeAudio(reading, onProgress) {
  const p = plan(reading);
  if (!p.parts.length) throw { code: "empty" };

  const pieces = [];
  const blockTimes = p.script.blocks.map(() => null);
  let offset = 0;

  for (let i = 0; i < p.parts.length; i++) {
    const part = p.parts[i];
    const out = await call({
      action: "speak",
      text: part.text,
      previousText: i > 0 ? p.parts[i - 1].text : "",
      nextText: i < p.parts.length - 1 ? p.parts[i + 1].text : ""
    });
    const bytes = base64ToBytes(out.audio);
    const starts = out.alignment.starts || [];
    const ends = out.alignment.ends || [];
    const lastEnd = ends.length ? ends[ends.length - 1] : 0;
    const duration = await durationOf(bytes, lastEnd);

    part.starts.forEach((s) => {
      // Si los tiempos no traen esa letra, se calcula por proporción
      const t = starts[s.at] != null ? starts[s.at] : (s.at / part.text.length) * duration;
      blockTimes[s.block] = Math.round((offset + t) * 100) / 100;
    });

    pieces.push(bytes);
    offset += duration;
    if (onProgress) onProgress(i + 1, p.parts.length);
  }

  // Los MP3 se pueden pegar uno tras otro y siguen siendo un MP3 válido
  return {
    blob: new Blob(pieces, { type: "audio/mpeg" }),
    duration: Math.round(offset * 10) / 10,
    blockTimes,
    fingerprint: p.fingerprint,
    chars: p.cost
  };
}
