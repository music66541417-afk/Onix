import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";

import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcrypt";

import pg from "pg";
const { Pool } = pg;

/* =========================================================
   POSTGRESQL
========================================================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  options: "-c search_path=public",
});

pool.on("error", (error) => {
  console.log("⚠️ PG pool error:", error.message);
});

pool
  .query("SELECT 1 AS ok")
  .then(() => {
    console.log("✅ DB conectada");
  })
  .catch((error) => {
    console.log("⚠️ DB aún no responde:", error.message);
  });

/* =========================================================
   TABLAS PRINCIPALES
========================================================= */

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
      ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
    `);

    await pool.query(`
      INSERT INTO orders_status (
        id,
        enabled
      )
      VALUES (
        1,
        TRUE
      )
      ON CONFLICT (id) DO NOTHING;
    `);

    console.log("✅ requests / orders_status OK");
  } catch (error) {
    console.log(
      "⚠️ No pude asegurar tablas principales:",
      error.message
    );
  }
}

/* =========================================================
   TABLA DE GANADORES DE RULETA
========================================================= */

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
      ADD COLUMN IF NOT EXISTS table_no TEXT;
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
  } catch (error) {
    console.log(
      "⚠️ No pude asegurar raffle_winners:",
      error.message
    );
  }
}

/* =========================================================
   NUEVA TABLA: REPRODUCCIÓN DE LA PANTALLA DE TV

   Esta tabla guarda la canción que el DJ marcó como
   "Ahora sonando".

   Se guarda en PostgreSQL para que no se pierda aunque:
   - la Smart TV recargue la página;
   - Railway reinicie;
   - se cierre y vuelva a abrir el navegador.
========================================================= */

async function ensurePlaybackStatusTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS playback_status (
        id INT PRIMARY KEY,
        request_id INT,
        table_no TEXT,
        name TEXT,
        artist TEXT,
        song TEXT,
        requested_at TIMESTAMPTZ,
        started_at TIMESTAMPTZ,
        is_playing BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE playback_status
      ADD COLUMN IF NOT EXISTS request_id INT;
    `);

    await pool.query(`
      ALTER TABLE playback_status
      ADD COLUMN IF NOT EXISTS table_no TEXT;
    `);

    await pool.query(`
      ALTER TABLE playback_status
      ADD COLUMN IF NOT EXISTS name TEXT;
    `);

    await pool.query(`
      ALTER TABLE playback_status
      ADD COLUMN IF NOT EXISTS artist TEXT;
    `);

    await pool.query(`
      ALTER TABLE playback_status
      ADD COLUMN IF NOT EXISTS song TEXT;
    `);

    await pool.query(`
      ALTER TABLE playback_status
      ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;
    `);

    await pool.query(`
      ALTER TABLE playback_status
      ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
    `);

    await pool.query(`
      ALTER TABLE playback_status
      ADD COLUMN IF NOT EXISTS is_playing BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    await pool.query(`
      ALTER TABLE playback_status
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);

    await pool.query(`
      INSERT INTO playback_status (
        id,
        is_playing
      )
      VALUES (
        1,
        FALSE
      )
      ON CONFLICT (id) DO NOTHING;
    `);

    console.log("✅ playback_status OK");
  } catch (error) {
    console.log(
      "⚠️ No pude asegurar playback_status:",
      error.message
    );
  }
}

/* =========================================================
   APLICACIÓN Y SOCKET.IO
========================================================= */

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
});

app.disable("x-powered-by");
app.use(express.json({ limit: "200kb" }));

/* =========================================================
   SESIONES GUARDADAS EN POSTGRESQL
========================================================= */

const PgSession = connectPgSimple(session);

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "session",
    }),

    secret:
      process.env.SESSION_SECRET ||
      "dev_secret",

    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 12,
    },
  })
);

/* =========================================================
   BLOQUEAR HTML PRIVADOS

   pantalla.html NO se bloquea porque la televisión debe
   entrar directamente a /pantalla sin iniciar sesión.
========================================================= */

app.use((req, res, next) => {
  const blockedPages = new Set([
    "/dj.html",
    "/admin.html",
    "/ruleta.html",
  ]);

  if (!blockedPages.has(req.path)) {
    return next();
  }

  if (!req.session?.user) {
    return res.redirect(
      "/login?next=" +
        encodeURIComponent(req.originalUrl)
    );
  }

  const redirects = {
    "/dj.html": "/dj",
    "/admin.html": "/admin",
    "/ruleta.html": "/ruleta",
  };

  return res.redirect(
    redirects[req.path] || "/"
  );
});

/* =========================================================
   ARCHIVOS PÚBLICOS
========================================================= */

app.use(
  express.static("public", {
    index: false,
    maxAge: 0,
  })
);

/* =========================================================
   AUTORIZACIÓN
========================================================= */

function requireDjRoute(route) {
  return (req, res, next) => {
    if (!req.session?.user) {
      return res.redirect(
        "/login?next=" +
          encodeURIComponent(req.originalUrl)
      );
    }

    const userRoute =
      req.session.user.dj_route;

    if (
      userRoute &&
      userRoute !== route
    ) {
      return res.redirect(userRoute);
    }

    return next();
  };
}

function requireLoggedUser(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({
      ok: false,
      error: "No logueado",
    });
  }

  return next();
}

function requireAdmin(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({
      ok: false,
      error: "No logueado",
    });
  }

  if (
    req.session.user.dj_route !==
    "/admin"
  ) {
    return res.status(403).json({
      ok: false,
      error: "Solo admin",
    });
  }

  return next();
}

/*
  Este permiso permite usar funciones del DJ tanto al
  usuario /dj como al administrador.
*/

function requireDjAccess(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({
      ok: false,
      error: "No logueado",
    });
  }

  const allowedRoutes = new Set([
    "/dj",
    "/admin",
  ]);

  if (
    !allowedRoutes.has(
      req.session.user.dj_route
    )
  ) {
    return res.status(403).json({
      ok: false,
      error:
        "Sin permiso para controlar la reproducción",
    });
  }

  return next();
}

/*
  DJ y administrador pueden entrar a la ruleta.
*/

function requireRaffleAccess(
  req,
  res,
  next
) {
  if (!req.session?.user) {
    const isApi =
      req.path.startsWith("/api/");

    if (isApi) {
      return res.status(401).json({
        ok: false,
        error: "No logueado",
      });
    }

    return res.redirect(
      "/login?next=" +
        encodeURIComponent(req.originalUrl)
    );
  }

  const allowedRoutes = new Set([
    "/dj",
    "/admin",
  ]);

  if (
    !allowedRoutes.has(
      req.session.user.dj_route
    )
  ) {
    const isApi =
      req.path.startsWith("/api/");

    if (isApi) {
      return res.status(403).json({
        ok: false,
        error:
          "Sin permiso para usar la ruleta",
      });
    }

    return res.redirect(
      req.session.user.dj_route ||
        "/login"
    );
  }

  return next();
}

