const socket = io();

const connBadge = document.getElementById("connBadge");
const logoutBtn = document.getElementById("logoutBtn");

const toggle1 = document.getElementById("toggle1");
const dot1 = document.getElementById("dot1");
const label1 = document.getElementById("label1");
const count1 = document.getElementById("count1");

const daysSelect = document.getElementById("daysSelect");
const refreshStatsBtn = document.getElementById("refreshStatsBtn");

const topSongsBody = document.getElementById("topSongsBody");
const byDayBody = document.getElementById("byDayBody");

const dayPickBtn = document.getElementById("dayPickBtn");
const dayPick = document.getElementById("dayPick");
const dayPickResult = document.getElementById("dayPickResult");

const histBtn1 = document.getElementById("histBtn1");
const histOverlay = document.getElementById("histOverlay");
const histModal = document.getElementById("histModal");
const histCloseBtn = document.getElementById("histCloseBtn");
const histTitle = document.getElementById("histTitle");
const histSub = document.getElementById("histSub");
const histDate = document.getElementById("histDate");
const histLoadBtn = document.getElementById("histLoadBtn");
const histStatus = document.getElementById("histStatus");
const histBody = document.getElementById("histBody");

const sumPlayed = document.getElementById("sumPlayed");
const sumTables = document.getElementById("sumTables");
const sumAvg = document.getElementById("sumAvg");
const sumMax = document.getElementById("sumMax");

function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      }[m])
  );
}

