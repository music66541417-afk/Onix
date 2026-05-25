import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";

import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcrypt";

import pg from "pg";
const { Pool } = pg;

// =======================
// PostgreSQL
// =======================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  options: "-c search_path=public",
});

pool.on("error", (err) => {
  console.log("⚠️ PG pool error:", err.message);
});

pool
  .query("SELECT 1 as ok")
  .then(() => console.log("✅ DB conectada"))
  .catch((e) => console.log("⚠️ DB aún no responde:", e.message));

// =======================
// Asegurar tablas base
// =======================
async function ensureProjectTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id SERIAL PRIMARY KEY,
        table_no TEXT NOT NULL,
        name TEXT NOT NULL,
        artist TEXT NOT NULL,
        song TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders_status (
        id INT PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE orders_status
      ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE
    `);

    await pool.query(`
      INSERT INTO orders_status (id, enabled)
      VALUES (1, TRUE)
      ON CONFLICT (id) DO NOTHING
    `);

    console.log("✅ requests / orders_status OK");
  } catch (e) {
    console.log("⚠️ No pude asegurar tablas base:", e.message);
  }
}

// =======================
// 🎁 Raffle Winners
// =======================
async function ensureRaffleWinnersTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS raffle_winners (
        id SERIAL PRIMARY KEY,
        night_day DATE NOT NULL,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        table_no TEXT,
        plays INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE raffle_winners
      ADD COLUMN IF NOT EXISTS table_no TEXT
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_raffle_winners_day
      ON raffle_winners (night_day DESC);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_raffle_winners_name_key
      ON raffle_winners (name_key);
    `);

    console.log("✅ raffle_winners OK");
  } catch (e) {
    console.log("⚠️ No pude asegurar raffle_winners:", e.message);
  }
}

// =======================
// App / Server
// =======================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// =======================
// Sessions (PostgreSQL)
// =======================
const PgSession = connectPgSimple(session);

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "session",
    }),
    secret: process.env.SESSION_SECRET || "dev_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 12,
    },
  })
);

// =======================
// Bloquear acceso directo a HTML sensibles
// =======================
app.use((req, res, next) => {
  const blocked = new Set(["/dj.html", "/admin.html"]);
  if (!blocked.has(req.path)) return next();

  if (!req.session?.user) {
    return res.redirect("/login?next=" + encodeURIComponent(req.originalUrl));
  }

  const map = {
    "/dj.html": "/dj",
    "/admin.html": "/admin",
  };

  return res.redirect(map[req.path] || "/");
});

app.use(express.static("public", { index: false }));

// =======================
// Middleware auth
// =======================
function requireDjRoute(route) {
  return (req, res, next) => {
    if (!req.session?.user) {
      return res.redirect("/login?next=" + encodeURIComponent(req.originalUrl));
    }
    if (req.session.user.dj_route && req.session.user.dj_route !== route) {
      return res.redirect(req.session.user.dj_route);
    }
    return next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ ok: false, error: "No logueado" });
  }
  if (req.session.user.dj_route !== "/admin") {
    return res.status(403).json({ ok: false, error: "Solo admin" });
  }
  return next();
}

// =======================
// Helpers DB -> payload UI
// =======================
function rowToRequest(r) {
  return {
    id: Number(r.id),
    table: r.table_no,
    name: r.name,
    artist: r.artist,
    song: r.song,
    createdAt: r.created_at,
    status: "Pendiente",
  };
}

async function getRequests() {
  const q = await pool.query(
    "SELECT id, table_no, name, artist, song, created_at FROM requests ORDER BY id ASC"
  );
  return q.rows.map(rowToRequest);
}

async function emitRequests() {
  const rows = await getRequests();
  io.emit("requests:update", rows);
}

function emitRaffleUpdate() {
  io.emit("raffle:update", {
    at: new Date().toISOString(),
  });
}

// =======================
// Estado pedidos
// =======================
let ordersOpen = true;