/* =========================================================
   SOLICITUDES: CONVERSIÓN Y CONSULTAS
========================================================= */

function rowToRequest(row) {
  return {
    id: Number(row.id),
    table: row.table_no,
    name: row.name,
    artist: row.artist,
    song: row.song,
    createdAt: row.created_at,
    status: "Pendiente",
  };
}

async function getRequests() {
  const result = await pool.query(`
    SELECT
      id,
      table_no,
      name,
      artist,
      song,
      created_at
    FROM requests
    ORDER BY
      id ASC;
  `);

  return result.rows.map(rowToRequest);
}

async function getRequestById(id) {
  const result = await pool.query(
    `
      SELECT
        id,
        table_no,
        name,
        artist,
        song,
        created_at
      FROM requests
      WHERE id = $1
      LIMIT 1;
    `,
    [id]
  );

  if (!result.rowCount) {
    return null;
  }

  return result.rows[0];
}

async function emitRequests() {
  try {
    const rows = await getRequests();

    io.emit(
      "requests:update",
      rows
    );

    return rows;
  } catch (error) {
    console.log(
      "⚠️ emitRequests:",
      error.message
    );

    io.emit(
      "requests:update",
      []
    );

    return [];
  }
}

function emitRaffleUpdate() {
  io.emit("raffle:update", {
    at: new Date().toISOString(),
  });
}

/* =========================================================
   REPRODUCCIÓN PARA LA PANTALLA DE TV
========================================================= */

function emptyPlayback() {
  return {
    isPlaying: false,
    requestId: null,
    table: null,
    name: null,
    artist: null,
    song: null,
    requestedAt: null,
    startedAt: null,
    updatedAt: null,
  };
}

function rowToPlayback(row) {
  if (
    !row ||
    !row.is_playing
  ) {
    return emptyPlayback();
  }

  return {
    isPlaying: true,

    requestId:
      row.request_id !== null &&
      row.request_id !== undefined
        ? Number(row.request_id)
        : null,

    table:
      row.table_no ?? null,

    name:
      row.name ?? null,

    artist:
      row.artist ?? null,

    song:
      row.song ?? null,

    requestedAt:
      row.requested_at ?? null,

    startedAt:
      row.started_at ?? null,

    updatedAt:
      row.updated_at ?? null,
  };
}

async function getPlaybackStatus() {
  const result = await pool.query(`
    SELECT
      request_id,
      table_no,
      name,
      artist,
      song,
      requested_at,
      started_at,
      is_playing,
      updated_at
    FROM playback_status
    WHERE id = 1
    LIMIT 1;
  `);

  if (!result.rowCount) {
    return emptyPlayback();
  }

  return rowToPlayback(
    result.rows[0]
  );
}

async function emitPlaybackStatus() {
  try {
    const playback =
      await getPlaybackStatus();

    io.emit(
      "playback:update",
      playback
    );

    return playback;
  } catch (error) {
    console.log(
      "⚠️ emitPlaybackStatus:",
      error.message
    );

    const playback =
      emptyPlayback();

    io.emit(
      "playback:update",
      playback
    );

    return playback;
  }
}

async function clearPlaybackStatus() {
  await pool.query(`
    UPDATE playback_status
    SET
      request_id = NULL,
      table_no = NULL,
      name = NULL,
      artist = NULL,
      song = NULL,
      requested_at = NULL,
      started_at = NULL,
      is_playing = FALSE,
      updated_at = NOW()
    WHERE id = 1;
  `);

  return emitPlaybackStatus();
}

async function clearPlaybackIfRequestMatches(
  requestId
) {
  const current =
    await getPlaybackStatus();

  if (
    !current.isPlaying ||
    Number(current.requestId) !==
      Number(requestId)
  ) {
    return current;
  }

  return clearPlaybackStatus();
}

/* =========================================================
   ESTADO DE PEDIDOS
========================================================= */

let ordersOpen = true;

async function loadOrdersStatus() {
  try {
    const result = await pool.query(`
      SELECT enabled
      FROM orders_status
      WHERE id = 1
      LIMIT 1;
    `);

    if (result.rowCount) {
      ordersOpen =
        !!result.rows[0].enabled;

      return ordersOpen;
    }

    await pool.query(`
      INSERT INTO orders_status (
        id,
        enabled
      )
      VALUES (
        1,
        TRUE
      )
      ON CONFLICT (id) DO NOTHING;
    `);

    ordersOpen = true;
    return ordersOpen;
  } catch (error) {
    console.log(
      "⚠️ No pude cargar orders_status:",
      error.message
    );

    ordersOpen = true;
    return ordersOpen;
  }
}

function emitOrdersStatus() {
  io.emit("orders:status", {
    enabled: ordersOpen,
  });
}

app.get(
  "/api/orders-status",
  async (req, res) => {
    await loadOrdersStatus();

    return res.json({
      ok: true,

      ordersOpen: {
        enabled: ordersOpen,
      },
    });
  }
);

app.post(
  "/api/admin/orders",
  requireAdmin,
  async (req, res) => {
    const { enabled } =
      req.body || {};

    if (
      typeof enabled !==
      "boolean"
    ) {
      return res.status(400).json({
        ok: false,
        error: "Payload inválido",
      });
    }

    try {
      await pool.query(
        `
          UPDATE orders_status
          SET
            enabled = $1,
            updated_at = NOW()
          WHERE id = 1;
        `,
        [enabled]
      );

      ordersOpen = enabled;
      emitOrdersStatus();

      return res.json({
        ok: true,

        ordersOpen: {
          enabled: ordersOpen,
        },
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message,
      });
    }
  }
);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  "/health/db",
  async (req, res) => {
    try {
      const result =
        await pool.query(
          "SELECT 1 AS ok"
        );

      return res.json({
        ok: true,
        db: result.rows[0].ok,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message,
      });
    }
  }
);

/* =========================================================
   HORARIOS DEL SERVIDOR
========================================================= */

const TZ_CHILE =
  process.env.TZ_CHILE ||
  "America/Santiago";

const CUTOFF_HHMM =
  process.env.CUTOFF_HHMM ||
  "03:30";

const RESET_HHMM =
  process.env.RESET_HHMM ||
  "12:00";

