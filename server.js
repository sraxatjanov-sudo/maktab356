// 356-maktab sayti va admin paneli uchun server.
// Kompyuterda: qo'shimcha paket kerak emas, ma'lumotlar data/data.json faylida saqlanadi.
// Internetda (Render): MONGODB_URI berilsa, ma'lumotlar va rasmlar MongoDB'da saqlanadi.
// Ishga tushirish:  node server.js

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/* ---------- Sozlamalar ---------- */
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "maktab356"; // parolni o'zgartirishni unutmang!
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data", "data.json");
const SEED_FILE = path.join(ROOT, "data", "seed.json");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const COLLECTIONS = ["news", "achievements", "teachers", "events", "gallery"];
const MAX_IMAGE = 10 * 1024 * 1024; // 10 MB
const MONGODB_URI = process.env.MONGODB_URI || "";

let mongo = null; // { site, images } — MONGODB_URI berilganda
if (!MONGODB_URI) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------- Ma'lumotlarni saqlash ---------- */
const readSeed = () => fs.existsSync(SEED_FILE) ? JSON.parse(fs.readFileSync(SEED_FILE, "utf8")) : {};
function normalize(d) {
  for (const c of [...COLLECTIONS, "messages"]) d[c] = d[c] || [];
  d.settings = d.settings || {};
  return d;
}
let DATA = {};
async function loadData() {
  if (MONGODB_URI) {
    const { MongoClient } = require("mongodb"); // faqat internetda kerak (npm install)
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db("maktab356");
    mongo = { site: db.collection("site"), images: db.collection("images") };
    const doc = await mongo.site.findOne({ _id: "site" });
    if (doc) return normalize(doc.data);
    const d = normalize(readSeed());
    await mongo.site.insertOne({ _id: "site", data: d });
    console.log("  MongoDB: boshlang'ich ma'lumotlar yozildi.");
    return d;
  }
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(readSeed(), null, 2));
  return normalize(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
}
let saving = Promise.resolve();
function save() {
  if (mongo) {
    const snapshot = JSON.parse(JSON.stringify(DATA));
    saving = saving.catch(() => {}).then(() => mongo.site.replaceOne({ _id: "site" }, { _id: "site", data: snapshot }, { upsert: true }));
    return saving;
  }
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(DATA, null, 2));
  fs.renameSync(tmp, DATA_FILE); // fayl buzilib qolmasligi uchun avval vaqtinchalik faylga yoziladi
  return Promise.resolve();
}
const newId = () => crypto.randomBytes(8).toString("hex");

/* ---------- Kirish (login) ---------- */
const sessions = new Map(); // token -> amal qilish muddati
const SESSION_MS = 12 * 60 * 60 * 1000; // 12 soat
const loginTries = new Map(); // ip -> { n, until }

function getCookie(req, name) {
  const c = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(name + "="));
  return c ? decodeURIComponent(c.slice(name.length + 1)) : null;
}
function isAdmin(req) {
  const t = getCookie(req, "sid");
  const exp = t && sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ---------- Yordamchi funksiyalar ---------- */
function send(res, status, obj, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > limit) { reject({ status: 413 }); req.destroy(); } else chunks.push(c); });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject({ status: 400 }); }
    });
    req.on("error", reject);
  });
}
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon"
};
async function serveImage(res, name) {
  if (!mongo) return serveFile(res, UPLOAD_DIR, name);
  const doc = /^[a-f0-9]{16}\.(jpg|png|webp|gif)$/.test(name) ? await mongo.images.findOne({ _id: name }) : null;
  if (!doc) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Rasm topilmadi"); }
  const buf = Buffer.from(doc.data.buffer ?? doc.data);
  res.writeHead(200, { "Content-Type": doc.type, "Cache-Control": "public, max-age=604800", "X-Content-Type-Options": "nosniff" });
  res.end(buf);
}
function serveFile(res, baseDir, rel) {
  const file = path.normalize(path.join(baseDir, rel));
  if (!file.startsWith(baseDir)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Sahifa topilmadi"); }
    const f = st.isDirectory() ? path.join(file, "index.html") : file;
    fs.readFile(f, (e, buf) => {
      if (e) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Sahifa topilmadi"); }
      const isImg = baseDir === UPLOAD_DIR;
      res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": isImg ? "public, max-age=604800" : "no-cache", "X-Content-Type-Options": "nosniff" });
      res.end(buf);
    });
  });
}

