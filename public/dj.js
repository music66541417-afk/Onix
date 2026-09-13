// public/dj.js

const cards = document.getElementById("cards");
const lastTables = document.getElementById("lastTables");
const emptyMsg = document.getElementById("emptyMsg");
const countBadge = document.getElementById("countBadge");

const refreshBtn = document.getElementById("refreshBtn");
const clearAllBtn = document.getElementById("clearAllBtn");

const ordersBar = document.getElementById("ordersBar");
const ordersStatus = document.getElementById("ordersStatus");
const ordersDot = document.getElementById("ordersDot");
const ordersLabel = document.getElementById("ordersLabel");

const logoutBtn = document.getElementById("logoutBtn");

const socket = io();

let currentRequests = [];
let currentPlayback = {
  isPlaying: false,
  requestId: null,
  table: null,
  name: null,
  artist: null,
  song: null,
  startedAt: null,
};

let prevIds = new Set();
let hasBootstrapped = false;
let lastNewBadgeId = null;

let pendingConfirmId = null;
let confirmTimeout = null;
let playbackBusy = false;
let reorderBusy = false;

let freshQueueDrag = {
  active: false,
  item: null,
  ghost: null,
  offsetY: 0,
  moved: false,
  startY: 0,
};

let pendingRequestsWhileDragging = null;
let pendingPlaybackRender = false;


/* =========================================================
   NOTIFICACIONES DE NUEVOS PEDIDOS - SIN SONIDO
========================================================= */

let notificacionesActivas = false;
let notificationTitleTimeout = null;

function actualizarBotonNotificaciones() {
  const button = document.getElementById("btnNotificacionesDj");

  if (!button || !("Notification" in window)) {
    return;
  }

  if (Notification.permission === "granted") {
    notificacionesActivas = true;
    button.textContent = "🔔 Notificaciones activas";
    button.title = "Las notificaciones están activadas";
  } else if (Notification.permission === "denied") {
    notificacionesActivas = false;
    button.textContent = "🔕 Notificaciones bloqueadas";
    button.title = "Habilítalas desde los permisos del navegador";
  } else {
    notificacionesActivas = false;
    button.textContent = "🔔 Activar notificaciones";
    button.title = "Activar avisos de nuevos pedidos";
  }
}

async function activarNotificaciones() {
  if (!("Notification" in window)) {
    alert("Este navegador no admite notificaciones.");
    return;
  }

  if (Notification.permission === "denied") {
    alert(
      "Las notificaciones están bloqueadas. " +
      "Debes habilitarlas desde los permisos del sitio en Chrome."
    );
    return;
  }

  try {
    const permiso = await Notification.requestPermission();

    actualizarBotonNotificaciones();

    if (permiso === "granted") {
      notificacionesActivas = true;

      new Notification("ONIX Karaoke", {
        body: "Notificaciones activadas correctamente."
      });
    }
  } catch (error) {
    console.error("Error activando notificaciones:", error);
  }
}

function crearBotonNotificaciones() {
  if (!("Notification" in window)) {
    return;
  }

  if (document.getElementById("btnNotificacionesDj")) {
    actualizarBotonNotificaciones();
    return;
  }

  const button = document.createElement("button");

  button.id = "btnNotificacionesDj";
  button.type = "button";

  Object.assign(button.style, {
    position: "fixed",
    right: "22px",
    bottom: "22px",
    zIndex: "99999",
    padding: "10px 14px",
    border: "1px solid rgba(255,255,255,.18)",
    borderRadius: "12px",
    background: "rgba(15,15,18,.96)",
    color: "#fff",
    fontWeight: "700",
    cursor: "pointer",
    boxShadow: "0 8px 24px rgba(0,0,0,.35)"
  });

  button.addEventListener(
    "click",
    activarNotificaciones
  );

  document.body.appendChild(button);

  actualizarBotonNotificaciones();
}