function hhmmToMinutes(hhmm) {
  const match =
    String(hhmm || "").match(
      /^(\d{1,2}):(\d{2})$/
    );

  if (!match) {
    return null;
  }

  const hours =
    Number(match[1]);

  const minutes =
    Number(match[2]);

  if (
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return (
    hours * 60 +
    minutes
  );
}

const cutoffMin =
  hhmmToMinutes(CUTOFF_HHMM) ??
  3 * 60 + 30;

const resetMin =
  hhmmToMinutes(RESET_HHMM) ??
  12 * 60;

function getChileMinutesNow() {
  const parts =
    new Intl.DateTimeFormat(
      "es-CL",
      {
        timeZone: TZ_CHILE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }
    ).formatToParts(
      new Date()
    );

  const hours = Number(
    parts.find(
      (part) =>
        part.type === "hour"
    )?.value ?? "0"
  );

  const minutes = Number(
    parts.find(
      (part) =>
        part.type === "minute"
    )?.value ?? "0"
  );

  return (
    hours * 60 +
    minutes
  );
}

function isClosed(
  nowMinutes,
  cutoffMinutes
) {
  return (
    nowMinutes >=
      cutoffMinutes &&
    nowMinutes < resetMin
  );
}

function rejectIfClosedByAdmin() {
  if (ordersOpen) {
    return null;
  }

  return {
    ok: false,
    error:
      "Lo sentimos, pedidos no disponibles.",
    reason: "admin",
  };
}

function rejectIfClosedBySchedule() {
  const nowMinutes =
    getChileMinutesNow();

  if (
    !isClosed(
      nowMinutes,
      cutoffMin
    )
  ) {
    return null;
  }

  return {
    ok: false,

    error:
      "Las solicitudes no están disponibles en este horario.",

    tz: TZ_CHILE,
    nowMinutes,
    cutoff: CUTOFF_HHMM,
    reset: RESET_HHMM,
    reason: "schedule",
  };
}

app.get(
  "/api/hours",
  (req, res) => {
    const nowMinutes =
      getChileMinutesNow();

    return res.json({
      ok: true,
      tz: TZ_CHILE,
      nowMinutes,

      requests: {
        cutoff: CUTOFF_HHMM,

        closed: isClosed(
          nowMinutes,
          cutoffMin
        ),
      },

      reset: RESET_HHMM,
    });
  }
);

/* =========================================================
   AUTO-CIERRE Y AUTO-REINICIO DE PEDIDOS
========================================================= */

function getChileDateKey() {
  const parts =
    new Intl.DateTimeFormat(
      "es-CL",
      {
        timeZone: TZ_CHILE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }
    ).formatToParts(
      new Date()
    );

  const year =
    parts.find(
      (part) =>
        part.type === "year"
    )?.value ?? "0000";

  const month =
    parts.find(
      (part) =>
        part.type === "month"
    )?.value ?? "00";

  const day =
    parts.find(
      (part) =>
        part.type === "day"
    )?.value ?? "00";

  return `${year}-${month}-${day}`;
}

let lastAutoClose = null;
let lastAutoReset = null;

async function autoCloseIfNeeded() {
  await loadOrdersStatus();

  const nowMinutes =
    getChileMinutesNow();

  const currentDay =
    getChileDateKey();

  const insideClosedWindow =
    nowMinutes >= cutoffMin &&
    nowMinutes < resetMin;

  const shouldClose =
    insideClosedWindow &&
    ordersOpen === true &&
    lastAutoClose !== currentDay;

  if (!shouldClose) {
    return;
  }

  try {
    await pool.query(
      `
        UPDATE orders_status
        SET
          enabled = FALSE,
          updated_at = NOW()
        WHERE id = 1;
      `
    );

    ordersOpen = false;
    lastAutoClose = currentDay;

    emitOrdersStatus();

    console.log(
      "🔴 Pedidos cerrados automáticamente"
    );
  } catch (error) {
    console.log(
      "⚠️ autoCloseIfNeeded:",
      error.message
    );
  }
}

async function autoResetIfNeeded() {
  await loadOrdersStatus();

  const nowMinutes =
    getChileMinutesNow();

  const currentDay =
    getChileDateKey();

  const insideResetWindow =
    nowMinutes >= resetMin &&
    nowMinutes < resetMin + 2;

  const shouldReset =
    insideResetWindow &&
    lastAutoReset !== currentDay;

  if (!shouldReset) {
    return;
  }

  try {
    await pool.query(
      `
        UPDATE orders_status
        SET
          enabled = TRUE,
          updated_at = NOW()
        WHERE id = 1;
      `
    );

    ordersOpen = true;
    lastAutoClose = null;
    lastAutoReset = currentDay;

    emitOrdersStatus();

    console.log(
      "🟢 Pedidos reiniciados automáticamente"
    );
  } catch (error) {
    console.log(
      "⚠️ autoResetIfNeeded:",
      error.message
    );
  }
}

setInterval(() => {
  autoCloseIfNeeded()
    .catch(() => {});

  autoResetIfNeeded()
    .catch(() => {});
}, 30_000);

/* =========================================================
   RUTAS DE LAS PÁGINAS
========================================================= */

app.get(
  "/",
  (req, res) => {
    return res.redirect("/qr");
  }
);

app.get(
  "/qr",
  (req, res) => {
    return res.sendFile(
      process.cwd() +
        "/public/index.html"
    );
  }
);

app.get(
  "/login",
  (req, res) => {
    return res.sendFile(
      process.cwd() +
        "/public/login.html"
    );
  }
);

app.get(
  "/dj",
  requireDjRoute("/dj"),
  (req, res) => {
    return res.sendFile(
      process.cwd() +
        "/public/dj.html"
    );
  }
);

app.get(
  "/admin",
  requireDjRoute("/admin"),
  (req, res) => {
    return res.sendFile(
      process.cwd() +
        "/public/admin.html"
    );
  }
);

app.get(
  "/ruleta",
  requireRaffleAccess,
  (req, res) => {
    return res.sendFile(
      process.cwd() +
        "/public/ruleta.html"
    );
  }
);

/*
  PÁGINA PÚBLICA PARA LA SMART TV

  No requiere inicio de sesión.

  La televisión solamente debe abrir:

  https://tudominio.cl/pantalla
*/

app.get(
  "/pantalla",
  (req, res) => {
    return res.sendFile(
      process.cwd() +
        "/public/pantalla.html"
    );
  }
);

/* =========================================================
   LOGIN Y CIERRE DE SESIÓN
========================================================= */

app.post(
  "/auth/login",
  async (req, res) => {
    const username =
      String(
        req.body?.username ?? ""
      ).trim();

    const password =
      String(
        req.body?.password ?? ""
      );

    if (
      !username ||
      !password
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Usuario y contraseña requeridos",
      });
    }

    try {
      const result =
        await pool.query(
          `
            SELECT
              id,
              username,
              password_hash,
              dj_route
            FROM dj_users
            WHERE username = $1
            LIMIT 1;
          `,
          [username]
        );

      if (!result.rowCount) {
        return res.json({
          ok: false,
          error:
            "Usuario incorrecto",
        });
      }

      const user =
        result.rows[0];

      const passwordMatches =
        await bcrypt.compare(
          password,
          user.password_hash
        );

      if (!passwordMatches) {
        return res.json({
          ok: false,
          error:
            "Clave incorrecta",
        });
      }

      req.session.user = {
        id: user.id,
        username:
          user.username,
        dj_route:
          user.dj_route,
      };

      return res.json({
        ok: true,
        next:
          user.dj_route ||
          "/dj",
      });
    } catch (error) {
      console.log(
        "⚠️ Error login:",
        error.message
      );

      return res.status(500).json({
        ok: false,
        error:
          "No se pudo iniciar sesión",
      });
    }
  }
);

