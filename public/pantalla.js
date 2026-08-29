const socket = io();

const connectionText = document.getElementById("connectionText");
const clock = document.getElementById("clock");

const playerName = document.getElementById("playerName");
const playerTable = document.getElementById("playerTable");
const songTitle = document.getElementById("songTitle");
const songArtist = document.getElementById("songArtist");
const discImage = document.getElementById("discImage");
const discCenter = document.querySelector(".disc-center");

const queueCount = document.getElementById("queueCount");
const queueList = document.getElementById("queueList");
const tickerText = document.getElementById("tickerText");

let playback = {
  isPlaying: false,
  requestId: null,
  table: null,
  name: null,
  artist: null,
  song: null,
  photoUrl: null,
  requestedAt: null,
  startedAt: null,
  updatedAt: null,
};

let requests = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };

    return entities[char];
  });
}

function updateClock() {
  const now = new Date();

  if (clock) {
    clock.textContent = now.toLocaleTimeString("es-CL", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
}

function setConnectionState(state) {
  const status = document.querySelector(".tv-status");

  status?.classList.remove("online", "offline");

  if (state === "online") {
    status?.classList.add("online");

    if (connectionText) {
      connectionText.textContent = "En vivo";
    }

    return;
  }

  if (state === "offline") {
    status?.classList.add("offline");

    if (connectionText) {
      connectionText.textContent = "Desconectado";
    }

    return;
  }

  if (connectionText) {
    connectionText.textContent = "Conectando...";
  }
}

function normalizePlayback(value) {
  return {
    isPlaying: !!value?.isPlaying,
    requestId:
      value?.requestId !== null &&
      value?.requestId !== undefined
        ? Number(value.requestId)
        : null,
    table: value?.table ?? null,
    name: value?.name ?? null,
    artist: value?.artist ?? null,
    song: value?.song ?? null,
    photoUrl: value?.photoUrl ?? null,
    requestedAt: value?.requestedAt ?? null,
    startedAt: value?.startedAt ?? null,
    updatedAt: value?.updatedAt ?? null,
  };
}

function renderPlayback() {
  const isPlaying =
    playback.isPlaying &&
    playback.song;

  document.body.classList.toggle(
    "playing",
    !!isPlaying
  );

  const defaultDiscImage =
    discImage?.dataset?.defaultSrc ||
    "/img/logo-local.png";

  const activePhoto =
    isPlaying && playback.photoUrl
      ? `${playback.photoUrl}?v=${encodeURIComponent(playback.updatedAt || Date.now())}`
      : null;

  if (discImage) {
    discImage.src = activePhoto || defaultDiscImage;
    discImage.alt = activePhoto
      ? `Foto de ${playback.name || "cantante"}`
      : "Logo del Local";
  }

  discCenter?.classList.toggle(
    "has-photo",
    !!activePhoto
  );

  if (!isPlaying) {
    if (playerName) {
      playerName.textContent =
        "Esperando cantante...";
    }

    if (playerTable) {
      playerTable.textContent =
        "Mesa —";
    }

    if (songTitle) {
      songTitle.textContent =
        "Sin reproducción";
    }

    if (songArtist) {
      songArtist.textContent =
        "Esperando al DJ...";
    }

    if (tickerText) {
      tickerText.textContent =
        "Bienvenidos a ONIX Karaoke";
    }

    return;
  }

  if (playerName) {
    playerName.textContent =
      playback.name || "Cantante";
  }

  if (playerTable) {
    playerTable.textContent =
      playback.table
        ? `Mesa ${playback.table}`
        : "Mesa —";
  }

  if (songTitle) {
    songTitle.textContent =
      playback.song || "Sin título";
  }

  if (songArtist) {
    songArtist.textContent =
      playback.artist || "Artista";
  }

  if (tickerText) {
    const tableLabel =
      playback.table
        ? `MESA ${playback.table}`
        : "MESA —";

    tickerText.textContent =
      `AHORA SONANDO · ${playback.song || "SIN TÍTULO"} · ` +
      `${playback.artist || "ARTISTA"} · ` +
      `${playback.name || "CANTANTE"} · ` +
      tableLabel;
  }
}

function getVisibleQueue() {
  const currentId =
    Number(playback.requestId);

  return requests.filter((item) => {
    if (!playback.isPlaying) {
      return true;
    }

    return Number(item.id) !== currentId;
  });
}

function renderQueue() {
  const queue =
    getVisibleQueue();

  if (queueCount) {
    queueCount.textContent =
      String(queue.length);
  }

  if (!queueList) {
    return;
  }

  if (!queue.length) {
    queueList.innerHTML = `
      <div class="queue-empty">
        No hay solicitudes pendientes
      </div>
    `;

    return;
  }

  const maxVisible =
    window.innerHeight <= 650
      ? 6
      : 8;

  const visible =
    queue.slice(0, maxVisible);

  queueList.innerHTML =
    visible
      .map((item, index) => {
        const table =
          item.table ?? "—";

        const name =
          item.name || "Sin nombre";

        const song =
          item.song || "Sin canción";

        const artist =
          item.artist || "";

        const songLine =
          artist
            ? `${song} · ${artist}`
            : song;

        return `
          <div class="queue-item">
            <div class="queue-position">
              ${index + 1}
            </div>

            <div class="queue-main">
              <div class="queue-name">
                ${escapeHtml(name)}
              </div>

              <div class="queue-song">
                ${escapeHtml(songLine)}
              </div>
            </div>

            <div class="queue-table">
              Mesa ${escapeHtml(table)}
            </div>
          </div>
        `;
      })
      .join("");

  if (queue.length > maxVisible) {
    queueList.insertAdjacentHTML(
      "beforeend",
      `
        <div class="queue-item queue-more">
          <div class="queue-position">+</div>

          <div class="queue-main">
            <div class="queue-name">
              ${queue.length - maxVisible} turnos más
            </div>

            <div class="queue-song">
              La lista continúa
            </div>
          </div>

          <div class="queue-table">
            En espera
          </div>
        </div>
      `
    );
  }
}

function renderAll() {
  renderPlayback();
  renderQueue();
}

async function loadInitialState() {
  try {
    const response =
      await fetch("/api/screen", {
        cache: "no-store",
      });

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
          "No se pudo cargar la pantalla"
      );
    }

    playback =
      normalizePlayback(
        data.playback
      );

    requests =
      Array.isArray(data.queue)
        ? data.queue
        : [];

    renderAll();
  } catch (error) {
    console.error(
      "Error cargando pantalla:",
      error
    );

    if (tickerText) {
      tickerText.textContent =
        "Intentando reconectar con el servidor...";
    }
  }
}

socket.on("connect", () => {
  setConnectionState("online");
});

socket.on("disconnect", () => {
  setConnectionState("offline");
});

socket.on("connect_error", () => {
  setConnectionState("offline");
});

socket.on(
  "playback:update",
  (status) => {
    playback =
      normalizePlayback(status);

    renderAll();
  }
);

socket.on(
  "requests:update",
  (rows) => {
    requests =
      Array.isArray(rows)
        ? rows
        : [];

    renderQueue();
  }
);

// El DJ puede cambiar manualmente el orden arrastrando canciones.
// Este evento fuerza la actualización inmediata de PRÓXIMOS TURNOS.
socket.on(
  "queue:order",
  (rows) => {
    requests =
      Array.isArray(rows)
        ? rows
        : [];

    renderQueue();
  }
);

window.addEventListener(
  "resize",
  () => {
    renderQueue();
  }
);

window.addEventListener(
  "focus",
  () => {
    loadInitialState();
  }
);

document.addEventListener(
  "visibilitychange",
  () => {
    if (
      document.visibilityState ===
      "visible"
    ) {
      loadInitialState();
    }
  }
);

setConnectionState("connecting");
updateClock();

setInterval(
  updateClock,
  1000
);

loadInitialState();