function notificarNuevaSolicitud(request) {
  if (!request) {
    return;
  }

  if (!("Notification" in window)) {
    return;
  }

  if (Notification.permission !== "granted") {
    return;
  }

  notificacionesActivas = true;

  const mesa =
    request.table ?? "";

  const cliente =
    getClientName(request) ||
    "Sin nombre";

  const cancion =
    request.song ||
    "Sin canción";

  const artista =
    request.artist ||
    "Sin artista";

  try {
    const notification =
      new Notification(
        "🎤 Nueva solicitud de karaoke",
        {
          body:
            `Mesa ${mesa}\n` +
            `${cliente}\n` +
            `${cancion} - ${artista}`,
          tag:
            `pedido-${request.id}`
        }
      );

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch (error) {
    console.error(
      "No se pudo mostrar la notificación:",
      error
    );
  }

  const originalTitle =
    document.title;

  document.title =
    `🔴 NUEVO PEDIDO · Mesa ${mesa}`;

  clearTimeout(
    notificationTitleTimeout
  );

  notificationTitleTimeout =
    setTimeout(() => {
      document.title =
        originalTitle;
    }, 10000);
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    crearBotonNotificaciones
  );
} else {
  crearBotonNotificaciones();
}

/* =========================================================
   BOTONES SUPERIORES
========================================================= */

refreshBtn?.addEventListener("click", () => {
  location.reload();
});