app.post(
  "/auth/logout",
  (req, res) => {
    req.session.destroy(
      (error) => {
        if (error) {
          return res.status(500).json({
            ok: false,
            error:
              "No se pudo cerrar sesión",
          });
        }

        return res.json({
          ok: true,
        });
      }
    );
  }
);

/* =========================================================
   API PÚBLICA DE LA PANTALLA

   Devuelve:
   - canción actual;
   - cola completa;
   - estado de pedidos.
========================================================= */

app.get(
  "/api/screen",
  async (req, res) => {
    try {
      const [
        playback,
        queue,
      ] =
        await Promise.all([
          getPlaybackStatus(),
          getRequests(),
        ]);

      await loadOrdersStatus();

      return res.json({
        ok: true,
        playback,
        queue,
        ordersOpen: {
          enabled:
            ordersOpen,
        },
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error:
          error.message,
      });
    }
  }
);

/*
  Permite consultar solamente la canción actual.
  Esta ruta también es pública para la televisión.
*/

app.get(
  "/api/playback",
  async (req, res) => {
    try {
      const playback =
        await getPlaybackStatus();

      return res.json({
        ok: true,
        playback,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error:
          error.message,
      });
    }
  }
);

/* =========================================================
   INICIAR REPRODUCCIÓN DESDE EL PANEL DJ

   Ejemplo:

   POST /api/playback/start/27

   El número 27 corresponde al ID de la solicitud.
========================================================= */

app.post(
  "/api/playback/start/:id",
  requireDjAccess,
  async (req, res) => {
    const requestId =
      Number(req.params.id);

    if (
      !Number.isInteger(
        requestId
      ) ||
      requestId <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "ID de solicitud inválido",
      });
    }

    try {
      const request =
        await getRequestById(
          requestId
        );

      if (!request) {
        return res.status(404).json({
          ok: false,
          error:
            "La solicitud ya no existe",
        });
      }

      const result =
        await pool.query(
          `
            UPDATE playback_status
            SET
              request_id = $1,
              table_no = $2,
              name = $3,
              artist = $4,
              song = $5,
              requested_at = $6,
              started_at = NOW(),
              is_playing = TRUE,
              updated_at = NOW()
            WHERE id = 1
            RETURNING
              request_id,
              table_no,
              name,
              artist,
              song,
              requested_at,
              started_at,
              is_playing,
              updated_at;
          `,
          [
            request.id,
            request.table_no,
            request.name,
            request.artist,
            request.song,
            request.created_at,
          ]
        );

      const playback =
        rowToPlayback(
          result.rows[0]
        );

      io.emit(
        "playback:update",
        playback
      );

      return res.json({
        ok: true,
        playback,
      });
    } catch (error) {
      console.log(
        "⚠️ Iniciar reproducción:",
        error.message
      );

      return res.status(500).json({
        ok: false,
        error:
          error.message,
      });
    }
  }
);

/* =========================================================
   DETENER REPRODUCCIÓN DESDE EL PANEL DJ

   No elimina la solicitud.
   Solo quita la canción de "Ahora sonando".
========================================================= */

app.post(
  "/api/playback/stop",
  requireDjAccess,
  async (req, res) => {
    try {
      const playback =
        await clearPlaybackStatus();

      return res.json({
        ok: true,
        playback,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error:
          error.message,
      });
    }
  }
);

/* =========================================================
   CAMBIAR LA CANCIÓN ACTUAL DIRECTAMENTE

   Esta ruta acepta el ID en JSON:

   {
     "requestId": 27
   }

   Se deja disponible por si después quieres agregar
   selectores o controles adicionales al panel DJ.
========================================================= */

app.post(
  "/api/playback/start",
  requireDjAccess,
  async (req, res) => {
    const requestId =
      Number(
        req.body?.requestId
      );

    if (
      !Number.isInteger(
        requestId
      ) ||
      requestId <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "requestId inválido",
      });
    }

    try {
      const request =
        await getRequestById(
          requestId
        );

      if (!request) {
        return res.status(404).json({
          ok: false,
          error:
            "La solicitud ya no existe",
        });
      }

      const result =
        await pool.query(
          `
            UPDATE playback_status
            SET
              request_id = $1,
              table_no = $2,
              name = $3,
              artist = $4,
              song = $5,
              requested_at = $6,
              started_at = NOW(),
              is_playing = TRUE,
              updated_at = NOW()
            WHERE id = 1
            RETURNING
              request_id,
              table_no,
              name,
              artist,
              song,
              requested_at,
              started_at,
              is_playing,
              updated_at;
          `,
          [
            request.id,
            request.table_no,
            request.name,
            request.artist,
            request.song,
            request.created_at,
          ]
        );

      const playback =
        rowToPlayback(
          result.rows[0]
        );

      io.emit(
        "playback:update",
        playback
      );

      return res.json({
        ok: true,
        playback,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error:
          error.message,
      });
    }
  }
);

/* =========================================================
   VALIDACIÓN DE SOLICITUDES
========================================================= */

