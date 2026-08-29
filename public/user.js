// public/user.js

const form = document.getElementById("requestForm");
const toast = document.getElementById("toast");

const tableInput = document.getElementById("table");
const nameInput = document.getElementById("name");
const artistInput = document.getElementById("artist");
const songInput = document.getElementById("song");
const photoInput = document.getElementById("photo");
const photoPreviewWrap = document.getElementById("photoPreviewWrap");
const photoPreview = document.getElementById("photoPreview");
const removePhotoBtn = document.getElementById("removePhotoBtn");

const MESA_MAX = 50;
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const COOLDOWN_MS = 10000;
let lastSentAt = 0;
let cooldownTimer = null;
let selectedPhotoDataUrl = null;

function showToast(msg) {
  if (toast) toast.textContent = msg;
}

function clearSelectedPhoto() {
  selectedPhotoDataUrl = null;

  if (photoInput) {
    photoInput.value = "";
  }

  if (photoPreview) {
    photoPreview.removeAttribute("src");
  }

  if (photoPreviewWrap) {
    photoPreviewWrap.hidden = true;
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer la foto."));
    reader.readAsDataURL(file);
  });
}

photoInput?.addEventListener("change", async () => {
  showToast("");

  const file = photoInput.files?.[0];

  if (!file) {
    clearSelectedPhoto();
    return;
  }

  if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
    clearSelectedPhoto();
    showToast("📷 La foto debe ser JPG, PNG o WEBP.");
    return;
  }

  if (file.size > MAX_PHOTO_BYTES) {
    clearSelectedPhoto();
    showToast("📷 La foto no puede superar 20 MB.");
    return;
  }

  try {
    selectedPhotoDataUrl = await readFileAsDataUrl(file);

    if (photoPreview) {
      photoPreview.src = selectedPhotoDataUrl;
    }

    if (photoPreviewWrap) {
      photoPreviewWrap.hidden = false;
    }
  } catch (error) {
    clearSelectedPhoto();
    showToast(error?.message || "No se pudo cargar la foto.");
  }
});

removePhotoBtn?.addEventListener("click", () => {
  clearSelectedPhoto();
  showToast("Foto quitada.");
});

tableInput.addEventListener("input", () => {
  let raw = tableInput.value.replace(/[^\d]/g, "");
  raw = raw.slice(0, 2);

  if (raw === "") {
    tableInput.value = "";
    return;
  }

  let n = parseInt(raw, 10);

  if (Number.isNaN(n)) {
    tableInput.value = "";
    return;
  }

  if (n < 1) n = 1;
  if (n > MESA_MAX) n = MESA_MAX;

  tableInput.value = String(n);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showToast("");

  const now = Date.now();
  const diff = now - lastSentAt;

  if (diff < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - diff) / 1000);
    return showToast(`⏳ Espera ${wait}s antes de enviar otra solicitud.`);
  }

  const table = tableInput.value.trim();
  const name = nameInput.value.trim();
  const artist = artistInput.value.trim();
  const song = songInput.value.trim();

  if (!/^\d{1,2}$/.test(table)) {
    return showToast("Mesa inválida (solo números).");
  }

  const t = Number(table);

  if (t < 1 || t > MESA_MAX) {
    return showToast(`Mesa inválida (1 a ${MESA_MAX}).`);
  }

  if (name.length < 1 || name.length > 40) {
    return showToast("Nombre inválido (1 a 40).");
  }

  if (artist.length < 1 || artist.length > 40) {
    return showToast("Artista inválido (1 a 40).");
  }

  if (song.length < 1 || song.length > 40) {
    return showToast("Canción inválida (1 a 40).");
  }

  const btn = form.querySelector("button[type='submit']");
  const originalText = btn?.textContent || "Enviar solicitud";

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Enviando...";
  }

  if (cooldownTimer) {
    clearInterval(cooldownTimer);
    cooldownTimer = null;
  }

  try {
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        table: String(t),
        name,
        artist,
        song,
        photo: selectedPhotoDataUrl,
      }),
    });

    let data = null;
    const ct = res.headers.get("content-type") || "";

    if (ct.includes("application/json")) {
      data = await res.json();
    } else {
      data = { ok: res.ok };
    }

    if (res.status === 429) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }

      return showToast(
        data?.error || "⏳ Debes esperar antes de enviar otra."
      );
    }

    if (res.status === 403) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }

      if (data?.reason === "admin") {
        return showToast("⛔ Lo sentimos, pedidos no disponibles.");
      }

      return showToast(
        data?.error || "Las solicitudes no están disponibles en este horario."
      );
    }

    if (!res.ok || !data?.ok) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }

      return showToast(
        data?.error || "No se pudo enviar. Intenta nuevamente."
      );
    }

    lastSentAt = Date.now();

    form.reset();
    clearSelectedPhoto();
    showToast("✅ Solicitud enviada. ¡Gracias!");

    let remaining = Math.ceil(COOLDOWN_MS / 1000);

    cooldownTimer = setInterval(() => {
      remaining--;

      if (!btn) return;

      if (remaining <= 0) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
        btn.disabled = false;
        btn.textContent = originalText;
      } else {
        btn.textContent = `Espera ${remaining}s…`;
      }
    }, 1000);
  } catch {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }

    showToast("No se pudo enviar. Intenta nuevamente.");
  }
});
