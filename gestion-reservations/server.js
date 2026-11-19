import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import multer from "multer";
import pg from "pg";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
});
const PgStore = connectPgSimple(session);

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, "public")));

await pool.query(`
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    service_date DATE NOT NULL,
    guest_name TEXT NOT NULL DEFAULT '',
    table_number TEXT NOT NULL DEFAULT '',
    arrival_time TEXT NOT NULL DEFAULT '',
    covers INTEGER NOT NULL DEFAULT 1,
    present BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS bookings_service_date_idx ON bookings(service_date);
`);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error("Choisis une photo JPG, PNG ou WEBP."));
  }
});

const authRequired = (req, res, next) => req.session?.authenticated ? next() : res.status(401).json({ error: "Connecte-toi pour continuer." });

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/session", (req, res) => res.json({ authenticated: !!req.session?.authenticated }));

app.post("/api/login", async (req, res) => {
  const supplied = String(req.body?.password || "");
  const expected = process.env.TEAM_PASSWORD || "";
  if (!expected) return res.status(503).json({ error: "Le mot de passe de l'équipe n'est pas configuré." });
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Mot de passe incorrect." });
  req.session.authenticated = true;
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get("/api/bookings", authRequired, async (req, res) => {
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Date invalide." });
  const { rows } = await pool.query(
    "SELECT id, guest_name AS name, table_number AS table, arrival_time AS arrival, covers, present FROM bookings WHERE service_date=$1 ORDER BY CASE WHEN table_number ~ '^[0-9]+$' THEN table_number::int END NULLS LAST, table_number, arrival_time, guest_name",
    [date]
  );
  res.json(rows);
});

app.post("/api/bookings", authRequired, async (req, res) => {
  const b = cleanBooking(req.body);
  const date = String(req.body?.date || "");
  if (!validDate(date)) return res.status(400).json({ error: "Date invalide." });
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO bookings(id,service_date,guest_name,table_number,arrival_time,covers,present) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id,date,b.name,b.table,b.arrival,b.covers,b.present]
  );
  res.json({ id, ...b });
});

app.put("/api/bookings/:id", authRequired, async (req, res) => {
  const b = cleanBooking(req.body);
  const date = String(req.body?.date || "");
  if (!validDate(date)) return res.status(400).json({ error: "Date invalide." });
  const result = await pool.query(
    "UPDATE bookings SET guest_name=$1,table_number=$2,arrival_time=$3,covers=$4,present=$5 WHERE id=$6 AND service_date=$7",
    [b.name,b.table,b.arrival,b.covers,b.present,req.params.id,date]
  );
  if (!result.rowCount) return res.status(404).json({ error: "Réservation introuvable." });
  res.json({ id:req.params.id, ...b });
});

app.delete("/api/bookings/:id", authRequired, async (req, res) => {
  await pool.query("DELETE FROM bookings WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

app.post("/api/scan", authRequired, upload.single("photo"), async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "La lecture photo n'est pas activée : ajoute la clé API OpenAI dans les variables du site." });
  if (!req.file) return res.status(400).json({ error: "Aucune photo reçue." });
  const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
  const prompt = `Lis cette note manuscrite de réservations de restaurant. Extrais uniquement les réservations réellement visibles. Ne devine jamais une information illisible : mets une chaîne vide pour le nom, la table ou l'heure si nécessaire, et 1 pour les couverts inconnus. Respecte exactement l'orthographe visible des noms. Une heure comme 12h/12:00 doit être rendue "12h00". Une plage doit être conservée telle quelle, par exemple "12h00–12h30". Les tables et couverts doivent être des chaînes/nombres propres. Retourne uniquement du JSON de la forme {"bookings":[{"name":"...","table":"...","arrival":"...","covers":2}]}. N'invente pas de lignes ni de total.`;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-6.2-astra",
        input: [{ role: "user", content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: dataUrl, detail: "high" }
        ]}],
        text: { format: { type: "json_object" } },
        store: false
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || "Erreur du service de lecture photo.");
    const output = (payload.output || []).flatMap(x => x.content || []).find(x => x.type === "output_text")?.text;
    if (!output) throw new Error("Aucun texte exploitable n'a été renvoyé.");
    const parsed = JSON.parse(output);
    const bookings = (Array.isArray(parsed.bookings) ? parsed.bookings : []).map(cleanBooking);
    res.json({ bookings });
  } catch (e) {
    res.status(502).json({ error: `Lecture impossible : ${e.message}` });
  }
});

function cleanBooking(input = {}) {
  const covers = Number.parseInt(input.covers, 10);
  return {
    name: String(input.name ?? "").trim().slice(0,120),
    table: String(input.table ?? "").trim().slice(0,30),
    arrival: String(input.arrival ?? "").trim().slice(0,40),
    covers: Number.isFinite(covers) && covers > 0 ? Math.min(covers,99) : 1,
    present: Boolean(input.present)
  };
}
function validDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const date = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === d;
}

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Requête invalide." });
});
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) return res.sendFile(path.join(__dirname, "public", "index.html"));
  next();
});

app.listen(PORT, () => console.log(`Site prêt sur le port ${PORT}`));