function validatePayload({
  table,
  name,
  artist,
  song,
}) {
  const normalizedTable =
    String(
      table ?? ""
    ).trim();

  const normalizedName =
    String(
      name ?? ""
    ).trim();

  const normalizedArtist =
    String(
      artist ?? ""
    ).trim();

  const normalizedSong =
    String(
      song ?? ""
    ).trim();

  if (
    !/^\d{1,3}$/.test(
      normalizedTable
    )
  ) {
    return "Mesa inválida";
  }

  const tableNumber =
    Number(normalizedTable);

  if (
    tableNumber < 1 ||
    tableNumber > 999
  ) {
    return "Mesa inválida";
  }

  if (
    !normalizedName ||
    normalizedName.length > 40
  ) {
    return "Nombre inválido";
  }

  if (
    !normalizedArtist ||
    normalizedArtist.length > 40
  ) {
    return "Artista inválido";
  }

  if (
    !normalizedSong ||
    normalizedSong.length > 40
  ) {
    return "Canción inválida";
  }

  return null;
}

/* =========================================================
   PROTECCIÓN CONTRA ENVÍOS SEGUIDOS
========================================================= */

const REQUEST_COOLDOWN_MS =
  10_000;

const lastRequestByKey =
  new Map();

function checkCooldownOrNull(
  key
) {
  const currentTime =
    Date.now();

  const lastTime =
    lastRequestByKey.get(
      key
    ) || 0;

  const elapsed =
    currentTime -
    lastTime;

  if (
    elapsed <
    REQUEST_COOLDOWN_MS
  ) {
    const wait =
      Math.ceil(
        (
          REQUEST_COOLDOWN_MS -
          elapsed
        ) / 1000
      );

    return {
      wait,
    };
  }

  lastRequestByKey.set(
    key,
    currentTime
  );

  if (
    lastRequestByKey.size >
    8000
  ) {
    const cleanupLimit =
      currentTime -
      10 * 60 * 1000;

    for (
      const [
        storedKey,
        storedTime,
      ] of
        lastRequestByKey.entries()
    ) {
      if (
        storedTime <
        cleanupLimit
      ) {
        lastRequestByKey.delete(
          storedKey
        );
      }
    }

    if (
      lastRequestByKey.size >
      12000
    ) {
      lastRequestByKey.clear();
    }
  }

  return null;
}

/* =========================================================
   NORMALIZACIÓN PARA ESTADÍSTICAS
========================================================= */

function normalizeKey(value) {
  return String(
    value ?? ""
  )
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function makeSongKey(
  song,
  artist
) {
  const normalizedSong =
    normalizeKey(song);

  const normalizedArtist =
    normalizeKey(artist);

  const key =
    `${normalizedSong}|${normalizedArtist}`;

  return (
    key ||
    "unknown_song"
  );
}

function makeArtistKey(
  artist
) {
  const normalizedArtist =
    normalizeKey(artist);

  return (
    normalizedArtist ||
    "unknown_artist"
  );
}

/* =========================================================
   GUARDAR CANCIÓN COMO REPRODUCIDA
========================================================= */

async function insertPlaySafe({
  table_no,
  name,
  artist,
  song,
  requested_at,
}) {
  const songKey =
    makeSongKey(
      song,
      artist
    );

  const artistKey =
    makeArtistKey(
      artist
    );

  try {
    return await pool.query(
      `
        INSERT INTO plays (
          table_no,
          name,
          artist,
          song,
          song_key,
          artist_key,
          requested_at,
          played_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          NOW()
        )
        RETURNING id;
      `,
      [
        table_no,
        name,
        artist,
        song,
        songKey,
        artistKey,
        requested_at,
      ]
    );
  } catch (error) {
    /*
      Compatibilidad con bases antiguas que todavía
      no tengan artist_key.
    */

    if (
      error?.code ===
      "42703"
    ) {
      try {
        return await pool.query(
          `
            INSERT INTO plays (
              table_no,
              name,
              artist,
              song,
              song_key,
              requested_at,
              played_at
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              NOW()
            )
            RETURNING id;
          `,
          [
            table_no,
            name,
            artist,
            song,
            songKey,
            requested_at,
          ]
        );
      } catch (secondError) {
        /*
          Compatibilidad con bases aún más antiguas
          que tampoco tengan song_key.
        */

        if (
          secondError?.code ===
          "42703"
        ) {
          return pool.query(
            `
              INSERT INTO plays (
                table_no,
                name,
                artist,
                song,
                requested_at,
                played_at
              )
              VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                NOW()
              )
              RETURNING id;
            `,
            [
              table_no,
              name,
              artist,
              song,
              requested_at,
            ]
          );
        }

        throw secondError;
      }
    }

    throw error;
  }
}

/* =========================================================
   CREAR NUEVA SOLICITUD
========================================================= */

app.post(
  "/api/requests",
  async (req, res) => {
    await loadOrdersStatus();

    const closedByAdmin =
      rejectIfClosedByAdmin();

    if (closedByAdmin) {
      return res
        .status(403)
        .json(closedByAdmin);
    }

    const closedBySchedule =
      rejectIfClosedBySchedule();

    if (closedBySchedule) {
      return res
        .status(403)
        .json(closedBySchedule);
    }

    const validationError =
      validatePayload(
        req.body
      );

    if (validationError) {
      return res
        .status(400)
        .json({
          ok: false,
          error:
            validationError,
        });
    }

    const table =
      String(
        req.body.table
      ).trim();

    const name =
      String(
        req.body.name
      ).trim();

    const artist =
      String(
        req.body.artist
      ).trim();

    const song =
      String(
        req.body.song
      ).trim();

    const cooldownKey =
      `mesa:${table}`;

    const cooldown =
      checkCooldownOrNull(
        cooldownKey
      );

    if (cooldown) {
      return res
        .status(429)
        .json({
          ok: false,

          error:
            `⏳ Espera ${cooldown.wait}s antes de enviar otra solicitud.`,

          reason:
            "cooldown",
        });
    }

    try {
      const result =
        await pool.query(
          `
            INSERT INTO requests (
              table_no,
              name,
              artist,
              song
            )
            VALUES (
              $1,
              $2,
              $3,
              $4
            )
            RETURNING
              id,
              table_no,
              name,
              artist,
              song,
              created_at;
          `,
          [
            table,
            name,
            artist,
            song,
          ]
        );

      const item =
        rowToRequest(
          result.rows[0]
        );

      await emitRequests();

      return res.json({
        ok: true,
        item,
      });
    } catch (error) {
      console.log(
        "⚠️ Crear solicitud:",
        error.message
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message,
        });
    }
  }
);

/* =========================================================
   OBTENER SOLICITUDES
========================================================= */

app.get(
  "/api/requests",
  async (req, res) => {
    try {
      const requests =
        await getRequests();

      return res.json({
        ok: true,
        requests,
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message,
        });
    }
  }
);

