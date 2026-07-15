const socket = io();

const raffleConnection = document.getElementById("raffleConnection");
const raffleConnectionText = document.getElementById("raffleConnectionText");

const raffleDate = document.getElementById("raffleDate");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const backDjBtn = document.getElementById("backDjBtn");

const raffleStatus = document.getElementById("raffleStatus");
const raffleSpinBtn = document.getElementById("raffleSpinBtn");

const participantsCount = document.getElementById("participantsCount");
const participantsBody = document.getElementById("participantsBody");

const winnersCount = document.getElementById("winnersCount");
const winnersBody = document.getElementById("winnersBody");

const wheelCanvas = document.getElementById("wheelCanvas");

const winnerOverlay = document.getElementById("winnerOverlay");
const winnerCloseBtn = document.getElementById("winnerCloseBtn");
const winnerContinueBtn = document.getElementById("winnerContinueBtn");
const winnerName = document.getElementById("winnerName");
const winnerTable = document.getElementById("winnerTable");

let raffleParticipants = [];
let wheelRotation = 0;
let spinning = false;

let previousParticipantKeys = new Set();
let flashingParticipantKeys = new Set();
let flashClearTimer = null;

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      }[char])
  );
}

function todayISO() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatTimeCL(value) {
  try {
    const date = new Date(value);

    return date.toLocaleTimeString("es-CL", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function pluralVez(value) {
  return Number(value) === 1 ? "vez" : "veces";
}

function participantKey(participant) {
  const name = String(participant?.name ?? "")
    .trim()
    .toLowerCase();

  const table = String(participant?.table_no ?? "")
    .trim()
    .toLowerCase();

  return `${name}::${table}`;
}

function participantLabel(participant) {
  const name = String(participant?.name ?? "").trim();
  const table = String(participant?.table_no ?? "").trim();

  return table ? `${name} · M${table}` : name;
}

function setStatus(message) {
  if (!raffleStatus) return;

  const text = String(message ?? "").trim();

  raffleStatus.textContent = text;
  raffleStatus.style.display = text ? "block" : "none";
}

function setTableEmpty(tbody, columns, message) {
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="${columns}" class="raffle-empty">
        ${escapeHtml(message)}
      </td>
    </tr>
  `;
}

function setConnectionState(state) {
  if (!raffleConnection || !raffleConnectionText) return;

  raffleConnection.classList.remove("online", "offline");

  if (state === "online") {
    raffleConnection.classList.add("online");
    raffleConnectionText.textContent = "En vivo";
    return;
  }

  if (state === "offline") {
    raffleConnection.classList.add("offline");
    raffleConnectionText.textContent = "Desconectado";
    return;
  }

  raffleConnectionText.textContent = "Conectando…";
}

function showWinnerOverlay(participant) {
  if (!winnerOverlay) return;

  if (winnerName) {
    winnerName.textContent = participant?.name || "—";
  }

  if (winnerTable) {
    winnerTable.textContent = participant?.table_no
      ? `Mesa ${participant.table_no}`
      : "Mesa —";
  }

  winnerOverlay.classList.add("open");
  winnerOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("winner-open");
}

function closeWinnerOverlay() {
  if (!winnerOverlay) return;

  winnerOverlay.classList.remove("open");
  winnerOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("winner-open");
}

winnerCloseBtn?.addEventListener("click", closeWinnerOverlay);
winnerContinueBtn?.addEventListener("click", closeWinnerOverlay);

winnerOverlay?.addEventListener("click", (event) => {
  if (event.target === winnerOverlay) {
    closeWinnerOverlay();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && winnerOverlay?.classList.contains("open")) {
    closeWinnerOverlay();
  }
});

socket.on("connect", () => {
  setConnectionState("online");
});

socket.on("disconnect", () => {
  setConnectionState("offline");
});

setConnectionState("connecting");
function getWheelContext() {
  if (!wheelCanvas) return null;
  return wheelCanvas.getContext("2d");
}

function drawWheel() {
  const ctx = getWheelContext();
  if (!ctx) return;

  const width = wheelCanvas.width;
  const height = wheelCanvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(centerX, centerY) - 8;

  ctx.clearRect(0, 0, width, height);

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(8,0,6,.96)";
  ctx.fill();

  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,0,110,.82)";
  ctx.stroke();

  const total = raffleParticipants.length;

  if (!total) {
    return;
  }

  const arc = (Math.PI * 2) / total;

  for (let index = 0; index < total; index++) {
    const participant = raffleParticipants[index];
    const key = participantKey(participant);
    const flashing = flashingParticipantKeys.has(key);

    const startAngle = wheelRotation + index * arc;
    const endAngle = startAngle + arc;

    const alternating = index % 2 === 0;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.closePath();

    if (flashing) {
      ctx.fillStyle = "rgba(255,77,166,.55)";
    } else if (alternating) {
      ctx.fillStyle = "rgba(255,0,110,.30)";
    } else {
      ctx.fillStyle = "rgba(120,0,55,.30)";
    }

    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,.15)";
    ctx.stroke();

    const middleAngle = (startAngle + endAngle) / 2;
    const textRadius = radius * 0.66;
    const textX = centerX + Math.cos(middleAngle) * textRadius;
    const textY = centerY + Math.sin(middleAngle) * textRadius;

    ctx.save();
    ctx.translate(textX, textY);
    ctx.rotate(middleAngle + Math.PI / 2);

    ctx.fillStyle = "#ffffff";
    ctx.font = flashing
      ? "900 16px Inter, system-ui"
      : "800 15px Inter, system-ui";

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const label = participantLabel(participant).slice(0, 24);

    ctx.shadowColor = "rgba(0,0,0,.85)";
    ctx.shadowBlur = 5;
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(5,0,4,.98)";
  ctx.fill();

  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,77,166,.80)";
  ctx.stroke();
}

function renderParticipants() {
  if (participantsCount) {
    participantsCount.textContent = String(raffleParticipants.length);
  }

  if (!raffleParticipants.length) {
    setTableEmpty(participantsBody, 3, "Sin participantes");
    wheelRotation = 0;
    drawWheel();

    if (raffleSpinBtn) {
      raffleSpinBtn.disabled = true;
    }

    return;
  }

  if (participantsBody) {
    participantsBody.innerHTML = raffleParticipants
      .map((participant) => {
        const key = participantKey(participant);
        const flashing = flashingParticipantKeys.has(key);

        return `
          <tr class="${flashing ? "raffle-new-row" : ""}">
            <td>
              <div class="participant-name">
                ${escapeHtml(participant.name)}
              </div>
            </td>

            <td>
              <span class="participant-table">
                Mesa ${escapeHtml(participant.table_no ?? "—")}
              </span>
            </td>

            <td class="right participant-plays">
              ${escapeHtml(participant.plays)}
              ${pluralVez(participant.plays)}
            </td>
          </tr>
        `;
      })
      .join("");
  }

  if (raffleSpinBtn) {
    raffleSpinBtn.disabled = spinning;
  }

  drawWheel();
}

function flashParticipants(keys) {
  flashingParticipantKeys = new Set(keys);

  if (flashClearTimer) {
    clearTimeout(flashClearTimer);
  }

  renderParticipants();

  flashClearTimer = setTimeout(() => {
    flashingParticipantKeys = new Set();
    renderParticipants();
  }, 2200);
}

async function loadParticipants(options = {}) {
  const {
    keepStatus = false,
    highlightNew = false,
  } = options;

  const date = raffleDate?.value || todayISO();

  if (!keepStatus) {
    setStatus("Cargando participantes…");
  }

  setTableEmpty(participantsBody, 3, "Cargando participantes…");

  try {
    const response = await fetch(
      `/api/admin/stats/top-singers-night?date=${encodeURIComponent(date)}&min=2`
    );

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "No se pudieron cargar los participantes");
    }

    const rows = (data.rows || []).map((row) => ({
      name: row.name,
      table_no: row.table_no ?? null,
      plays: Number(row.plays) || 0,
    }));

    const nextKeys = new Set(rows.map(participantKey));
    const newKeys = [];

    if (highlightNew) {
      for (const participant of rows) {
        const key = participantKey(participant);

        if (!previousParticipantKeys.has(key)) {
          newKeys.push(key);
        }
      }
    }

    raffleParticipants = rows;
    previousParticipantKeys = nextKeys;

    if (!rows.length) {
      setStatus("");
      renderParticipants();
      return;
    }

    if (newKeys.length) {
      setStatus("✨ Nuevo participante agregado a la ruleta");
      flashParticipants(newKeys);

      setTimeout(() => {
        if (
          raffleStatus?.textContent ===
          "✨ Nuevo participante agregado a la ruleta"
        ) {
          setStatus("");
        }
      }, 1800);
    } else {
      if (!keepStatus) {
        setStatus("");
      }

      renderParticipants();
    }
  } catch (error) {
    raffleParticipants = [];
    previousParticipantKeys = new Set();

    setStatus("No se pudieron cargar los participantes.");
    setTableEmpty(participantsBody, 3, "Error cargando participantes");

    if (participantsCount) {
      participantsCount.textContent = "0";
    }

    if (raffleSpinBtn) {
      raffleSpinBtn.disabled = true;
    }

    wheelRotation = 0;
    drawWheel();

    console.error(error);
  }
}
async function loadWinners() {
  const date = raffleDate?.value || todayISO();

  setTableEmpty(winnersBody, 3, "Cargando ganadores…");

  try {
    const response = await fetch(
      `/api/admin/raffle/winners?date=${encodeURIComponent(date)}`
    );

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "No se pudieron cargar los ganadores");
    }

    const rows = data.rows || [];

    if (winnersCount) {
      winnersCount.textContent = String(rows.length);
    }

    if (!rows.length) {
      setTableEmpty(winnersBody, 3, "Sin ganadores todavía");
      return;
    }

    if (winnersBody) {
      winnersBody.innerHTML = rows
        .map(
          (winner) => `
            <tr>
              <td>
                <span class="winner-time">
                  ${escapeHtml(formatTimeCL(winner.created_at))}
                </span>
              </td>

              <td>
                <div class="winner-row-name">
                  ${escapeHtml(winner.name)}
                </div>
              </td>

              <td>
                <span class="winner-badge">
                  Mesa ${escapeHtml(winner.table_no ?? "—")}
                </span>
              </td>
            </tr>
          `
        )
        .join("");
    }
  } catch (error) {
    if (winnersCount) {
      winnersCount.textContent = "0";
    }

    setTableEmpty(winnersBody, 3, "Error cargando ganadores");
    console.error(error);
  }
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function pickWinnerFromRotation() {
  const total = raffleParticipants.length;

  if (!total) return null;

  const arc = (Math.PI * 2) / total;
  const pointerAngle = -Math.PI / 2;

  const relativeAngle =
    (pointerAngle - wheelRotation) % (Math.PI * 2);

  const normalizedAngle =
    (relativeAngle + Math.PI * 2) % (Math.PI * 2);

  const index = Math.floor(normalizedAngle / arc) % total;

  return {
    index,
    ...raffleParticipants[index],
  };
}

async function saveWinner(participant) {
  const date = raffleDate?.value || todayISO();

  const response = await fetch("/api/admin/raffle/winners", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      date,
      name: participant.name,
      table: participant.table_no,
      plays: participant.plays,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "No se pudo guardar el ganador");
  }

  return data.winner;
}

async function spinWheel() {
  if (spinning) return;

  if (!raffleParticipants.length) {
    setStatus("No hay participantes para girar.");
    return;
  }

  spinning = true;

  if (raffleSpinBtn) {
    raffleSpinBtn.disabled = true;
    raffleSpinBtn.classList.add("spinning");
  }

  setStatus("Girando…");

  const baseTurns = 6;
  const extraTurns = Math.random() * 2;
  const randomAngle = Math.random() * Math.PI * 2;

  const startRotation = wheelRotation;

  const targetRotation =
    startRotation +
    (baseTurns + extraTurns) * Math.PI * 2 +
    randomAngle;

  const difference = targetRotation - startRotation;
  const duration = 3600;
  const startTime = performance.now();

  function animate(currentTime) {
    const progress = Math.min(
      1,
      (currentTime - startTime) / duration
    );

    const eased = easeOutCubic(progress);

    wheelRotation =
      startRotation +
      difference * eased;

    drawWheel();

    if (progress < 1) {
      requestAnimationFrame(animate);
      return;
    }

    finishSpin();
  }

  async function finishSpin() {
    wheelRotation =
      ((wheelRotation % (Math.PI * 2)) + Math.PI * 2) %
      (Math.PI * 2);

    drawWheel();

    const winner = pickWinnerFromRotation();

    if (!winner) {
      spinning = false;
      setStatus("");

      if (raffleSpinBtn) {
        raffleSpinBtn.disabled = false;
        raffleSpinBtn.classList.remove("spinning");
      }

      return;
    }

    const winnerKey = participantKey(winner);

    setStatus(
      `🏆 Ganador: ${winner.name}${
        winner.table_no ? ` · Mesa ${winner.table_no}` : ""
      }`
    );

    try {
      await saveWinner(winner);

      raffleParticipants = raffleParticipants.filter(
        (participant) => participantKey(participant) !== winnerKey
      );

      previousParticipantKeys = new Set(
        raffleParticipants.map(participantKey)
      );

      renderParticipants();
      await loadWinners();

      showWinnerOverlay(winner);
    } catch (error) {
      setStatus(error.message || "No se pudo guardar el ganador.");
      console.error(error);
    } finally {
      spinning = false;

      if (raffleSpinBtn) {
        raffleSpinBtn.classList.remove("spinning");
        raffleSpinBtn.disabled = raffleParticipants.length === 0;
      }
    }
  }

  requestAnimationFrame(animate);
}

raffleSpinBtn?.addEventListener("click", spinWheel);
raffleDate?.addEventListener("change", async () => {
  previousParticipantKeys = new Set();
  flashingParticipantKeys = new Set();
  wheelRotation = 0;

  await Promise.all([
    loadParticipants(),
    loadWinners(),
  ]);
});

socket.on("raffle:update", async () => {
  await Promise.all([
    loadParticipants({
      keepStatus: true,
      highlightNew: true,
    }),
    loadWinners(),
  ]);
});

fullscreenBtn?.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch {
    setStatus("No se pudo activar la pantalla completa.");
  }
});

document.addEventListener("fullscreenchange", () => {
  const active = !!document.fullscreenElement;

  document.body.classList.toggle("is-fullscreen", active);

  if (fullscreenBtn) {
    fullscreenBtn.textContent = active
      ? "⛶ Salir de pantalla completa"
      : "⛶ Pantalla completa";
  }

  setTimeout(drawWheel, 100);
});

backDjBtn?.addEventListener("click", () => {
  if (window.opener && !window.opener.closed) {
    window.opener.focus();
    window.close();
    return;
  }

  location.href = "/dj";
});

window.addEventListener("resize", () => {
  drawWheel();
});

window.addEventListener("pageshow", () => {
  if (raffleDate && !raffleDate.value) {
    raffleDate.value = todayISO();
  }
});

async function boot() {
  if (raffleDate) {
    raffleDate.value = todayISO();
  }

  drawWheel();

  await Promise.all([
    loadParticipants(),
    loadWinners(),
  ]);
}

boot();