/* ---------- API ---------- */
async function api(req, res, parts) {
  const m = req.method;
  const [, , a, b] = parts; // /api/a/b

  // Sayt uchun ochiq ma'lumotlar
  if (m === "GET" && a === "content") {
    const out = { settings: DATA.settings };
    for (const c of COLLECTIONS) out[c] = DATA[c];
    return send(res, 200, out);
  }

  // Aloqa formasi (hamma yubora oladi)
  if (m === "POST" && a === "messages" && !b) {
    const { name, who, text } = await readBody(req, 20000);
    if (!name || !text) return send(res, 400, { error: "Ism va xabar matnini yozing" });
    if (DATA.messages.length >= 1000) DATA.messages.shift();
    DATA.messages.push({ id: newId(), name: String(name).slice(0, 100), who: String(who || "Boshqa").slice(0, 40), text: String(text).slice(0, 3000), at: new Date().toISOString(), read: false });
    await save();
    return send(res, 200, { ok: true });
  }

  // Login
  if (m === "POST" && a === "login") {
    const ip = req.socket.remoteAddress;
    const t = loginTries.get(ip) || { n: 0, until: 0 };
    if (t.until > Date.now()) return send(res, 429, { error: "Ko'p marta noto'g'ri urinish. 5 daqiqadan keyin qayta urinib ko'ring." });
    const { password } = await readBody(req, 2000);
    if (!safeEqual(password || "", ADMIN_PASSWORD)) {
      t.n++; if (t.n >= 5) { t.until = Date.now() + 5 * 60 * 1000; t.n = 0; }
      loginTries.set(ip, t);
      return send(res, 401, { error: "Parol noto'g'ri" });
    }
    loginTries.delete(ip);
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, Date.now() + SESSION_MS);
    return send(res, 200, { ok: true }, { "Set-Cookie": `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}` });
  }
  if (m === "POST" && a === "logout") {
    const t = getCookie(req, "sid"); if (t) sessions.delete(t);
    return send(res, 200, { ok: true }, { "Set-Cookie": "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
  }
  if (m === "GET" && a === "me") return send(res, 200, { admin: isAdmin(req) });

  // Bundan keyingilari faqat admin uchun
  if (!isAdmin(req)) return send(res, 401, { error: "Avval admin panelga kiring" });

  if (m === "GET" && a === "admin") return send(res, 200, DATA);

  if (m === "PUT" && a === "settings") { DATA.settings = await readBody(req, 100000); await save(); return send(res, 200, DATA.settings); }

  if (a === "messages" && b) {
    const msg = DATA.messages.find(x => x.id === b);
    if (!msg) return send(res, 404, { error: "Xabar topilmadi" });
    if (m === "PUT") { msg.read = !!(await readBody(req, 2000)).read; await save(); return send(res, 200, msg); }
    if (m === "DELETE") { DATA.messages = DATA.messages.filter(x => x.id !== b); await save(); return send(res, 200, { ok: true }); }
  }

  // Rasm yuklash: brauzer rasmni base64 ko'rinishida yuboradi
  if (m === "POST" && a === "upload") {
    const { data } = await readBody(req, MAX_IMAGE * 1.4);
    const match = /^data:image\/(jpeg|png|webp|gif);base64,(.+)$/.exec(data || "");
    if (!match) return send(res, 400, { error: "Faqat JPG, PNG, WEBP yoki GIF rasm yuklang" });
    const buf = Buffer.from(match[2], "base64");
    if (buf.length > MAX_IMAGE) return send(res, 400, { error: "Rasm juda katta (10 MB gacha)" });
    const name = newId() + "." + (match[1] === "jpeg" ? "jpg" : match[1]);
    if (mongo) await mongo.images.insertOne({ _id: name, type: "image/" + match[1], data: buf, at: new Date() });
    else fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    return send(res, 200, { id: name, url: "/uploads/" + name });
  }

  // Yangilik, yutuq, ustoz, tadbir, galereya
  if (COLLECTIONS.includes(a)) {
    const list = DATA[a];
    if (m === "POST" && !b) { const item = { ...(await readBody(req, 300000)), id: newId() }; list.push(item); await save(); return send(res, 200, item); }
    const i = list.findIndex(x => x.id === b);
    if (i < 0) return send(res, 404, { error: "Topilmadi" });
    if (m === "PUT") { list[i] = { ...(await readBody(req, 300000)), id: b }; await save(); return send(res, 200, list[i]); }
    if (m === "DELETE") { DATA[a] = list.filter(x => x.id !== b); await save(); return send(res, 200, { ok: true }); }
  }

  send(res, 404, { error: "Noma'lum so'rov" });
}

/* ---------- Server ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = decodeURIComponent(url.pathname);
  const parts = p.split("/");
  try {
    if (parts[1] === "api") return await api(req, res, parts);
    if (parts[1] === "uploads") return await serveImage(res, parts.slice(2).join("/"));
    if (parts[1] === "admin") {
      if (p === "/admin") { res.writeHead(301, { Location: "/admin/" }); return res.end(); }
      return serveFile(res, path.join(ROOT, "admin"), parts.slice(2).join("/"));
    }
    return serveFile(res, path.join(ROOT, "public"), p.slice(1));
  } catch (e) {
    if (e && e.status === 413) return send(res, 413, { error: "Ma'lumot juda katta" });
    if (e && e.status === 400) return send(res, 400, { error: "Noto'g'ri so'rov" });
    console.error(e);
    send(res, 500, { error: "Serverda xatolik" });
  }
});

loadData().then(d => {
  DATA = d;
  server.listen(PORT, () => {
    console.log(`\n  Ma'lumotlar: ${mongo ? "MongoDB" : "data/data.json fayli"}`);
    console.log(`  356-maktab sayti:  http://localhost:${PORT}`);
    console.log(`  Admin panel:       http://localhost:${PORT}/admin\n`);
    if (ADMIN_PASSWORD === "maktab356") console.log("  Diqqat: standart parol (maktab356) ishlatilmoqda. README.md dagi ko'rsatma bo'yicha o'zgartiring.\n");
  });
}).catch(err => {
  console.error("\n  Ma'lumotlar bazasiga ulanib bo'lmadi:", err.message);
  console.error("  MONGODB_URI to'g'ri yozilganini va Atlas'da 0.0.0.0/0 ruxsat berilganini tekshiring.\n");
  process.exit(1);
});