/* =========================================================
   FINALIZAR UNA CANCIÓN

   Este endpoint corresponde al botón verde actual.

   Al finalizar:
   1. elimina la solicitud;
   2. la guarda en el historial;
   3. si era la canción actual, la quita de la TV;
   4. actualiza la cola;
   5. actualiza la ruleta.
========================================================= */

app.delete(
  "/api/requests/:id",
  requireDjAccess,
  async (req, res) => {
    const requestId =
      Number(
        req.params.id
      );

    if (
      !Number.isInteger(
        requestId
      ) ||
      requestId <= 0
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          error:
            "ID inválido",
        });
    }

    try {
      const removed =
        await pool.query(
          `
            DELETE FROM requests
            WHERE id = $1
            RETURNING
              id,
              table_no,
              name,
              artist,
              song,
              created_at;
          `,
          [requestId]
        );

      if (!removed.rowCount) {
        await emitRequests();

        await clearPlaybackIfRequestMatches(
          requestId
        );

        return res.json({
          ok: true,
          playedLogged:
            false,
        });
      }

      const request =
        removed.rows[0];

      await insertPlaySafe({
        table_no:
          request.table_no,

        name:
          request.name,

        artist:
          request.artist,

        song:
          request.song,

        requested_at:
          request.created_at,
      });

      await clearPlaybackIfRequestMatches(
        requestId
      );

      await emitRequests();

      emitRaffleUpdate();

      return res.json({
        ok: true,
        playedLogged:
          true,
      });
    } catch (error) {
      console.log(
        "⚠️ Finalizar canción:",
        error.message
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message,
        });
    }
  }
);

/* =========================================================
   LIMPIAR TODAS LAS SOLICITUDES

   También limpia la canción actual de la pantalla.
========================================================= */

app.delete(
  "/api/requests",
  requireDjAccess,
  async (req, res) => {
    try {
      await pool.query(
        "DELETE FROM requests;"
      );

      await clearPlaybackStatus();
      await emitRequests();

      return res.json({
        ok: true,
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message,
        });
    }
  }
);

/* =========================================================
   UTILIDAD PARA DÍAS DE ESTADÍSTICAS
========================================================= */

function parseDays(
  value,
  fallback
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    ) ||
    number <= 0 ||
    number > 3650
  ) {
    return fallback;
  }

  return Math.floor(
    number
  );
}

/* =========================================================
   ESTADÍSTICAS: RESUMEN
========================================================= */

app.get(
  "/api/admin/stats/summary",
  requireAdmin,
  async (req, res) => {
    const days =
      parseDays(
        req.query.days,
        30
      );

    try {
      const result =
        await pool.query(
          `
            SELECT
              COUNT(*)::int AS total
            FROM plays
            WHERE
              played_at >=
              NOW() -
              ($1 || ' days')::interval;
          `,
          [days]
        );

      return res.json({
        ok: true,
        days,

        total:
          result.rows[0]
            ?.total ?? 0,
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message,
        });
    }
  }
);

/* =========================================================
   ESTADÍSTICAS: CANCIONES MÁS REPRODUCIDAS
========================================================= */

app.get(
  "/api/admin/stats/top-songs",
  requireAdmin,
  async (req, res) => {
    const days =
      parseDays(
        req.query.days,
        30
      );

    const limit = 5;

    try {
      const result =
        await pool.query(
          `
            SELECT
              song,
              artist,
              COUNT(*)::int AS plays
            FROM plays
            WHERE
              played_at >=
              NOW() -
              ($1 || ' days')::interval
            GROUP BY
              song,
              artist
            ORDER BY
              plays DESC,
              song ASC
            LIMIT ${limit};
          `,
          [days]
        );

      return res.json({
        ok: true,
        days,
        rows:
          result.rows,
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message,
        });
    }
  }
);

/* =========================================================
   ESTADÍSTICAS: ARTISTAS MÁS REPRODUCIDOS
========================================================= */

app.get(
  "/api/admin/stats/top-artists",
  requireAdmin,
  async (req, res) => {
    const days =
      parseDays(
        req.query.days,
        30
      );

    const limit = 5;

    try {
      const result =
        await pool.query(
          `
            SELECT
              artist,
              COUNT(*)::int AS plays
            FROM plays
            WHERE
              played_at >=
              NOW() -
              ($1 || ' days')::interval
            GROUP BY artist
            ORDER BY
              plays DESC,
              artist ASC
            LIMIT ${limit};
          `,
          [days]
        );

      return res.json({
        ok: true,
        days,
        rows:
          result.rows,
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message,
        });
    }
  }
);

/* =========================================================
   ESTADÍSTICAS: RESUMEN POR DÍA
========================================================= */

app.get(
  "/api/admin/stats/by-day",
  requireAdmin,
  async (req, res) => {
    const days =
      parseDays(
        req.query.days,
        30
      );

    const limit = 5;

    try {
      const result =
        await pool.query(
          `
            WITH plays_by_night AS (
              SELECT
                CASE
                  WHEN (
                    played_at
                    AT TIME ZONE $2
                  )::time <
                  time '05:00'
                  THEN (
                    (
                      played_at
                      AT TIME ZONE $2
                    )::date - 1
                  )
                  ELSE (
                    played_at
                    AT TIME ZONE $2
                  )::date
                END AS night_day
              FROM plays
              WHERE
                played_at >=
                NOW() -
                ($1 || ' days')::interval
            )

            SELECT
              night_day AS day,
              COUNT(*)::int AS plays
            FROM plays_by_night
            GROUP BY night_day
            ORDER BY
              night_day DESC
            LIMIT ${limit};
          `,
          [
            days,
            TZ_CHILE,
          ]
        );

      return res.json({
        ok: true,
        days,
        limit,
        rows:
          result.rows,
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message,
        });
    }
  }
);

/* =========================================================
   VALIDACIÓN DE FECHA
========================================================= */

function isValidISODateOnly(
  value
) {
  return /^\d{4}-\d{2}-\d{2}$/.test(
    String(
      value || ""
    )
  );
}

/* =========================================================
   ESTADÍSTICA DE UN DÍA ESPECÍFICO
========================================================= */