function setTbodyEmpty(tbody, cols, text = "Sin datos") {
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="${cols}" class="muted2" style="text-align:center;">
        ${esc(text)}
      </td>
    </tr>
  `;
}

function fmtDateCL(iso) {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString("es-CL", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function fmtTimeCL(isoLike) {
  try {
    const d = new Date(isoLike);

    return d.toLocaleTimeString("es-CL", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function fmtWait(min) {
  const n = Number(min) || 0;

  if (n < 60) return `${n} min`;

  const h = Math.floor(n / 60);
  const m = n % 60;

  return m ? `${h}h ${m}m` : `${h}h`;
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");

  return `${y}-${m}-${da}`;
}

function parseNum(x) {
  const n = Number(x);

  return Number.isFinite(n) ? n : 0;
}

/* ===========================
   ESTADO PEDIDOS
=========================== */

function applySwitchUI(open) {
  if (toggle1) {
    toggle1.checked = !!open;
  }

  if (dot1) {
    dot1.classList.toggle("open", !!open);
    dot1.classList.toggle("closed", !open);
  }

  if (label1) {
    label1.textContent = open ? "Abierto" : "Cerrado";
  }
}

function applyStatus(st) {
  applySwitchUI(!!st?.enabled);
}

async function saveStatus(enabled) {
  try {
    const r = await fetch("/api/admin/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled }),
    });

    const j = await r.json();

    if (!j.ok) {
      throw new Error(j.error || "No se pudo guardar");
    }

    applyStatus(j.ordersOpen);
  } catch (e) {
    alert(e.message || "Error guardando estado");

    try {
      const r2 = await fetch("/api/orders-status");
      const j2 = await r2.json();

      if (j2.ok) {
        applyStatus(j2.ordersOpen);
      }
    } catch {}
  }
}

/* ===========================
   SOCKET
=========================== */

socket.on("connect", () => {
  if (connBadge) {
    connBadge.textContent = "En vivo";
    connBadge.className = "badge ok";
  }
});

socket.on("disconnect", () => {
  if (connBadge) {
    connBadge.textContent = "Desconectado";
    connBadge.className = "badge warn";
  }
});

socket.on("orders:status", (st) => {
  applyStatus(st);
});

socket.on("requests:update", (rows) => {
  if (count1) {
    count1.textContent = Array.isArray(rows) ? rows.length : 0;
  }
});

/* ===========================
   TOGGLE ÚNICO
=========================== */

toggle1?.addEventListener("change", () => {
  saveStatus(toggle1.checked);
});

/* ===========================
   LOGOUT
=========================== */

logoutBtn?.addEventListener("click", async () => {
  try {
    await fetch("/auth/logout", {
      method: "POST",
    });
  } catch {}

  location.href = "/login";
});

/* ===========================
   STATS
=========================== */

async function loadStats() {
  const days = Number(daysSelect?.value || 30);

  try {
    const r = await fetch(`/api/admin/stats/by-day?days=${days}`);
    const j = await r.json();

    if (!j.ok) {
      throw new Error(j.error || "Error");
    }

    if (!j.rows?.length) {
      setTbodyEmpty(byDayBody, 2, "Sin datos");
    } else {
      byDayBody.innerHTML = j.rows
        .map((x, idx) => {
          const dayISO = String(x.day).slice(0, 10);
          const day = x.day ? fmtDateCL(dayISO) : "—";
          const cls = idx === 0 ? "byday-main" : "byday-small";

          return `
            <tr class="${cls}">
              <td>${esc(day)}</td>
              <td class="right">${esc(x.plays)}</td>
            </tr>
          `;
        })
        .join("");
    }
  } catch {
    setTbodyEmpty(byDayBody, 2, "Error cargando");
  }

  try {
    const r = await fetch(`/api/admin/stats/top-songs?days=${days}`);
    const j = await r.json();

    if (!j.ok) {
      throw new Error(j.error || "Error");
    }

    if (!j.rows?.length) {
      setTbodyEmpty(topSongsBody, 3, "Sin datos");
    } else {
      topSongsBody.innerHTML = j.rows
        .map(
          (x) => `
            <tr>
              <td>${esc(x.song)}</td>
              <td>${esc(x.artist)}</td>
              <td class="right">${esc(x.plays)}</td>
            </tr>
          `
        )
        .join("");
    }
  } catch {
    setTbodyEmpty(topSongsBody, 3, "Error cargando");
  }
}

refreshStatsBtn?.addEventListener("click", loadStats);
daysSelect?.addEventListener("change", loadStats);

/* ===========================
   VER DÍA
=========================== */

function openDatePicker(input) {
  if (!input) return;

  if (typeof input.showPicker === "function") {
    input.showPicker();
  } else {
    input.click();
  }
}

if (dayPickResult) {
  dayPickResult.textContent = "";
  dayPickResult.style.display = "none";
}

dayPickBtn?.addEventListener("click", () => {
  openDatePicker(dayPick);
});

dayPick?.addEventListener("change", async () => {
  const date = dayPick.value;

  if (!date) return;

  if (dayPickResult) {
    dayPickResult.style.display = "block";
    dayPickResult.textContent = "Cargando…";
  }

  try {
    const r = await fetch(
      `/api/admin/stats/by-day-one?date=${encodeURIComponent(date)}`
    );

    const j = await r.json();

    if (!j.ok) {
      throw new Error(j.error || "Error");
    }

    if (dayPickResult) {
      dayPickResult.textContent =
        `📅 ${fmtDateCL(date)} → ${j.plays} reproducidas`;
    }
  } catch {
    if (dayPickResult) {
      dayPickResult.textContent = "Error cargando día";
    }
  }
});

/* ===========================
   HISTORIAL
=========================== */

function openModal() {
  if (histTitle) {
    histTitle.textContent = "Historial";
  }

  if (histDate && !histDate.value) {
    histDate.value = todayISO();
  }

  histOverlay?.classList.add("open");
  histModal?.classList.add("open");

  loadHistory();
}

function closeModal() {
  histOverlay?.classList.remove("open");
  histModal?.classList.remove("open");
}

histOverlay?.addEventListener("click", closeModal);
histCloseBtn?.addEventListener("click", closeModal);
histBtn1?.addEventListener("click", openModal);
histLoadBtn?.addEventListener("click", loadHistory);

document.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    histModal?.classList.contains("open")
  ) {
    closeModal();
  }
});

function computeSummary(rows) {
  const total = rows.length;
  const tablesMap = new Map();

  let sumWait = 0;
  let maxWait = 0;

  for (const r of rows) {
    const t = String(r.table_no ?? "—");
    const w = parseNum(r.wait_min);

    sumWait += w;

    if (w > maxWait) {
      maxWait = w;
    }

    const cur = tablesMap.get(t) || {
      table: t,
      count: 0,
    };

    cur.count += 1;
    tablesMap.set(t, cur);
  }

  const tables = tablesMap.size;
  const avg = total ? Math.round(sumWait / total) : 0;

  return {
    total,
    tables,
    avg,
    max: maxWait,
  };
}

async function loadHistory() {
  const date = histDate?.value;

  if (!date) return;

  if (histStatus) {
    histStatus.textContent = "Cargando…";
  }

  setTbodyEmpty(histBody, 5, "Cargando…");

  try {
    const r = await fetch(
      `/api/admin/history?date=${encodeURIComponent(date)}`
    );

    const j = await r.json();

    if (!j.ok) {
      throw new Error(j.error || "Error");
    }

    if (histSub) {
      histSub.textContent = fmtDateCL(j.date);
    }

    const rows = j.rows || [];

    if (!rows.length) {
      if (histStatus) {
        histStatus.textContent =
          "Sin solicitudes reproducidas en este rango.";
      }

      if (sumPlayed) sumPlayed.textContent = "0";
      if (sumTables) sumTables.textContent = "0";
      if (sumAvg) sumAvg.textContent = "—";
      if (sumMax) sumMax.textContent = "—";

      setTbodyEmpty(histBody, 5, "Sin datos");
      return;
    }

    const s = computeSummary(rows);

    if (sumPlayed) {
      sumPlayed.textContent = String(s.total);
    }

    if (sumTables) {
      sumTables.textContent = String(s.tables);
    }

    if (sumAvg) {
      sumAvg.textContent = fmtWait(s.avg);
    }

    if (sumMax) {
      sumMax.textContent = fmtWait(s.max);
    }

    if (histStatus) {
      histStatus.textContent = "";
    }

    histBody.innerHTML = rows
      .map((x) => {
        const mesa = `Mesa ${x.table_no ?? "—"}`;

        const who = x.name
          ? `<div class="who">${esc(x.name)}</div>`
          : "";

        const song =
          `<div class="song">${esc(x.song || "—")}</div>`;

        const artist = x.artist
          ? `<div class="muted2">${esc(x.artist)}</div>`
          : `<div class="muted2">—</div>`;

        const reqT = fmtTimeCL(x.requested_at);
        const playT = fmtTimeCL(x.played_at);
        const wait = fmtWait(x.wait_min);

        return `
          <tr>
            <td>
              <span class="tag">${esc(mesa)}</span>
            </td>

            <td>
              ${who}
              ${song}
              ${artist}
            </td>

            <td>
              <span class="mono">${esc(reqT)}</span>
            </td>

            <td>
              <span class="mono">${esc(playT)}</span>
            </td>

            <td class="right">
              <b>${esc(wait)}</b>
            </td>
          </tr>
        `;
      })
      .join("");
  } catch (e) {
    if (histStatus) {
      histStatus.textContent =
        "Error cargando historial: " + (e.message || e);
    }

    if (sumPlayed) sumPlayed.textContent = "—";
    if (sumTables) sumTables.textContent = "—";
    if (sumAvg) sumAvg.textContent = "—";
    if (sumMax) sumMax.textContent = "—";

    setTbodyEmpty(histBody, 5, "Error cargando");
  }
}

/* ===========================
   BOOT
=========================== */

(async function boot() {
  try {
    const r = await fetch("/api/orders-status");
    const j = await r.json();

    if (j.ok) {
      applyStatus(j.ordersOpen);
    }
  } catch {}

  loadStats();
})();