clearAllBtn?.addEventListener("click", async () => {
  const confirmed = confirm(
    "¿Seguro que quieres BORRAR TODAS las solicitudes?"
  );

  if (!confirmed) return;

  clearAllBtn.disabled = true;

  const oldText = clearAllBtn.textContent;
  clearAllBtn.textContent = "Limpiando...";

  try {
    const response = await fetch("/api/requests", {
      method: "DELETE",
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.ok) {
      throw new Error(
        data?.error || "No se pudo limpiar"
      );
    }
  } catch (error) {
    alert(
      error?.message ||
        "No se pudo limpiar. Revisa la conexión."
    );
  } finally {
    clearAllBtn.disabled = false;
    clearAllBtn.textContent = oldText;
  }
});

logoutBtn?.addEventListener("click", async () => {
  const confirmed = confirm(
    "¿Cerrar sesión del DJ?"
  );

  if (!confirmed) return;

  try {
    await fetch("/auth/logout", {
      method: "POST",
    });
  } catch {}

  location.href = "/login";
});

/* =========================================================
   ESTADO DE PEDIDOS
========================================================= */

function applyOrdersStatus(status) {
  const isOpen = !!status?.enabled;

  if (ordersStatus) {
    ordersStatus.classList.remove(
      "open",
      "closed"
    );

    ordersStatus.classList.add(
      isOpen ? "open" : "closed"
    );
  }

  if (ordersDot) {
    ordersDot.classList.remove(
      "open",
      "closed"
    );

    ordersDot.classList.add(
      isOpen ? "open" : "closed"
    );
  }

  if (ordersBar) {
    ordersBar.classList.remove(
      "open",
      "closed"
    );

    ordersBar.classList.add(
      isOpen ? "open" : "closed"
    );

    ordersBar.title = isOpen
      ? "Pedidos abiertos"
      : "Pedidos cerrados";
  }

  if (ordersLabel) {
    ordersLabel.textContent = "PEDIDOS";
  }
}

socket.on("orders:status", applyOrdersStatus);

/* =========================================================
   HELPERS
========================================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function groupByTable(requests) {
  const grouped = new Map();

  for (const request of requests) {
    if (!grouped.has(request.table)) {
      grouped.set(request.table, []);
    }

    grouped
      .get(request.table)
      .push(request);
  }

  return grouped;
}

function uniqueTablesInOrder(requests) {
  const seen = new Set();
  const tables = [];

  for (const request of requests) {
    const table = String(request.table);

    if (!seen.has(table)) {
      seen.add(table);
      tables.push(request.table);
    }
  }

  return tables;
}

function formatDate(iso) {
  try {
    const date = new Date(iso);

    const day = String(
      date.getDate()
    ).padStart(2, "0");

    const months = [
      "ENE",
      "FEB",
      "MAR",
      "ABR",
      "MAY",
      "JUN",
      "JUL",
      "AGO",
      "SEP",
      "OCT",
      "NOV",
      "DIC",
    ];

    const month =
      months[date.getMonth()] || "";

    const hours = String(
      date.getHours()
    ).padStart(2, "0");

    const minutes = String(
      date.getMinutes()
    ).padStart(2, "0");

    return `${day} ${month} ${hours}:${minutes}`;
  } catch {
    return String(iso ?? "");
  }
}

function getClientName(request) {
  return (
    request?.name ??
    request?.client ??
    request?.customer ??
    request?.cliente ??
    request?.persona ??
    ""
  );
}

function isCurrentPlayback(requestId) {
  return (
    currentPlayback.isPlaying &&
    String(currentPlayback.requestId) ===
      String(requestId)
  );
}

function normalizePlayback(status) {
  return {
    isPlaying: !!status?.isPlaying,

    requestId:
      status?.requestId !== null &&
      status?.requestId !== undefined
        ? Number(status.requestId)
        : null,

    table: status?.table ?? null,
    name: status?.name ?? null,
    artist: status?.artist ?? null,
    song: status?.song ?? null,
    startedAt: status?.startedAt ?? null,
  };
}

async function saveQueueOrder(ids) {
  if (reorderBusy) return;

  // Si hay una canción sonando, no aparece en la lista arrastrable.
  // La enviamos primero para mantener posiciones únicas en el servidor.
  const currentId =
    currentPlayback.isPlaying && currentPlayback.requestId
      ? Number(currentPlayback.requestId)
      : null;

  const orderedIds = currentId
    ? [currentId, ...ids.filter((id) => Number(id) !== currentId)]
    : ids;

  reorderBusy = true;

  try {
    const response = await fetch(
      "/api/requests/reorder",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ids: orderedIds }),
      }
    );

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || "No se pudo cambiar el orden");
    }

    // Actualización inmediata en el DJ; el servidor además emite
    // requests:update / queue:order a la pantalla TV.
    if (Array.isArray(data.queue)) {
      currentRequests = data.queue;
    }
  } catch (error) {
    alert(error?.message || "No se pudo guardar el nuevo orden.");
    loadInitialRequests();
  } finally {
    reorderBusy = false;
  }
}

function resetFreshQueueDrag() {
  const state = freshQueueDrag;

  state.ghost?.remove();

  if (state.item) {
    state.item.classList.remove("fresh-drag-source");
    state.item.style.visibility = "";
  }

  document.body.classList.remove("fresh-queue-dragging");

  freshQueueDrag = {
    active: false,
    item: null,
    ghost: null,
    offsetY: 0,
    moved: false,
    startY: 0,
  };
}

function renumberFreshQueue() {
  if (!lastTables) return;

  lastTables
    .querySelectorAll(".dj-fresh-item")
    .forEach((item, index) => {
      const number = item.querySelector(".dj-fresh-position");

      if (number) {
        number.textContent = String(index + 1);
      }
    });
}

function beginFreshQueueDrag(event) {
  if (!lastTables) return;

  const handle = event.target.closest(".dj-fresh-handle");

  if (!handle || !lastTables.contains(handle)) {
    return;
  }

  if (event.button !== undefined && event.button !== 0) {
    return;
  }

  const item = handle.closest(".dj-fresh-item");
  if (!item) return;

  event.preventDefault();

  const rect = item.getBoundingClientRect();
  const ghost = item.cloneNode(true);

  ghost.classList.add("dj-fresh-ghost");
  ghost.style.position = "fixed";
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "99999";

  document.body.appendChild(ghost);

  item.classList.add("fresh-drag-source");
  item.style.visibility = "hidden";

  freshQueueDrag = {
    active: true,
    item,
    ghost,
    offsetY: event.clientY - rect.top,
    moved: false,
    startY: event.clientY,
  };

  document.body.classList.add("fresh-queue-dragging");
}

function moveFreshQueueDrag(event) {
  const state = freshQueueDrag;

  if (
    !state.active ||
    !state.item ||
    !state.ghost ||
    !lastTables
  ) {
    return;
  }

  event.preventDefault();

  if (Math.abs(event.clientY - state.startY) > 3) {
    state.moved = true;
  }

  state.ghost.style.top =
    `${event.clientY - state.offsetY}px`;

  const underPointer =
    document.elementFromPoint(
      event.clientX,
      event.clientY
    );

  const target =
    underPointer?.closest(".dj-fresh-item");

  if (
    target &&
    target !== state.item &&
    lastTables.contains(target)
  ) {
    const rect =
      target.getBoundingClientRect();

    const after =
      event.clientY >
      rect.top + rect.height / 2;

    lastTables.insertBefore(
      state.item,
      after
        ? target.nextSibling
        : target
    );

    renumberFreshQueue();
    return;
  }

  const listRect =
    lastTables.getBoundingClientRect();

  if (event.clientY < listRect.top + 8) {
    lastTables.prepend(state.item);
    renumberFreshQueue();
  } else if (event.clientY > listRect.bottom - 8) {
    lastTables.appendChild(state.item);
    renumberFreshQueue();
  }
}

async function finishFreshQueueDrag(event, save = true) {
  const state = freshQueueDrag;

  if (
    !state.active ||
    !state.item ||
    !lastTables
  ) {
    return;
  }

  event?.preventDefault?.();

  const shouldSave = save && state.moved;

  resetFreshQueueDrag();

  if (shouldSave) {
    const ids = [
      ...lastTables.querySelectorAll(".dj-fresh-item"),
    ].map((item) =>
      Number(item.dataset.requestId)
    );

    await saveQueueOrder(ids);
  }

  if (Array.isArray(pendingRequestsWhileDragging)) {
    const pending = pendingRequestsWhileDragging;
    pendingRequestsWhileDragging = null;
    render(pending);
  } else if (pendingPlaybackRender) {
    pendingPlaybackRender = false;
    render(currentRequests);
  }
}

lastTables?.addEventListener(
  "pointerdown",
  beginFreshQueueDrag
);

document.addEventListener(
  "pointermove",
  moveFreshQueueDrag,
  { passive: false }
);

document.addEventListener(
  "pointerup",
  (event) => {
    finishFreshQueueDrag(event, true);
  },
  { passive: false }
);

document.addEventListener(
  "pointercancel",
  (event) => {
    finishFreshQueueDrag(event, false);
  },
  { passive: false }
);

window.addEventListener(
  "blur",
  () => {
    if (freshQueueDrag.active) {
      finishFreshQueueDrag(null, false);
    }
  }
);


/* =========================================================
   RENDER DEL PANEL DJ
========================================================= */

function render(requests) {
  currentRequests = Array.isArray(requests)
    ? requests
    : [];

  // El orden de la cola lo decide el DJ.
  // Las tarjetas grandes mantienen su estructura histórica.
  const mainRequests = [...currentRequests].sort(
    (a, b) => Number(a.id) - Number(b.id)
  );

  const currentIds = new Set(
    currentRequests.map((request) =>
      String(request.id)
    )
  );

  const newIdSet = new Set();

  if (!hasBootstrapped) {
    prevIds = currentIds;
    hasBootstrapped = true;
  } else {
    for (const id of currentIds) {
      if (!prevIds.has(id)) {
        newIdSet.add(id);

        const nuevaSolicitud =
          currentRequests.find(
            (request) =>
              String(request.id) ===
              String(id)
          );

        notificarNuevaSolicitud(
          nuevaSolicitud
        );
      }
    }

    prevIds = currentIds;
  }

  if (countBadge) {
    countBadge.textContent =
      `${currentRequests.length} pendientes`;
  }

  if (cards) {
    cards.innerHTML = "";
  }

  if (
    pendingConfirmId &&
    !currentIds.has(
      String(pendingConfirmId)
    )
  ) {
    pendingConfirmId = null;

    clearTimeout(confirmTimeout);
    confirmTimeout = null;
  }

  if (!currentRequests.length) {
    if (emptyMsg) {
      emptyMsg.textContent =
        "No hay solicitudes pendientes.";
    }

    if (lastTables) {
      lastTables.innerHTML =
        "<div>—</div>";
    }

    return;
  }

  if (emptyMsg) {
    emptyMsg.textContent = "";
  }

  const lastRequest =
    mainRequests[
      mainRequests.length - 1
    ];

  const lastTable =
    lastRequest?.table;

  const lastRequestId =
    lastRequest?.id ?? null;

  const tablesOrder =
    uniqueTablesInOrder(
      mainRequests
    );

  const nextUpTable =
    tablesOrder[0];

  const shouldShowRecent =
    !!(
      lastRequestId &&
      newIdSet.has(
        String(lastRequestId)
      )
    );

  const firstNameByTable =
    new Map();

  for (const request of mainRequests) {
    const tableKey =
      String(request.table);

    if (
      !firstNameByTable.has(
        tableKey
      )
    ) {
      firstNameByTable.set(
        tableKey,
        getClientName(request)
      );
    }
  }

  if (lastTables) {
    const queueItems =
      currentRequests.filter(
        (request) =>
          !isCurrentPlayback(request.id)
      );

    if (!queueItems.length) {
      lastTables.innerHTML = `
        <div class="dj-fresh-empty">
          No hay canciones pendientes
        </div>
      `;
    } else {
      lastTables.innerHTML =
        queueItems
          .map((request, index) => {
            const client =
              getClientName(request) ||
              "Sin nombre";

            const photoBadge =
              request.hasPhoto
                ? `<span class="dj-fresh-photo" title="Incluye foto">📷</span>`
                : "";

            return `
              <div
                class="dj-fresh-item"
                data-request-id="${escapeHtml(request.id)}"
              >
                <button
                  class="dj-fresh-handle"
                  type="button"
                  title="Arrastrar"
                  aria-label="Mover canción"
                >
                  ⋮⋮
                </button>

                <div class="dj-fresh-position">
                  ${index + 1}
                </div>

                <div class="dj-fresh-content">
                  <div class="dj-fresh-name">
                    ${escapeHtml(client)}
                    ${photoBadge}
                  </div>

                  <div class="dj-fresh-song">
                    ${escapeHtml(request.song || "Sin canción")}
                  </div>

                  <div class="dj-fresh-meta">
                    ${escapeHtml(request.artist || "Sin artista")} · Mesa ${escapeHtml(request.table ?? "—")}
                  </div>
                </div>
              </div>
            `;
          })
          .join("");
    }
  }


  const grouped =
    groupByTable(
      mainRequests
    );

  for (const table of tablesOrder) {
    const list =
      grouped.get(table) || [];

    const hasNewForTable =
      list.some((request) =>
        newIdSet.has(
          String(request.id)
        )
      );

    let lastNewId = null;

    for (
      let index = list.length - 1;
      index >= 0;
      index--
    ) {
      if (
        newIdSet.has(
          String(list[index].id)
        )
      ) {
        lastNewId =
          list[index].id;

        break;
      }
    }

    const isLastTable =
      String(table) ===
      String(lastTable);

    const isNextUp =
      String(table) ===
      String(nextUpTable);

    const showRecentBadge =
      isLastTable &&
      shouldShowRecent;

    const card =
      document.createElement("div");

    card.className =
      "card table-card" +
      (
        hasNewForTable
          ? " flash-new"
          : ""
      ) +
      (
        isNextUp
          ? " next-up"
          : ""
      ) +
      (
        showRecentBadge
          ? " recien-card"
          : ""
      );

    card.innerHTML = `
      <div class="row">
        <div class="title">
          Mesa ${escapeHtml(table)}

          ${
            isNextUp
              ? `
                <span
                  class="next-dot"
                  aria-label="Siguiente"
                ></span>
              `
              : ""
          }
        </div>

        <div style="display:flex;align-items:center;gap:10px;">
          ${
            isLastTable
              ? `
                <span
                  class="status ultima ${
                    showRecentBadge
                      ? "ultima-new"
                      : "ultima-faded"
                  }"
                  data-lastbadge-id="${escapeHtml(lastRequestId)}"
                >
                  ${
                    showRecentBadge
                      ? "Recién añadido"
                      : "ÚLTIMA MESA"
                  }
                </span>
              `
              : ""
          }
        </div>
      </div>

      <div class="song-list">
        ${list
          .map((request, index) => {
            const isLastNew =
              String(request.id) ===
              String(lastNewId);

            const isPlaying =
              isCurrentPlayback(
                request.id
              );

            const confirmClass =
              String(pendingConfirmId) ===
              String(request.id)
                ? " confirm"
                : "";

            const client =
              getClientName(request);

            return `
              <div
                class="song-item ${
                  isLastNew
                    ? "new-song"
                    : ""
                } ${
                  isPlaying
                    ? "is-playing"
                    : ""
                }"
                data-request-id="${escapeHtml(request.id)}"
              >
                ${
                  isPlaying
                    ? `
                      <div class="playing-badge">
                        AHORA SONANDO
                      </div>
                    `
                    : ""
                }

                <div class="song-client">
                  ${escapeHtml(client)}
                </div>

                <div class="song-line">
                  <div class="song-meta">
                    <b>Canción:</b>
                    ${escapeHtml(request.song)}
                  </div>

                  <span class="song-index">
                    #${index + 1}
                  </span>
                </div>

                <div class="song-meta">
                  <b>Artista:</b>
                  ${escapeHtml(request.artist)}
                </div>

                <div class="song-footer">
                  <div class="song-time">
                    ${escapeHtml(
                      formatDate(
                        request.createdAt
                      )
                    )}
                  </div>

                  <div class="song-actions">
                    <button
                      class="icon-btn playback-btn ${
                        isPlaying
                          ? "active"
                          : ""
                      }"
                      data-id="${escapeHtml(request.id)}"
                      type="button"
                      title="${
                        isPlaying
                          ? "Detener en pantalla"
                          : "Mostrar en pantalla"
                      }"
                      aria-label="${
                        isPlaying
                          ? "Detener reproducción"
                          : "Iniciar reproducción"
                      }"
                    >
                      ${
                        isPlaying
                          ? "■"
                          : "▶"
                      }
                    </button>

                    <button
                      class="icon-btn played-btn${confirmClass}"
                      data-id="${escapeHtml(request.id)}"
                      type="button"
                      title="Finalizar y guardar en historial"
                      aria-label="Finalizar canción"
                    >
                      ✓
                    </button>
                  </div>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>

      <div class="muted">
        Total en esta mesa:
        <b>${list.length}</b>
      </div>
    `;

    cards?.appendChild(card);
  }

  if (
    shouldShowRecent &&
    lastRequestId &&
    lastNewBadgeId !==
      lastRequestId
  ) {
    lastNewBadgeId =
      lastRequestId;

    setTimeout(() => {
      const selector =
        `[data-lastbadge-id="${CSS.escape(
          String(lastRequestId)
        )}"]`;

      const badge =
        document.querySelector(
          selector
        );

      if (!badge) return;

      badge.textContent =
        "ÚLTIMA MESA";

      badge.classList.remove(
        "ultima-new"
      );

      badge.classList.add(
        "ultima-faded"
      );

      badge
        .closest(".table-card")
        ?.classList.remove(
          "recien-card"
        );
    }, 4000);
  }
}