app.get(
  "/api/admin/stats/by-day-one",
  requireAdmin,
  async (req, res) => {
    const date =
      isValidISODateOnly(
        req.query.date
      )
        ? String(
            req.query.date
          )
        : null;

    if (!date) {
      return res
        .status(400)
        .json({
          ok: false,

          error:
            "date inválido (YYYY-MM-DD)",
        });
    }

    try {
      const result =
        await pool.query(
          `
            WITH plays_by_night AS (
              SELECT
                CASE
                  WHEN (
                    played_at
                    AT TIME ZONE $2
                  )::time <
                  time '05:00'
                  THEN (
                    (
                      played_at
                      AT TIME ZONE $2
                    )::date - 1
                  )
                  ELSE (
                    played_at
                    AT TIME ZONE $2
                  )::date
                END AS night_day
              FROM plays
            )

            SELECT
              COUNT(*)::int AS plays
            FROM plays_by_night
            WHERE
              night_day =
              $1::date;
          `,
          [
            date,
            TZ_CHILE,
          ]
        );

      return res.json({
        ok: true,
        date,

        plays:
          result.rows[0]
            ?.plays ?? 0,
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message,
        });
    }
  }
);

/* =========================================================
   FECHA DE LA NOCHE ACTUAL

   Entre las 00:00 y las 04:59 se considera que todavía
   pertenece a la noche anterior.
========================================================= */

function getChileNightDateKey() {
  const nowMinutes =
    getChileMinutesNow();

  const currentDate =
    getChileDateKey();

  if (
    nowMinutes >=
    5 * 60
  ) {
    return currentDate;
  }

  const [
    year,
    month,
    day,
  ] =
    currentDate
      .split("-")
      .map(Number);

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
        12,
        0,
        0
      )
    );

  date.setUTCDate(
    date.getUTCDate() - 1
  );

  const previousYear =
    date.getUTCFullYear();

  const previousMonth =
    String(
      date.getUTCMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const previousDay =
    String(
      date.getUTCDate()
    ).padStart(
      2,
      "0"
    );

  return (
    `${previousYear}-` +
    `${previousMonth}-` +
    `${previousDay}`
  );
}

/* =========================================================
   HISTORIAL DE UNA NOCHE
========================================================= */

app.get(
  "/api/admin/history",
  requireAdmin,
  async (req, res) => {
    const date =
      isValidISODateOnly(
        req.query.date
      )
        ? String(
            req.query.date
          )
        : getChileNightDateKey();

    try {
      const result =
        await pool.query(
          `
            WITH night_window AS (
              SELECT
                (
                  (
                    $1::date +
                    time '19:00'
                  )
                  AT TIME ZONE $2
                ) AS start_ts,

                (
                  (
                    ($1::date + 1) +
                    time '05:00'
                  )
                  AT TIME ZONE $2
                ) AS end_ts
            )

            SELECT
              p.id,
              p.table_no,
              p.name,
              p.artist,
              p.song,
              p.requested_at,
              p.played_at,

              GREATEST(
                0,
                FLOOR(
                  EXTRACT(
                    EPOCH FROM (
                      p.played_at -
                      p.requested_at
                    )
                  ) / 60
                )
              )::int AS wait_min

            FROM plays p
            CROSS JOIN night_window nw

            WHERE
              p.requested_at >=
              nw.start_ts

              AND p.requested_at <
              nw.end_ts

            ORDER BY
              p.requested_at ASC,
              p.id ASC;
          `,
          [
            date,
            TZ_CHILE,
          ]
        );

      return res.json({
        ok: true,
        date,

        window: {
          startHHMM: "19:00",
          endHHMM: "05:00",
          tz: TZ_CHILE,
        },

        rows:
          result.rows,
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message,
        });
    }
  }
);

/* =========================================================
   PARTICIPANTES DE LA RULETA

   Condición actual:
   - toma el día completo seleccionado;
   - mínimo 2 canciones cantadas;
   - excluye a quienes ya ganaron ese día.
========================================================= */

app.get(
  "/api/admin/stats/top-singers-night",
  requireRaffleAccess,
  async (req, res) => {
    const date =
      isValidISODateOnly(
        req.query.date
      )
        ? String(
            req.query.date
          )
        : getChileDateKey();

    const minimumRaw =
      Number(
        req.query.min ?? 2
      );

    const minimum =
      Number.isFinite(
        minimumRaw
      ) &&
      minimumRaw >= 1 &&
      minimumRaw <= 50
        ? Math.floor(
            minimumRaw
          )
        : 2;

    try {
      const result =
        await pool.query(
          `
            WITH day_window AS (
              SELECT
                (
                  (
                    $1::date +
                    time '00:00'
                  )
                  AT TIME ZONE $2
                ) AS start_ts,

                (
                  (
                    ($1::date + 1) +
                    time '00:00'
                  )
                  AT TIME ZONE $2
                ) AS end_ts
            )

            SELECT
              p.name,
              p.table_no::text
                AS table_no,
              COUNT(*)::int
                AS plays

            FROM plays p
            CROSS JOIN day_window dw

            WHERE
              p.played_at >=
              dw.start_ts

              AND p.played_at <
              dw.end_ts

              AND NOT EXISTS (
                SELECT 1
                FROM raffle_winners rw

                WHERE
                  rw.night_day =
                  $1::date

                  AND rw.name_key =
                  lower(
                    trim(
                      p.name
                    )
                  )

                  AND COALESCE(
                    lower(
                      trim(
                        rw.table_no::text
                      )
                    ),
                    ''
                  ) =
                  COALESCE(
                    lower(
                      trim(
                        p.table_no::text
                      )
                    ),
                    ''
                  )
              )

            GROUP BY
              p.name,
              p.table_no::text

            HAVING
              COUNT(*) >= $3

            ORDER BY
              plays DESC,
              p.name ASC,
              p.table_no::text ASC

            LIMIT 200;
          `,
          [
            date,
            TZ_CHILE,
            minimum,
          ]
        );

      return res.json({
        ok: true,
        date,
        min: minimum,

        mode:
          "testing-full-day",

        window: {
          startHHMM: "00:00",
          endHHMM:
            "00:00 del día siguiente",
          tz: TZ_CHILE,
        },

        rows:
          result.rows,
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message,
        });
    }
  }
);

/* =========================================================
   NORMALIZAR NOMBRE DE GANADOR
========================================================= */

