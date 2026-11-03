import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pg from "pg";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";
const { Pool } = pg;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!process.env.ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is required");
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be at least 32 characters");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
});

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "30kb" }));
app.use(express.urlencoded({ extended: false, limit: "30kb" }));

const COOKIE_NAME = "avr_admin";
const tokenSignature = (payload) =>
  crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
function makeSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 8 * 60 * 60 * 1000 })).toString("base64url");
  return payload + "." + tokenSignature(payload);
}
function isAuthenticated(req) {
  const token = req.cookies?.[COOKIE_NAME] || "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, tokenSignature(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(data.exp) > Date.now();
  } catch { return false; }
}
// Minimal cookie parser for the single signed admin session cookie.
app.use((req, _res, next) => {
  req.cookies = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > -1) req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  next();
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-8", legacyHeaders: false });
const intakeLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 12, standardHeaders: "draft-8", legacyHeaders: false });

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id BIGSERIAL PRIMARY KEY,
      business_name VARCHAR(180) NOT NULL,
      contact_name VARCHAR(180) NOT NULL,
      email VARCHAR(254) NOT NULL,
      phone VARCHAR(60),
      business_type VARCHAR(100),
      monthly_call_volume VARCHAR(80),
      needs TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'new'
        CHECK (status IN ('new','contacted','demo_scheduled','demo_sent','approved','active','closed')),
      internal_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads(created_at DESC);
    CREATE INDEX IF NOT EXISTS leads_status_idx ON leads(status);
  `);
}

function requireAdmin(req, res, next) {
  if (!isAuthenticated(req)) return res.status(401).json({ error: "Please sign in again." });
  next();
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "ai-virtual-receptionist-api" }));

app.post("/api/intake", intakeLimiter, async (req, res) => {
  try {
    const business = String(req.body.business_name || req.body["Business name"] || "").trim();
    const contact = String(req.body.contact_name || req.body.Name || "").trim();
    const email = String(req.body.email || req.body.Email || "").trim().toLowerCase();
    const phone = String(req.body.phone || req.body["Business phone"] || "").trim();
    const type = String(req.body.business_type || req.body["Business type"] || "").trim();
    const volume = String(req.body.monthly_call_volume || req.body["Monthly call volume"] || "").trim();
    const needs = String(req.body.needs || req.body["What you need"] || "").trim();

    if (!business || !contact || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).send("Please provide a business name, contact name, and valid email address. Go back and try again.");
    }
    if (business.length > 180 || contact.length > 180 || email.length > 254 || phone.length > 60 || needs.length > 5000) {
      return res.status(400).send("Some information is too long. Please go back and shorten it.");
    }
    await pool.query(
      `INSERT INTO leads (business_name, contact_name, email, phone, business_type, monthly_call_volume, needs)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [business, contact, email, phone, type, volume, needs]
    );
    return res.redirect(303, "/?submitted=1#contact");
  } catch (error) {
    console.error("Intake submission failed:", error.message);
    return res.status(500).send("We couldn't submit your request right now. Please try again shortly.");
  }
});

app.post("/api/admin/login", loginLimiter, (req, res) => {
  const password = String(req.body.password || "");
  if (!safeEqual(password, process.env.ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  res.cookie(COOKIE_NAME, makeSession(), {
    httpOnly: true, secure: isProduction, sameSite: "strict", path: "/", maxAge: 8 * 60 * 60 * 1000
  });
  res.json({ ok: true });
});

app.post("/api/admin/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: isProduction, sameSite: "strict", path: "/" });
  res.json({ ok: true });
});

app.get("/api/admin/me", requireAdmin, (_req, res) => res.json({ authenticated: true }));

app.get("/api/admin/leads", requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, business_name, contact_name, email, phone, business_type,
              monthly_call_volume, needs, status, internal_notes, created_at, updated_at
       FROM leads ORDER BY created_at DESC LIMIT 500`
    );
    res.json({ leads: rows });
  } catch (error) {
    console.error("Lead list failed:", error.message);
    res.status(500).json({ error: "Unable to load leads." });
  }
});

app.patch("/api/admin/leads/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const allowed = ["new", "contacted", "demo_scheduled", "demo_sent", "approved", "active", "closed"];
  const status = String(req.body.status || "");
  const notes = String(req.body.internal_notes || "");
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid lead ID." });
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status." });
  if (notes.length > 10000) return res.status(400).json({ error: "Notes are too long." });
  try {
    const result = await pool.query(
      `UPDATE leads SET status=$1, internal_notes=$2, updated_at=NOW()
       WHERE id=$3 RETURNING id, status, internal_notes, updated_at`,
      [status, notes, id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Lead not found." });
    res.json({ lead: result.rows[0] });
  } catch (error) {
    console.error("Lead update failed:", error.message);
    res.status(500).json({ error: "Unable to update lead." });
  }
});

app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.use(express.static(__dirname, { index: "index.html", dotfiles: "ignore" }));
app.use((req, res) => res.status(404).send("Not found"));

initializeDatabase().then(() => {
  app.listen(PORT, () => console.log(`AI Virtual Receptionist server listening on ${PORT}`));
}).catch((error) => {
  console.error("Database initialization failed:", error);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});
