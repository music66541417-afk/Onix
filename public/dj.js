// public/dj.js

const cards = document.getElementById("cards");
const lastTables = document.getElementById("lastTables");
const emptyMsg = document.getElementById("emptyMsg");
const countBadge = document.getElementById("countBadge");

const refreshBtn = document.getElementById("refreshBtn");
const clearAllBtn = document.getElementById("clearAllBtn");

const ordersBar = document.getElementById("ordersBar");
const ordersDot = document.getElementById("ordersDot");
const ordersLabel = document.getElementById("ordersLabel");

const logoutBtn = document.getElementById("logoutBtn");

const socket = io();

let prevIds = new Set();
let hasBootstrapped = false;
let lastNewBadgeId = null;

let pendingConfirmId = null;
let confirmTimeout = null;

refreshBtn?.addEventListener("click", () => location.reload());

clearAllBtn?.addEventListener("click", async () => {
  const ok = confirm("¿Seguro que quieres BORRAR TODAS las solicitudes?");
  if (!ok) return;

  clearAllBtn.disabled = true;
  const oldText = clearAllBtn.textContent;
  clearAllBtn.textContent = "Limpiando...";

  try {
    await fetch("/api/requests", { method: "DELETE" });
  } catch {
    alert("No se pudo limpiar. Revisa conexión.");
  } finally {
    clearAllBtn.disabled = false;
    clearAllBtn.textContent = oldText;
  }
});

logoutBtn?.addEventListener("click", async () => {
  const ok = confirm("¿Cerrar sesión del DJ?");
  if (!ok) return;

  try {
    await fetch("/auth/logout", { method: "POST" });
  } catch {}

  location.href = "/login";
});

// Estado pedidos único: ahora viene como { enabled: true/false }
socket.on("orders:status", (st) => {
  const isOpen = !!st?.enabled;

  if (ordersDot) {
    ordersDot.classList.remove("open", "closed");
    ordersDot.classList.add(isOpen ? "open" : "closed");
  }

  if (ordersBar) {
    ordersBar.classList.remove("open", "closed");
    ordersBar.classList.add(isOpen ? "open" : "closed");
    ordersBar.title = isOpen ? "Pedidos abiertos" : "Pedidos cerrados";
  }

  if (ordersLabel) ordersLabel.textContent = "PEDIDOS";
});

function groupByTable(requests) {
  const map = new Map();

  for (const r of requests) {
    if (!map.has(r.table)) map.set(r.table, []);
    map.get(r.table).push(r);
  }

  return map;
}

function uniqueTablesInOrder(requests) {
  const seen = new Set();
  const out = [];

  for (const r of requests) {
    if (!seen.has(r.table)) {
      seen.add(r.table);
      out.push(r.table);
    }
  }

  return out;
}