/* =========================================================
   INICIAR O DETENER REPRODUCCIÓN EN LA TV
========================================================= */

async function startPlayback(
  requestId,
  button
) {
  if (playbackBusy) return;

  playbackBusy = true;

  const oldText =
    button.textContent;

  button.disabled = true;
  button.textContent = "…";

  try {
    const response = await fetch(
      `/api/playback/start/${encodeURIComponent(requestId)}`,
      {
        method: "POST",
      }
    );

    const data =
      await response
        .json()
        .catch(() => null);

    if (
      !response.ok ||
      !data?.ok
    ) {
      throw new Error(
        data?.error ||
          "No se pudo iniciar la reproducción"
      );
    }

    currentPlayback =
      normalizePlayback(
        data.playback
      );

    render(currentRequests);
  } catch (error) {
    button.disabled = false;
    button.textContent = oldText;

    alert(
      error?.message ||
        "No se pudo enviar la canción a la pantalla."
    );
  } finally {
    playbackBusy = false;
  }
}

async function stopPlayback(button) {
  if (playbackBusy) return;

  playbackBusy = true;

  const oldText =
    button.textContent;

  button.disabled = true;
  button.textContent = "…";

  try {
    const response = await fetch(
      "/api/playback/stop",
      {
        method: "POST",
      }
    );

    const data =
      await response
        .json()
        .catch(() => null);

    if (
      !response.ok ||
      !data?.ok
    ) {
      throw new Error(
        data?.error ||
          "No se pudo detener la reproducción"
      );
    }

    currentPlayback =
      normalizePlayback(
        data.playback
      );

    render(currentRequests);
  } catch (error) {
    button.disabled = false;
    button.textContent = oldText;

    alert(
      error?.message ||
        "No se pudo detener la pantalla."
    );
  } finally {
    playbackBusy = false;
  }
}