async function loadOrdersStatus() {
  try {
    await pool.query(`
      ALTER TABLE orders_status
      ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE
    `);

    const q = await pool.query(
      "SELECT enabled FROM orders_status WHERE id=1"
    );

    if (q.rowCount) {
      ordersOpen = !!q.rows[0].enabled;
    } else {
      await pool.query(
        "INSERT INTO orders_status (id, enabled) VALUES (1, TRUE) ON CONFLICT (id) DO NOTHING"
      );
      ordersOpen = true;
    }
  } catch (e) {
    console.log("⚠️ No pude cargar orders_status:", e.message);
    ordersOpen = true;
  }
}

function emitOrdersStatus() {
  io.emit("orders:status", { enabled: ordersOpen });
}

app.get("/api/orders-status", async (req, res) => {
  await loadOrdersStatus();
  res.json({ ok: true, ordersOpen: { enabled: ordersOpen } });
});

app.post("/api/admin/orders", requireAdmin, async (req, res) => {
  const { enabled } = req.body || {};

  if (typeof enabled !== "boolean") {
    return res.status(400).json({ ok: false, error: "Payload inválido" });
  }

  try {
    await pool.query(
      "UPDATE orders_status SET enabled=$1, updated_at=NOW() WHERE id=1",
      [enabled]
    );
    ordersOpen = enabled;
    emitOrdersStatus();
    return res.json({ ok: true, ordersOpen: { enabled: ordersOpen } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// =======================
// Health check
// =======================
app.get("/health/db", async (req, res) => {
  try {
    const r = await pool.query("SELECT 1 as ok");
    res.json({ ok: true, db: r.rows[0].ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =======================
// Horario (Servidor Chile)
// =======================
const TZ_CHILE = process.env.TZ_CHILE || "America/Santiago";
const CUTOFF_HHMM = process.env.CUTOFF_HHMM || "03:30";
const RESET_HHMM = process.env.RESET_HHMM || "12:00";

function hhmmToMinutes(hhmm) {
  const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

const cutoffMin = hhmmToMinutes(CUTOFF_HHMM) ?? 3 * 60 + 30;
const resetMin = hhmmToMinutes(RESET_HHMM) ?? 12 * 60;

function getChileMinutesNow() {
  const parts = new Intl.DateTimeFormat("es-CL", {
    timeZone: TZ_CHILE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hh * 60 + mm;
}

function isClosed(nowMin, cutoff) {
  return nowMin >= cutoff && nowMin < resetMin;
}

function rejectIfClosedByAdmin() {
  if (!ordersOpen) {
    return {
      ok: false,
      error: "Lo sentimos, pedidos no disponibles.",
      reason: "admin",
    };
  }
  return null;
}

function rejectIfClosedBySchedule() {
  const nowMin = getChileMinutesNow();

  if (isClosed(nowMin, cutoffMin)) {
    return {
      ok: false,
      error: "Las solicitudes no están disponibles en este horario.",
      tz: TZ_CHILE,
      nowMinutes: nowMin,
      cutoff: CUTOFF_HHMM,
      reset: RESET_HHMM,
      reason: "schedule",
    };
  }

  return null;
}

app.get("/api/hours", (req, res) => {
  const nowMin = getChileMinutesNow();
  res.json({
    ok: true,
    tz: TZ_CHILE,
    nowMinutes: nowMin,
    requests: {
      cutoff: CUTOFF_HHMM,
      closed: isClosed(nowMin, cutoffMin),
    },
    reset: RESET_HHMM,
  });
});

// =======================
// Auto-corte / Auto-reset
// =======================
function getChileDateKey() {
  const parts = new Intl.DateTimeFormat("es-CL", {
    timeZone: TZ_CHILE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  const d = parts.find((p) => p.type === "day")?.value ?? "00";
  return `${y}-${m}-${d}`;
}

let lastAutoClose = null;
let lastAutoReset = null;

async function autoCloseIfNeeded() {
  await loadOrdersStatus();

  const nowMin = getChileMinutesNow();
  const dayKey = getChileDateKey();

  const inWindow = nowMin >= cutoffMin && nowMin < resetMin;
  const needsClose = inWindow && ordersOpen === true && lastAutoClose !== dayKey;

  if (!needsClose) return;

  try {
    await pool.query(
      "UPDATE orders_status SET enabled=$1, updated_at=NOW() WHERE id=1",
      [false]
    );

    ordersOpen = false;
    lastAutoClose = dayKey;
    emitOrdersStatus();
  } catch (e) {
    console.log("⚠️ autoCloseIfNeeded error:", e.message);
  }
}

async function autoResetIfNeeded() {
  await loadOrdersStatus();

  const nowMin = getChileMinutesNow();
  const dayKey = getChileDateKey();

  const inResetWindow = nowMin >= resetMin && nowMin < resetMin + 2;
  if (!inResetWindow || lastAutoReset === dayKey) return;

  try {
    await pool.query(
      "UPDATE orders_status SET enabled=$1, updated_at=NOW() WHERE id=1",
      [true]
    );

    ordersOpen = true;
    lastAutoClose = null;
    lastAutoReset = dayKey;

    emitOrdersStatus();
  } catch (e) {
    console.log("⚠️ autoResetIfNeeded error:", e.message);
  }
}

setInterval(() => {
  autoCloseIfNeeded().catch(() => {});
  autoResetIfNeeded().catch(() => {});
}, 30_000);

// =======================
// Rutas páginas
// =======================
app.get("/qr", (req, res) =>
  res.sendFile(process.cwd() + "/public/index.html")
);

app.get("/login", (req, res) =>
  res.sendFile(process.cwd() + "/public/login.html")
);

app.get("/dj", requireDjRoute("/dj"), (req, res) =>
  res.sendFile(process.cwd() + "/public/dj.html")
);

app.get("/admin", requireDjRoute("/admin"), (req, res) =>
  res.sendFile(process.cwd() + "/public/admin.html")
);

// =======================
// Login / Auth
// =======================
app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;

  const q = await pool.query(
    "SELECT id, username, password_hash, dj_route FROM dj_users WHERE username=$1",
    [username]
  );

  if (!q.rowCount) {
    return res.json({ ok: false, error: "Usuario incorrecto" });
  }

  const user = q.rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);

  if (!ok) {
    return res.json({ ok: false, error: "Clave incorrecta" });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    dj_route: user.dj_route,
  };

  return res.json({ ok: true, next: user.dj_route });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// =======================
// Validación payload
// =======================
function validatePayload({ table, name, artist, song }) {
  if (!/^\d{1,3}$/.test(String(table ?? ""))) return "Mesa inválida";
  if (!name || name.length > 40) return "Nombre inválido";
  if (!artist || artist.length > 40) return "Artista inválido";
  if (!song || song.length > 40) return "Canción inválida";
  return null;
}

// =======================
// Anti-spam servidor
// =======================
const REQUEST_COOLDOWN_MS = 15000;
const lastRequestByKey = new Map();

function checkCooldownOrNull(key) {
  const now = Date.now();
  const last = lastRequestByKey.get(key) || 0;
  const diff = now - last;

  if (diff < REQUEST_COOLDOWN_MS) {
    const wait = Math.ceil((REQUEST_COOLDOWN_MS - diff) / 1000);
    return { wait };
  }

  lastRequestByKey.set(key, now);

  if (lastRequestByKey.size > 8000) {
    const cutoff = now - 10 * 60 * 1000;
    for (const [k, ts] of lastRequestByKey.entries()) {
      if (ts < cutoff) lastRequestByKey.delete(k);
    }
    if (lastRequestByKey.size > 12000) lastRequestByKey.clear();
  }

  return null;
}

// =======================
// Keys helpers
// =======================
function normalizeKey(x) {
  return String(x ?? "").trim().toLowerCase().replace(/\s+/g, " ").trim();
}

function makeSongKey(song, artist) {
  const s = normalizeKey(song);
  const a = normalizeKey(artist);
  const key = `${s}|${a}`.trim();
  return key || "unknown_song";
}

function makeArtistKey(artist) {
  const a = normalizeKey(artist);
  return a || "unknown_artist";
}

async function insertPlaySafe({
  table_no,
  name,
  artist,
  song,
  requested_at,
}) {
  const song_key = makeSongKey(song, artist);
  const artist_key = makeArtistKey(artist);

  try {
    return await pool.query(
      `
      INSERT INTO plays (table_no, name, artist, song, song_key, artist_key, requested_at, played_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7, NOW())
      RETURNING id
      `,
      [table_no, name, artist, song, song_key, artist_key, requested_at]
    );
  } catch (e) {
    if (e && e.code === "42703") {
      try {
        return await pool.query(
          `
          INSERT INTO plays (table_no, name, artist, song, song_key, requested_at, played_at)
          VALUES ($1,$2,$3,$4,$5,$6, NOW())
          RETURNING id
          `,
          [table_no, name, artist, song, song_key, requested_at]
        );
      } catch (e2) {
        if (e2 && e2.code === "42703") {
          return await pool.query(
            `
            INSERT INTO plays (table_no, name, artist, song, requested_at, played_at)
            VALUES ($1,$2,$3,$4,$5, NOW())
            RETURNING id
            `,
            [table_no, name, artist, song, requested_at]
          );
        }
        throw e2;
      }
    }
    throw e;
  }
}

// =======================
// Requests
// =======================
app.post("/api/requests", async (req, res) => {
  await loadOrdersStatus();

  const closedByAdmin = rejectIfClosedByAdmin();
  if (closedByAdmin) return res.status(403).json(closedByAdmin);

  const closedBySchedule = rejectIfClosedBySchedule();
  if (closedBySchedule) return res.status(403).json(closedBySchedule);

  const error = validatePayload(req.body);
  if (error) return res.status(400).json({ ok: false, error });

  try {
    const { table, name, artist, song } = req.body;

    const key = `mesa:${String(table)}`;
    const cd = checkCooldownOrNull(key);

    if (cd) {
      return res.status(429).json({
        ok: false,
        error: `⏳ Espera ${cd.wait}s antes de enviar otra solicitud.`,
        reason: "cooldown",
      });
    }

    const q = await pool.query(
      `INSERT INTO requests (table_no, name, artist, song)
       VALUES ($1,$2,$3,$4)
       RETURNING id, table_no, name, artist, song, created_at`,
      [String(table), name, artist, song]
    );

    await emitRequests();
    return res.json({ ok: true, item: rowToRequest(q.rows[0]) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/requests", async (req, res) => {
  try {
    const requests = await getRequests();
    res.json({ ok: true, requests });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete("/api/requests/:id", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const removed = await pool.query(
      `DELETE FROM requests WHERE id=$1
       RETURNING table_no, name, artist, song, created_at`,
      [id]
    );

    if (!removed.rowCount) {
      await emitRequests();
      return res.json({ ok: true, playedLogged: false });
    }

    const r = removed.rows[0];

    await insertPlaySafe({
      table_no: r.table_no,
      name: r.name,
      artist: r.artist,
      song: r.song,
      requested_at: r.created_at,
    });

    await emitRequests();
    emitRaffleUpdate();
    return res.json({ ok: true, playedLogged: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete("/api/requests", async (req, res) => {
  try {
    await pool.query("DELETE FROM requests");
    await emitRequests();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =======================
// Admin Stats
// =======================
function parseDays(x, fallback) {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0 || n > 3650) return fallback;
  return Math.floor(n);
}

app.get("/api/admin/stats/summary", requireAdmin, async (req, res) => {
  const days = parseDays(req.query.days, 30);

  try {
    const q = await pool.query(
      `
      SELECT
        COUNT(*)::int AS total
      FROM plays
      WHERE played_at >= NOW() - ($1 || ' days')::interval
      `,
      [days]
    );

    res.json({ ok: true, days, total: q.rows[0]?.total ?? 0 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/admin/stats/top-songs", requireAdmin, async (req, res) => {
  const days = parseDays(req.query.days, 30);
  const limit = 5;

  try {
    const q = await pool.query(
      `
      SELECT song, artist, COUNT(*)::int AS plays
      FROM plays
      WHERE played_at >= NOW() - ($1 || ' days')::interval
      GROUP BY song, artist
      ORDER BY plays DESC
      LIMIT ${limit}
      `,
      [days]
    );

    res.json({ ok: true, days, rows: q.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/admin/stats/top-artists", requireAdmin, async (req, res) => {
  const days = parseDays(req.query.days, 30);
  const limit = 5;

  try {
    const q = await pool.query(
      `
      SELECT artist, COUNT(*)::int AS plays
      FROM plays
      WHERE played_at >= NOW() - ($1 || ' days')::interval
      GROUP BY artist
      ORDER BY plays DESC
      LIMIT ${limit}
      `,
      [days]
    );

    res.json({ ok: true, days, rows: q.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/admin/stats/by-day", requireAdmin, async (req, res) => {
  const days = parseDays(req.query.days, 30);
  const limit = 5;

  try {
    const q = await pool.query(
      `
      WITH p AS (
        SELECT
          CASE
            WHEN ((played_at AT TIME ZONE $2)::time < time '05:00')
              THEN ((played_at AT TIME ZONE $2)::date - 1)
            ELSE (played_at AT TIME ZONE $2)::date
          END AS night_day
        FROM plays
        WHERE played_at >= NOW() - ($1 || ' days')::interval
      )
      SELECT night_day AS day, COUNT(*)::int AS plays
      FROM p
      GROUP BY night_day
      ORDER BY night_day DESC
      LIMIT ${limit}
      `,
      [days, TZ_CHILE]
    );

    res.json({ ok: true, days, limit, rows: q.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =======================
// Historial / noche
// =======================
function isValidISODateOnly(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

app.get("/api/admin/stats/by-day-one", requireAdmin, async (req, res) => {
  const date = isValidISODateOnly(req.query.date) ? String(req.query.date) : null;
  if (!date) {
    return res.status(400).json({ ok: false, error: "date inválido (YYYY-MM-DD)" });
  }

  try {
    const q = await pool.query(
      `
      WITH p AS (
        SELECT
          CASE
            WHEN ((played_at AT TIME ZONE $2)::time < time '05:00')
              THEN ((played_at AT TIME ZONE $2)::date - 1)
            ELSE (played_at AT TIME ZONE $2)::date
          END AS night_day
        FROM plays
      )
      SELECT COUNT(*)::int AS plays
      FROM p
      WHERE night_day = ($1)::date
      `,
      [date, TZ_CHILE]
    );

    return res.json({ ok: true, date, plays: q.rows?.[0]?.plays ?? 0 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

function getChileNightDateKey() {
  const nowMin = getChileMinutesNow();
  const dateKey = getChileDateKey();

  if (nowMin < 5 * 60) {
    const [yy, mm, dd] = dateKey.split("-").map((x) => Number(x));
    const utc = new Date(Date.UTC(yy, mm - 1, dd, 12, 0, 0));
    utc.setUTCDate(utc.getUTCDate() - 1);
    const y = utc.getUTCFullYear();
    const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
    const d = String(utc.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  return dateKey;
}

app.get("/api/admin/history", requireAdmin, async (req, res) => {
  const date = isValidISODateOnly(req.query.date)
    ? String(req.query.date)
    : getChileNightDateKey();

  try {
    const q = await pool.query(
      `
      WITH win AS (
        SELECT
          (((($1)::date) + time '19:00') AT TIME ZONE $2) AS start_ts,
          (((($1)::date + 1) + time '05:00') AT TIME ZONE $2) AS end_ts
      )
      SELECT
        id,
        table_no,
        name,
        artist,
        song,
        requested_at,
        played_at,
        GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (played_at - requested_at)) / 60))::int AS wait_min
      FROM plays, win
      WHERE requested_at >= win.start_ts
        AND requested_at < win.end_ts
      ORDER BY requested_at ASC, id ASC
      `,
      [date, TZ_CHILE]
    );

    return res.json({
      ok: true,
      date,
      window: { startHHMM: "19:00", endHHMM: "05:00", tz: TZ_CHILE },
      rows: q.rows,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// =======================
// Top cantantes noche / ruleta
// =======================
app.get("/api/admin/stats/top-singers-night", requireAdmin, async (req, res) => {
  const date = isValidISODateOnly(req.query.date)
    ? String(req.query.date)
    : getChileNightDateKey();

  const minRaw = Number(req.query.min ?? 2);
  const min =
    Number.isFinite(minRaw) && minRaw >= 1 && minRaw <= 50 ? Math.floor(minRaw) : 2;

  try {
    const q = await pool.query(
      `
      WITH win AS (
        SELECT
          (((($1)::date) + time '19:00') AT TIME ZONE $2) AS start_ts,
          (((($1)::date + 1) + time '05:00') AT TIME ZONE $2) AS end_ts
      )
      SELECT
        p.name,
        p.table_no::text AS table_no,
        COUNT(*)::int AS plays
      FROM plays p, win
      WHERE p.played_at >= win.start_ts
        AND p.played_at < win.end_ts
        AND NOT EXISTS (
          SELECT 1
          FROM raffle_winners rw
          WHERE rw.night_day = $1::date
            AND rw.name_key = lower(trim(p.name))
            AND COALESCE(lower(trim(rw.table_no::text)), '') = COALESCE(lower(trim(p.table_no::text)), '')
        )
      GROUP BY p.name, p.table_no::text
      HAVING COUNT(*) >= $3
      ORDER BY plays DESC, p.name ASC, p.table_no::text ASC
      LIMIT 200
      `,
      [date, TZ_CHILE, min]
    );

    return res.json({
      ok: true,
      date,
      min,
      window: { startHHMM: "19:00", endHHMM: "05:00", tz: TZ_CHILE },
      rows: q.rows,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// =======================
// Raffle winners
// =======================
function normalizeNameKey(x) {
  return String(x ?? "").trim().toLowerCase().replace(/\s+/g, " ").trim();
}

app.get("/api/admin/raffle/winners", requireAdmin, async (req, res) => {
  const date = isValidISODateOnly(req.query.date)
    ? String(req.query.date)
    : getChileNightDateKey();

  try {
    const q = await pool.query(
      `
      SELECT id, night_day, name, table_no, plays, created_at
      FROM raffle_winners
      WHERE night_day = $1::date
      ORDER BY created_at DESC, id DESC
      LIMIT 50
      `,
      [date]
    );

    return res.json({ ok: true, date, rows: q.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/admin/raffle/winners", requireAdmin, async (req, res) => {
  const date = isValidISODateOnly(req.body?.date)
    ? String(req.body.date)
    : getChileNightDateKey();

  const name = String(req.body?.name ?? "").trim();
  if (!name || name.length > 80) {
    return res.status(400).json({ ok: false, error: "name inválido" });
  }

  const table_no = String(req.body?.table ?? "").trim() || null;

  const playsRaw = Number(req.body?.plays ?? 0);
  const plays =
    Number.isFinite(playsRaw) && playsRaw >= 0 ? Math.floor(playsRaw) : 0;

  const name_key = normalizeNameKey(name);

  try {
    const ins = await pool.query(
      `
      INSERT INTO raffle_winners (night_day, name, name_key, table_no, plays)
      VALUES ($1::date, $2, $3, $4, $5)
      RETURNING id, night_day, name, table_no, plays, created_at
      `,
      [date, name, name_key, table_no, plays]
    );

    emitRaffleUpdate();

    return res.json({ ok: true, winner: ins.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// =======================
// Socket
// =======================
io.on("connection", async (socket) => {
  await loadOrdersStatus();
  socket.emit("orders:status", { enabled: ordersOpen });

  try {
    socket.emit("requests:update", await getRequests());
  } catch {
    socket.emit("requests:update", []);
  }
});

// =======================
// Start
// =======================
const PORT = process.env.PORT || 3000;

(async () => {
  await ensureProjectTables().catch(() => {});
  await loadOrdersStatus();
  await ensureRaffleWinnersTable().catch(() => {});
  await autoCloseIfNeeded().catch(() => {});
  await autoResetIfNeeded().catch(() => {});

  server.listen(PORT, "0.0.0.0", async () => {
    console.log(`🚀 http://localhost:${PORT}`);
    console.log(`Clientes: http://localhost:${PORT}/qr`);
    console.log(`DJ:       http://localhost:${PORT}/dj`);
    console.log(`Admin:    http://localhost:${PORT}/admin`);
    console.log("DATABASE_URL cargada:", !!process.env.DATABASE_URL);
    console.log("🟢 ordersOpen inicial (DB):", ordersOpen);

    emitOrdersStatus();
    await emitRequests();
  });
})();