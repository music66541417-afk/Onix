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

const raffleBtn1 = document.getElementById("raffleBtn1");
const raffleOverlay = document.getElementById("raffleOverlay");
const raffleModal = document.getElementById("raffleModal");
const raffleCloseBtn = document.getElementById("raffleCloseBtn");
const raffleDate = document.getElementById("raffleDate");
const raffleSpinBtn = document.getElementById("raffleSpinBtn");
const raffleStatus = document.getElementById("raffleStatus");
const participantsBody = document.getElementById("participantsBody");
const winnersBody = document.getElementById("winnersBody");
const wheelCanvas = document.getElementById("wheelCanvas");

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
  tbody.innerHTML = `<tr><td colspan="${cols}" class="muted2" style="text-align:center;">${esc(text)}</td></tr>`;
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
  if (toggle1) toggle1.checked = !!open;

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
    if (!j.ok) throw new Error(j.error || "No se pudo guardar");

    applyStatus(j.ordersOpen);
  } catch (e) {
    alert(e.message || "Error guardando estado");

    try {
      const r2 = await fetch("/api/orders-status");
      const j2 = await r2.json();
      if (j2.ok) applyStatus(j2.ordersOpen);
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

socket.on("orders:status", (st) => applyStatus(st));

socket.on("requests:update", (rows) => {
  if (count1) count1.textContent = Array.isArray(rows) ? rows.length : 0;
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
    await fetch("/auth/logout", { method: "POST" });
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
    if (!j.ok) throw new Error(j.error || "Error");

    if (!j.rows?.length) {
      setTbodyEmpty(byDayBody, 2, "Sin datos");
    } else {
      byDayBody.innerHTML = j.rows
        .map((x, idx) => {
          const dayISO = String(x.day).slice(0, 10);
          const day = x.day ? fmtDateCL(dayISO) : "—";
          const cls = idx === 0 ? "byday-main" : "byday-small";

          return `<tr class="${cls}">
            <td>${esc(day)}</td>
            <td class="right">${esc(x.plays)}</td>
          </tr>`;
        })
        .join("");
    }
  } catch {
    setTbodyEmpty(byDayBody, 2, "Error cargando");
  }

  try {
    const r = await fetch(`/api/admin/stats/top-songs?days=${days}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Error");

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
  if (typeof input.showPicker === "function") input.showPicker();
  else input.click();
}

if (dayPickResult) {
  dayPickResult.textContent = "";
  dayPickResult.style.display = "none";
}

dayPickBtn?.addEventListener("click", () => openDatePicker(dayPick));

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
    if (!j.ok) throw new Error(j.error || "Error");

    if (dayPickResult) {
      dayPickResult.textContent = `📅 ${fmtDateCL(date)} → ${j.plays} reproducidas`;
    }
  } catch {
    if (dayPickResult) dayPickResult.textContent = "Error cargando día";
  }
});

/* ===========================
   HISTORIAL
=========================== */

function openModal() {
  if (histTitle) histTitle.textContent = "Historial";
  if (histDate && !histDate.value) histDate.value = todayISO();

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
  if (e.key === "Escape" && histModal?.classList.contains("open")) {
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
    if (w > maxWait) maxWait = w;

    const cur = tablesMap.get(t) || { table: t, count: 0 };
    cur.count += 1;
    tablesMap.set(t, cur);
  }

  const tables = tablesMap.size;
  const avg = total ? Math.round(sumWait / total) : 0;

  return { total, tables, avg, max: maxWait };
}

async function loadHistory() {
  const date = histDate?.value;
  if (!date) return;

  if (histStatus) histStatus.textContent = "Cargando…";
  setTbodyEmpty(histBody, 5, "Cargando…");

  try {
    const r = await fetch(
      `/api/admin/history?date=${encodeURIComponent(date)}`
    );

    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Error");

    if (histSub) histSub.textContent = `${fmtDateCL(j.date)}`;

    const rows = j.rows || [];

    if (!rows.length) {
      if (histStatus) {
        histStatus.textContent = "Sin solicitudes reproducidas en este rango.";
      }

      if (sumPlayed) sumPlayed.textContent = "0";
      if (sumTables) sumTables.textContent = "0";
      if (sumAvg) sumAvg.textContent = "—";
      if (sumMax) sumMax.textContent = "—";

      setTbodyEmpty(histBody, 5, "Sin datos");
      return;
    }

    const s = computeSummary(rows);

    if (sumPlayed) sumPlayed.textContent = String(s.total);
    if (sumTables) sumTables.textContent = String(s.tables);
    if (sumAvg) sumAvg.textContent = fmtWait(s.avg);
    if (sumMax) sumMax.textContent = fmtWait(s.max);

    if (histStatus) histStatus.textContent = "";

    histBody.innerHTML = rows
      .map((x) => {
        const mesa = `Mesa ${x.table_no ?? "—"}`;
        const who = x.name ? `<div class="who">${esc(x.name)}</div>` : "";
        const song = `<div class="song">${esc(x.song || "—")}</div>`;
        const artist = x.artist
          ? `<div class="muted2">${esc(x.artist)}</div>`
          : `<div class="muted2">—</div>`;

        const reqT = fmtTimeCL(x.requested_at);
        const playT = fmtTimeCL(x.played_at);
        const wait = fmtWait(x.wait_min);

        return `<tr>
          <td><span class="tag">${esc(mesa)}</span></td>
          <td>${who}${song}${artist}</td>
          <td><span class="mono">${esc(reqT)}</span></td>
          <td><span class="mono">${esc(playT)}</span></td>
          <td class="right"><b>${esc(wait)}</b></td>
        </tr>`;
      })
      .join("");
  } catch (e) {
    if (histStatus) {
      histStatus.textContent = "Error cargando historial: " + (e.message || e);
    }

    if (sumPlayed) sumPlayed.textContent = "—";
    if (sumTables) sumTables.textContent = "—";
    if (sumAvg) sumAvg.textContent = "—";
    if (sumMax) sumMax.textContent = "—";

    setTbodyEmpty(histBody, 5, "Error cargando");
  }
}

/* ===========================
   RULETA
=========================== */

let raffleParticipants = [];
let wheelRot = 0;
let spinning = false;

let prevParticipantKeys = new Set();
let flashParticipantKeys = new Set();
let flashClearTimer = null;

function pluralVez(n) {
  return Number(n) === 1 ? "vez" : "veces";
}

function participantLabel(x) {
  return String(x?.name ?? "").trim();
}

function participantKey(x) {
  return `${String(x?.name ?? "").trim().toLowerCase()}::${String(
    x?.table_no ?? ""
  )
    .trim()
    .toLowerCase()}`;
}

function setRaffleStatus(msg) {
  if (!raffleStatus) return;

  const text = String(msg ?? "").trim();

  raffleStatus.textContent = text;
  raffleStatus.style.display = text ? "block" : "none";
}

function openRaffle() {
  if (raffleDate && !raffleDate.value) raffleDate.value = todayISO();

  raffleOverlay?.classList.add("open");
  raffleModal?.classList.add("open");

  prevParticipantKeys = new Set();
  flashParticipantKeys = new Set();

  loadRaffleParticipants();
  loadWinners();
}

function closeRaffle() {
  raffleOverlay?.classList.remove("open");
  raffleModal?.classList.remove("open");

  raffleParticipants = [];
  prevParticipantKeys = new Set();
  flashParticipantKeys = new Set();

  if (flashClearTimer) {
    clearTimeout(flashClearTimer);
    flashClearTimer = null;
  }

  setRaffleStatus("");
  setTbodyEmpty(participantsBody, 2, "—");
  setTbodyEmpty(winnersBody, 3, "—");

  drawWheel();

  if (raffleSpinBtn) raffleSpinBtn.disabled = false;
  spinning = false;
}

raffleOverlay?.addEventListener("click", closeRaffle);
raffleCloseBtn?.addEventListener("click", closeRaffle);
raffleBtn1?.addEventListener("click", openRaffle);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && raffleModal?.classList.contains("open")) {
    closeRaffle();
  }
});

raffleDate?.addEventListener("change", () => {
  prevParticipantKeys = new Set();
  flashParticipantKeys = new Set();
  loadRaffleParticipants();
  loadWinners();
});

socket.on("raffle:update", async () => {
  if (!raffleModal?.classList.contains("open")) return;

  await loadRaffleParticipants({
    keepStatus: true,
    highlightNew: true,
  });
});

function wheelCtx() {
  if (!wheelCanvas) return null;
  return wheelCanvas.getContext("2d");
}

function drawWheel() {
  const ctx = wheelCtx();
  if (!ctx) return;

  const w = wheelCanvas.width;
  const h = wheelCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(cx, cy) - 6;

  ctx.clearRect(0, 0, w, h);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(200,165,122,0.9)";
  ctx.stroke();

  const n = raffleParticipants.length;

  if (!n) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "700 16px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Sin participantes", cx, cy);
    return;
  }

  const arc = (Math.PI * 2) / n;

  for (let i = 0; i < n; i++) {
    const item = raffleParticipants[i];
    const isFlash = flashParticipantKeys.has(participantKey(item));

    const a0 = wheelRot + i * arc;
    const a1 = a0 + arc;

    let light = i % 2 ? 0.1 : 0.18;
    if (isFlash) light = 0.28;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,255,255,${light})`;
    ctx.fill();

    if (isFlash) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,215,120,0.85)";
      ctx.stroke();
    }

    const mid = (a0 + a1) / 2;
    const tx = cx + Math.cos(mid) * (r * 0.62);
    const ty = cy + Math.sin(mid) * (r * 0.62);

    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(mid + Math.PI / 2);
    ctx.fillStyle = isFlash
      ? "rgba(255,230,170,0.98)"
      : "rgba(255,255,255,0.9)";
    ctx.font = isFlash ? "800 12px system-ui" : "700 12px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(participantLabel(item).slice(0, 22), 0, 0);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, 26, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(15,15,16,0.85)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(200,165,122,0.9)";
  ctx.stroke();
}

function pickWinnerFromRotation() {
  const n = raffleParticipants.length;
  if (!n) return null;

  const arc = (Math.PI * 2) / n;
  const pointerAngle = -Math.PI / 2;

  const a = (pointerAngle - wheelRot) % (Math.PI * 2);
  const norm = (a + Math.PI * 2) % (Math.PI * 2);

  const idx = Math.floor(norm / arc) % n;

  return { idx, ...raffleParticipants[idx] };
}

function renderParticipantsFromLocal() {
  if (!participantsBody) {
    drawWheel();
    return;
  }

  if (!raffleParticipants.length) {
    setTbodyEmpty(participantsBody, 2, "Sin participantes");
    wheelRot = 0;
    drawWheel();
    return;
  }

  participantsBody.innerHTML = raffleParticipants
    .map((x) => {
      const isFlash = flashParticipantKeys.has(participantKey(x));

      return `
        <tr class="${isFlash ? "raffle-new-row" : ""}">
          <td>
            <b>${esc(x.name)}</b>
            <div class="muted2">Mesa ${esc(x.table_no ?? "—")}</div>
          </td>
          <td class="right">Cantó ${esc(x.plays)} ${pluralVez(x.plays)}</td>
        </tr>
      `;
    })
    .join("");

  drawWheel();
}

function triggerParticipantFlash(keys) {
  flashParticipantKeys = new Set(keys);

  if (flashClearTimer) clearTimeout(flashClearTimer);

  flashClearTimer = setTimeout(() => {
    flashParticipantKeys = new Set();
    renderParticipantsFromLocal();
  }, 2200);
}

async function loadRaffleParticipants(opts = {}) {
  const { keepStatus = false, highlightNew = false } = opts;
  const date = raffleDate?.value || todayISO();

  if (!keepStatus) setRaffleStatus("Cargando participantes…");
  setTbodyEmpty(participantsBody, 2, "Cargando…");

  try {
    const r = await fetch(
      `/api/admin/stats/top-singers-night?date=${encodeURIComponent(date)}&min=2`
    );

    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Error");

    const nextRows = (j.rows || []).map((x) => ({
      name: x.name,
      table_no: x.table_no ?? null,
      plays: Number(x.plays) || 0,
    }));

    const nextKeys = new Set(nextRows.map(participantKey));
    const newKeys = [];

    if (highlightNew) {
      for (const item of nextRows) {
        const k = participantKey(item);
        if (!prevParticipantKeys.has(k)) newKeys.push(k);
      }
    }

    raffleParticipants = nextRows;
    prevParticipantKeys = nextKeys;

    if (!raffleParticipants.length) {
      if (!keepStatus) setRaffleStatus("");
      setTbodyEmpty(participantsBody, 2, "Sin participantes");
      wheelRot = 0;
      drawWheel();
      if (raffleSpinBtn) raffleSpinBtn.disabled = true;
      return;
    }

    if (newKeys.length) {
      triggerParticipantFlash(newKeys);
      setRaffleStatus("✨ Nuevo concursante agregado a la ruleta");
    } else if (!keepStatus) {
      setRaffleStatus("");
    }

    renderParticipantsFromLocal();

    if (raffleSpinBtn) raffleSpinBtn.disabled = false;

    if (newKeys.length) {
      setTimeout(() => {
        if (
          raffleStatus?.textContent ===
          "✨ Nuevo concursante agregado a la ruleta"
        ) {
          setRaffleStatus("");
        }
      }, 1800);
    }
  } catch {
    raffleParticipants = [];
    if (!keepStatus) setRaffleStatus("");
    setTbodyEmpty(participantsBody, 2, "Error cargando");
    wheelRot = 0;
    drawWheel();

    if (raffleSpinBtn) raffleSpinBtn.disabled = true;
  }
}

async function loadWinners() {
  const date = raffleDate?.value || todayISO();

  setTbodyEmpty(winnersBody, 3, "Cargando…");

  try {
    const r = await fetch(
      `/api/admin/raffle/winners?date=${encodeURIComponent(date)}`
    );

    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Error");

    const rows = j.rows || [];

    if (!rows.length) {
      setTbodyEmpty(winnersBody, 3, "Sin ganadores todavía");
      return;
    }

    winnersBody.innerHTML = rows
      .map(
        (w) => `
        <tr>
          <td class="mono">${esc(fmtTimeCL(w.created_at))}</td>
          <td><div class="winner-row-name">${esc(w.name)}</div></td>
          <td><span class="winner-badge">Mesa ${esc(w.table_no ?? "—")}</span></td>
        </tr>
      `
      )
      .join("");
  } catch {
    setTbodyEmpty(winnersBody, 3, "Error cargando ganadores");
  }
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

async function spinWheel() {
  if (spinning) return;

  if (!raffleParticipants.length) {
    alert("No hay participantes para girar.");
    return;
  }

  spinning = true;

  if (raffleSpinBtn) raffleSpinBtn.disabled = true;

  const baseTurns = 5;
  const extra = Math.random() * 2;
  const target =
    wheelRot +
    (baseTurns + extra) * Math.PI * 2 +
    Math.random() * Math.PI * 2;

  const start = wheelRot;
  const delta = target - start;
  const dur = 2600;
  const t0 = performance.now();

  setRaffleStatus("Girando…");

  function frame(now) {
    const t = Math.min(1, (now - t0) / dur);
    const k = easeOutCubic(t);

    wheelRot = start + delta * k;
    drawWheel();

    if (t < 1) requestAnimationFrame(frame);
    else done();
  }

  async function done() {
    wheelRot = ((wheelRot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    drawWheel();

    const w = pickWinnerFromRotation();

    if (!w) {
      setRaffleStatus("");
      spinning = false;
      if (raffleSpinBtn) raffleSpinBtn.disabled = false;
      return;
    }

    const winnerName = w.name;
    const winnerTable = w.table_no;
    const winnerPlays = w.plays;
    const winnerKey = participantKey(w);

    setRaffleStatus(
      `🏆 Ganador: ${winnerName}${winnerTable ? ` · Mesa ${winnerTable}` : ""}`
    );

    try {
      const date = raffleDate?.value || todayISO();

      await fetch("/api/admin/raffle/winners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          name: winnerName,
          table: winnerTable,
          plays: winnerPlays,
        }),
      });
    } catch {}

    raffleParticipants = raffleParticipants.filter(
      (p) => participantKey(p) !== winnerKey
    );

    prevParticipantKeys = new Set(raffleParticipants.map(participantKey));
    renderParticipantsFromLocal();

    await loadWinners();
    await loadRaffleParticipants({
      keepStatus: true,
      highlightNew: false,
    });

    setTimeout(() => setRaffleStatus(""), 1800);

    spinning = false;

    if (raffleSpinBtn) {
      raffleSpinBtn.disabled = raffleParticipants.length === 0;
    }
  }

  requestAnimationFrame(frame);
}

raffleSpinBtn?.addEventListener("click", spinWheel);

try {
  drawWheel();
} catch {}

/* ===========================
   BOOT
=========================== */

(async function boot() {
  try {
    const r = await fetch("/api/orders-status");
    const j = await r.json();

    if (j.ok) applyStatus(j.ordersOpen);
  } catch {}

  loadStats();
})();