/* =========================================================
   CLIC EN BOTONES DE CADA CANCIÓN
========================================================= */

cards?.addEventListener(
  "click",
  async (event) => {
    const playbackButton =
      event.target.closest(
        ".playback-btn"
      );

    if (playbackButton) {
      const requestId =
        playbackButton.getAttribute(
          "data-id"
        );

      if (!requestId) return;

      if (
        isCurrentPlayback(
          requestId
        )
      ) {
        await stopPlayback(
          playbackButton
        );
      } else {
        await startPlayback(
          requestId,
          playbackButton
        );
      }

      return;
    }

    const playedButton =
      event.target.closest(
        ".played-btn"
      );

    if (!playedButton) return;

    const requestId =
      playedButton.getAttribute(
        "data-id"
      );

    if (!requestId) return;

    if (
      String(pendingConfirmId) ===
      String(requestId)
    ) {
      clearTimeout(
        confirmTimeout
      );

      confirmTimeout = null;
      pendingConfirmId = null;

      playedButton.disabled = true;
      playedButton.classList.remove(
        "confirm"
      );

      playedButton.textContent =
        "⏱";

      try {
        const response = await fetch(
          `/api/requests/${encodeURIComponent(requestId)}`,
          {
            method: "DELETE",
          }
        );

        const data =
          await response
            .json()
            .catch(() => null);

        if (
          !response.ok ||
          !data?.ok
        ) {
          throw new Error(
            data?.error ||
              `Error ${response.status}`
          );
        }
      } catch (error) {
        playedButton.disabled =
          false;

        playedButton.textContent =
          "✓";

        alert(
          error?.message ||
            "No se pudo marcar como reproducida."
        );
      }

      return;
    }

    pendingConfirmId =
      requestId;

    document
      .querySelectorAll(
        ".played-btn.confirm"
      )
      .forEach((button) => {
        if (
          button !==
          playedButton
        ) {
          button.classList.remove(
            "confirm"
          );
        }
      });

    playedButton.classList.add(
      "confirm"
    );

    clearTimeout(
      confirmTimeout
    );

    confirmTimeout =
      setTimeout(() => {
        if (
          String(pendingConfirmId) ===
          String(requestId)
        ) {
          pendingConfirmId =
            null;
        }

        playedButton.classList.remove(
          "confirm"
        );
      }, 2500);
  }
);