function normalizeNameKey(
  value
) {
  return String(
    value ?? ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

/* =========================================================
   LISTAR GANADORES DE LA RULETA
========================================================= */

app.get(
  "/api/admin/raffle/winners",
  requireRaffleAccess,
  async (req, res) => {
    const date =
      isValidISODateOnly(
        req.query.date
      )
        ? String(
            req.query.date
          )
        : getChileNightDateKey();

    try {
      const result =
        await pool.query(
          `
            SELECT
              id,
              night_day,
              name,
              table_no,
              plays,
              created_at

            FROM raffle_winners

            WHERE
              night_day =
              $1::date

            ORDER BY
              created_at DESC,
              id DESC

            LIMIT 50;
          `,
          [date]
        );

      return res.json({
        ok: true,
        date,
        rows:
          result.rows,
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message,
        });
    }
  }
);

/* =========================================================
   GUARDAR GANADOR DE RULETA
========================================================= */

app.post(
  "/api/admin/raffle/winners",
  requireRaffleAccess,
  async (req, res) => {
    const date =
      isValidISODateOnly(
        req.body?.date
      )
        ? String(
            req.body.date
          )
        : getChileNightDateKey();

    const name =
      String(
        req.body?.name ?? ""
      ).trim();

    if (
      !name ||
      name.length > 80
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          error:
            "name inválido",
        });
    }

    const tableNumber =
      String(
        req.body?.table ?? ""
      ).trim() || null;

    const playsRaw =
      Number(
        req.body?.plays ?? 0
      );

    const plays =
      Number.isFinite(
        playsRaw
      ) &&
      playsRaw >= 0
        ? Math.floor(
            playsRaw
          )
        : 0;

    const nameKey =
      normalizeNameKey(
        name
      );

    try {
      const existing =
        await pool.query(
          `
            SELECT id

            FROM raffle_winners

            WHERE
              night_day =
              $1::date

              AND name_key =
              $2

              AND COALESCE(
                lower(
                  trim(
                    table_no::text
                  )
                ),
                ''
              ) =
              COALESCE(
                lower(
                  trim(
                    $3::text
                  )
                ),
                ''
              )

            LIMIT 1;
          `,
          [
            date,
            nameKey,
            tableNumber,
          ]
        );

      if (
        existing.rowCount
      ) {
        return res
          .status(409)
          .json({
            ok: false,
            error:
              "Este participante ya fue ganador.",
          });
      }

      const inserted =
        await pool.query(
          `
            INSERT INTO raffle_winners (
              night_day,
              name,
              name_key,
              table_no,
              plays
            )
            VALUES (
              $1::date,
              $2,
              $3,
              $4,
              $5
            )
            RETURNING
              id,
              night_day,
              name,
              table_no,
              plays,
              created_at;
          `,
          [
            date,
            name,
            nameKey,
            tableNumber,
            plays,
          ]
        );

      emitRaffleUpdate();

      return res.json({
        ok: true,
        winner:
          inserted.rows[0],
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message,
        });
    }
  }
);

/* =========================================================
   SOCKET.IO

   Cada vez que se conecta:
   - panel DJ;
   - panel Admin;
   - ruleta;
   - Smart TV;

   recibe inmediatamente:
   - estado de pedidos;
   - solicitudes;
   - reproducción actual.
========================================================= */

io.on(
  "connection",
  async (socket) => {
    try {
      await loadOrdersStatus();

      socket.emit(
        "orders:status",
        {
          enabled: ordersOpen,
        }
      );
    } catch (error) {
      socket.emit(
        "orders:status",
        {
          enabled: true,
        }
      );
    }

    try {
      const requests = await getRequests();

      socket.emit(
        "requests:update",
        requests
      );
    } catch (error) {
      socket.emit(
        "requests:update",
        []
      );
    }

    try {
      const playback = await getPlaybackStatus();

      socket.emit(
        "playback:update",
        playback
      );
    } catch (error) {
      socket.emit(
        "playback:update",
        emptyPlayback()
      );
    }
  }
);

/* =========================================================
   INICIAR SERVIDOR
========================================================= */

const PORT =
  process.env.PORT ||
  3000;

async function startServer() {
  try {
    /*
      Primero aseguramos que existan todas las tablas
      necesarias antes de comenzar a escuchar conexiones.
    */

    await ensureProjectTables();

    await ensureRaffleWinnersTable();

    await ensurePlaybackStatusTable();

    /*
      Cargamos el estado actual de pedidos desde PostgreSQL.
    */

    await loadOrdersStatus();

    /*
      Verificamos si corresponde aplicar cierre o reinicio
      automático al momento de arrancar Railway.
    */

    await autoCloseIfNeeded();

    await autoResetIfNeeded();

    /*
      Iniciamos Express y Socket.IO.
    */

    server.listen(
      PORT,
      "0.0.0.0",
      async () => {
        console.log("");
        console.log(
          "=========================================="
        );
        console.log(
          "🎤 ONIX KARAOKE - SERVIDOR INICIADO"
        );
        console.log(
          "=========================================="
        );
        console.log(
          `🚀 Servidor:  http://localhost:${PORT}`
        );
        console.log(
          `📱 Clientes:  http://localhost:${PORT}/qr`
        );
        console.log(
          `🎧 DJ:        http://localhost:${PORT}/dj`
        );
        console.log(
          `🛡️ Admin:     http://localhost:${PORT}/admin`
        );
        console.log(
          `🏆 Ruleta:    http://localhost:${PORT}/ruleta`
        );
        console.log(
          `📺 Pantalla:  http://localhost:${PORT}/pantalla`
        );
        console.log(
          "=========================================="
        );

        console.log(
          "DATABASE_URL cargada:",
          !!process.env.DATABASE_URL
        );

        console.log(
          "🟢 Estado inicial de pedidos:",
          ordersOpen
            ? "ABIERTO"
            : "CERRADO"
        );

        /*
          Enviamos el estado inicial a todos los clientes
          que ya estén conectados.
        */

        emitOrdersStatus();

        await emitRequests();

        await emitPlaybackStatus();

        console.log(
          "✅ Estado inicial emitido por Socket.IO"
        );

        console.log(
          "=========================================="
        );
        console.log("");
      }
    );
  } catch (error) {
    console.error("");
    console.error(
      "❌ No se pudo iniciar el servidor:"
    );
    console.error(
      error
    );
    console.error("");

    process.exit(1);
  }
}

/* =========================================================
   MANEJO DE ERRORES DEL PROCESO
========================================================= */

process.on(
  "unhandledRejection",
  (reason) => {
    console.error(
      "⚠️ Promesa no controlada:",
      reason
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "⚠️ Excepción no controlada:",
      error
    );
  }
);

/* =========================================================
   CIERRE ORDENADO
========================================================= */

function shutdown(signal) {
  console.log(`\n🛑 Señal ${signal} recibida`);

  io.close();
  server.closeAllConnections();

  server.close(() => {
    pool.end().catch(() => {});
  });

  process.exit(0);
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  shutdown("SIGINT");
});
/* =========================================================
   ARRANQUE
========================================================= */

startServer();