function formatDate(iso) {
  try {
    const d = new Date(iso);

    const day = String(d.getDate()).padStart(2, "0");
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
    const mon = months[d.getMonth()] || "";

    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");

    return `${day} ${mon} ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

function getClientName(r) {
  return (
    r?.name ??
    r?.client ??
    r?.customer ??
    r?.cliente ??
    r?.persona ??
    ""
  );
}

function render(requests) {
  requests = Array.isArray(requests) ? requests : [];

  const currentIds = new Set(requests.map((r) => r.id));
  const newIdSet = new Set();

  if (!hasBootstrapped) {
    prevIds = currentIds;
    hasBootstrapped = true;
  } else {
    for (const id of currentIds) {
      if (!prevIds.has(id)) newIdSet.add(id);
    }
    prevIds = currentIds;
  }

  if (countBadge) {
    countBadge.textContent = `${requests.length} pendientes`;
  }

  if (cards) {
    cards.innerHTML = "";
  }

  if (pendingConfirmId && !currentIds.has(pendingConfirmId)) {
    pendingConfirmId = null;
    clearTimeout(confirmTimeout);
    confirmTimeout = null;
  }

  if (requests.length === 0) {
    if (emptyMsg) emptyMsg.textContent = "No hay solicitudes pendientes.";
    if (lastTables) lastTables.innerHTML = `<div>—</div>`;
    return;
  }

  if (emptyMsg) emptyMsg.textContent = "";

  const lastReq = requests[requests.length - 1];
  const lastTable = lastReq?.table;
  const lastReqId = lastReq?.id ?? null;

  const tablesOrder = uniqueTablesInOrder(requests);
  const nextUpTable = tablesOrder[0];
  const shouldShowRecien = !!(lastReqId && newIdSet.has(lastReqId));

  const firstNameByTable = new Map();

  for (const r of requests) {
    const key = String(r.table);
    if (!firstNameByTable.has(key)) {
      firstNameByTable.set(key, getClientName(r));
    }
  }

  if (lastTables) {
    lastTables.innerHTML = tablesOrder
      .map((t, i) => {
        const name = firstNameByTable.get(String(t)) ?? "";
        return `
          <div>
            <span>#${i + 1}</span>
            <span>Mesa ${escapeHtml(t)}</span>
            <span>${escapeHtml(name)}</span>
          </div>
        `;
      })
      .join("");
  }

  const grouped = groupByTable(requests);

  for (const table of tablesOrder) {
    const list = grouped.get(table) || [];
    const hasNewForThisTable = list.some((r) => newIdSet.has(r.id));

    let lastNewId = null;

    for (let i = list.length - 1; i >= 0; i--) {
      if (newIdSet.has(list[i].id)) {
        lastNewId = list[i].id;
        break;
      }
    }

    const isLastTable = String(table) === String(lastTable);
    const isNextUp = String(table) === String(nextUpTable);
    const showRecienBadge = isLastTable && shouldShowRecien;

    const card = document.createElement("div");

    card.className =
      "card table-card" +
      (hasNewForThisTable ? " flash-new" : "") +
      (isNextUp ? " next-up" : "") +
      (showRecienBadge ? " recien-card" : "");

    card.innerHTML = `
      <div class="row">
        <div class="title">
          Mesa ${escapeHtml(table)}
          ${isNextUp ? `<span class="next-dot" aria-label="Siguiente"></span>` : ``}
        </div>

        <div style="display:flex; align-items:center; gap:10px;">
          ${
            isLastTable
              ? `
                <span class="status ultima ${
                  showRecienBadge ? "ultima-new" : "ultima-faded"
                }"
                      data-lastbadge-id="${escapeHtml(lastReqId)}">
                  ${showRecienBadge ? "Recién añadido" : "ÚLTIMA MESA"}
                </span>
              `
              : ``
          }
        </div>
      </div>

      <div class="song-list">
        ${list
          .map((r, idx) => {
            const isLastNew = r.id === lastNewId;
            const confirmClass = pendingConfirmId === r.id ? " confirm" : "";
            const client = getClientName(r);

            return `
              <div class="song-item ${isLastNew ? "new-song" : ""}">
                <div class="song-client">${escapeHtml(client)}</div>

                <div class="song-line">
                  <div class="song-meta"><b>Canción:</b> ${escapeHtml(
                    r.song
                  )}</div>
                  <span class="song-index">#${idx + 1}</span>
                </div>

                <div class="song-meta"><b>Artista:</b> ${escapeHtml(
                  r.artist
                )}</div>

                <div class="song-footer">
                  <div class="song-time">${escapeHtml(
                    formatDate(r.createdAt)
                  )}</div>
                  <button class="icon-btn played-btn${confirmClass}" 
                          data-id="${escapeHtml(r.id)}" 
                          title="Marcar como reproducida">✓</button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>

      <div class="muted">Total en esta mesa: <b>${list.length}</b></div>
    `;

    cards?.appendChild(card);
  }

  if (shouldShowRecien && lastReqId && lastNewBadgeId !== lastReqId) {
    lastNewBadgeId = lastReqId;

    setTimeout(() => {
      const sel = `[data-lastbadge-id="${CSS.escape(String(lastReqId))}"]`;
      const el = document.querySelector(sel);
      if (!el) return;

      el.textContent = "ÚLTIMA MESA";
      el.classList.remove("ultima-new");
      el.classList.add("ultima-faded");

      el.closest(".table-card")?.classList.remove("recien-card");
    }, 4000);
  }
}

cards?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".played-btn");
  if (!btn) return;

  const id = btn.getAttribute("data-id");
  if (!id) return;

  if (pendingConfirmId === id) {
    clearTimeout(confirmTimeout);
    confirmTimeout = null;
    pendingConfirmId = null;

    btn.disabled = true;
    btn.classList.remove("confirm");
    btn.textContent = "⏱️";

    try {
      const res = await fetch(`/api/requests/${id}`, { method: "DELETE" });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Error ${res.status}`);
      }

      const listRes = await fetch("/api/requests");
      const listData = await listRes.json().catch(() => null);

      if (listRes.ok && listData?.ok) {
        render(listData.requests || []);
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "✓";
      alert(
        err?.message ||
          "No se pudo marcar como reproducida. Revisa conexión."
      );
    }

    return;
  }

  pendingConfirmId = id;

  document.querySelectorAll(".played-btn.confirm").forEach((b) => {
    if (b !== btn) b.classList.remove("confirm");
  });

  btn.classList.add("confirm");

  clearTimeout(confirmTimeout);

  confirmTimeout = setTimeout(() => {
    if (pendingConfirmId === id) pendingConfirmId = null;
    btn.classList.remove("confirm");
  }, 2500);
});

socket.on("requests:update", (requests) => render(requests));

async function loadInitialRequests() {
  try {
    const r = await fetch("/api/requests");
    const j = await r.json();

    if (j.ok) {
      render(j.requests || []);
    }
  } catch {}
}

async function loadInitialOrdersStatus() {
  try {
    const r = await fetch("/api/orders-status");
    const j = await r.json();

    if (j.ok) {
      socket.emit("orders:status", j.ordersOpen);
      const isOpen = !!j.ordersOpen?.enabled;

      if (ordersDot) {
        ordersDot.classList.remove("open", "closed");
        ordersDot.classList.add(isOpen ? "open" : "closed");
      }

      if (ordersBar) {
        ordersBar.classList.remove("open", "closed");
        ordersBar.classList.add(isOpen ? "open" : "closed");
        ordersBar.title = isOpen ? "Pedidos abiertos" : "Pedidos cerrados";
      }
    }
  } catch {}
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadInitialRequests();
loadInitialOrdersStatus();