/* =========================================================
   SOCKET.IO
========================================================= */

socket.on(
  "requests:update",
  (requests) => {
    if (freshQueueDrag.active) {
      pendingRequestsWhileDragging =
        Array.isArray(requests)
          ? requests
          : [];
      return;
    }

    render(requests);
  }
);

socket.on(
  "playback:update",
  (status) => {
    currentPlayback =
      normalizePlayback(status);

    if (freshQueueDrag.active) {
      pendingPlaybackRender = true;
      return;
    }

    render(currentRequests);
  }
);

/* =========================================================
   CARGA INICIAL
========================================================= */

async function loadInitialRequests() {
  try {
    const response =
      await fetch(
        "/api/requests",
        {
          cache: "no-store",
        }
      );

    const data =
      await response.json();

    if (data.ok) {
      render(
        data.requests || []
      );
    }
  } catch {}
}

async function loadInitialPlayback() {
  try {
    const response =
      await fetch(
        "/api/playback",
        {
          cache: "no-store",
        }
      );

    const data =
      await response.json();

    if (data.ok) {
      currentPlayback =
        normalizePlayback(
          data.playback
        );

      render(currentRequests);
    }
  } catch {}
}

async function loadInitialOrdersStatus() {
  try {
    const response =
      await fetch(
        "/api/orders-status",
        {
          cache: "no-store",
        }
      );

    const data =
      await response.json();

    if (data.ok) {
      applyOrdersStatus(
        data.ordersOpen
      );
    }
  } catch {}
}

loadInitialRequests();
loadInitialPlayback();
loadInitialOrdersStatus();