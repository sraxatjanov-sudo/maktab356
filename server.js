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
// Sun'iy intellekt (Google Gemini). Kalit faqat Render'dagi Environment'da turadi, GitHub'ga yozilmaydi!
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_BASE = process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODELS = (process.env.GEMINI_MODEL || "gemini-flash-latest,gemini-2.5-flash,gemini-2.0-flash").split(",").map(x => x.trim()).filter(Boolean);

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
// So'rov raqami: chalkashtiradigan belgilarsiz (0/O, 1/I yo'q), masalan K7M4QX
const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode() {
  for (;;) {
    const b = crypto.randomBytes(6);
    const c = [...b].map(x => CODE_ABC[x % CODE_ABC.length]).join("");
    if (!DATA.messages.some(m => m.code === c)) return c;
  }
}
// Bog'lanish ma'lumotini tekshirish va tartibga keltirish
function cleanContact(type, value) {
  const v = String(value || "").trim();
  if (type === "phone") {
    let d = v.replace(/[^\d+]/g, "");
    if (/^\d{9}$/.test(d)) d = "+998" + d;          // 901234567 -> +998901234567
    if (/^998\d{9}$/.test(d)) d = "+" + d;
    return /^\+?\d{9,15}$/.test(d) ? d : null;
  }
  if (type === "telegram") {
    const u = v.replace(/^(https?:\/\/)?(t\.me|telegram\.me)\//i, "").replace(/^@/, "");
    return /^[A-Za-z0-9_]{5,32}$/.test(u) ? "@" + u : null;
  }
  if (type === "email") return /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,}$/.test(v) ? v.toLowerCase() : null;
  return null;
}
/* ---------- Sun'iy intellekt ---------- */
let workingModel = null;
async function gemini(system, turns, { maxTokens = 600, temperature = 0.3 } = {}) {
  if (!GEMINI_API_KEY) throw { status: 503, error: "AI ulanmagan" };
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: turns.map(t => ({ role: t.role === "model" ? "model" : "user", parts: [{ text: t.text }] })),
    generationConfig: { temperature, maxOutputTokens: maxTokens }
  };
  const models = workingModel ? [workingModel, ...GEMINI_MODELS.filter(m => m !== workingModel)] : GEMINI_MODELS;
  let last = null;
  for (const model of models) {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const r = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify(body)
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 404) { last = { status: 502, error: "Model topilmadi: " + model }; continue; }
      if (r.status === 429) throw { status: 429, error: "AI hozir band. Bir daqiqadan keyin qayta urinib ko'ring." };
      if (r.status === 400 || r.status === 401 || r.status === 403) { console.error("Gemini:", r.status, JSON.stringify(d).slice(0, 300)); throw { status: 502, error: "AI kaliti noto'g'ri yoki faol emas." }; }
      if (!r.ok) { last = { status: 502, error: "AI javob bermadi" }; continue; }
      const text = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
      if (!text) throw { status: 502, error: "AI bu savolga javob bera olmadi. Savolni boshqacha yozib ko'ring." };
      workingModel = model;
      return text;
    } catch (e) {
      if (e && e.status) throw e;
      last = { status: 502, error: "AI bilan aloqa yo'q" };
    } finally { clearTimeout(timer); }
  }
  throw last || { status: 502, error: "AI javob bermadi" };
}
// Sayt ma'lumotlaridan AI uchun qisqa "bilimlar bazasi" (shaxsiy xabarlar KIRMAYDI)
function siteKnowledge() {
  const st = DATA.settings || {}, ab = st.about || {}, dr = st.director || {};
  const L = [];
  L.push("MAKTAB: 356-umumta'lim maktabi, Toshkent shahri, Yangi hayot tumani, Yangi Darxon mahallasi.");
  if (st.address) L.push("Manzil: " + st.address);
  if (st.phone) L.push("Telefon: " + st.phone);
  if (st.hours) L.push("Ish vaqti: " + st.hours);
  if (st.students) L.push("O'quvchilar soni: " + st.students);
  if (st.teachers) L.push("Ustozlar soni: " + st.teachers);
  if (st.founded) L.push("Ochilgan yil: " + st.founded);
  if (st.banner?.on && st.banner.text) L.push("MUHIM E'LON: " + st.banner.text);
  if (dr.name) L.push(`Direktor: ${dr.name} (${dr.role || "Maktab direktori"}). ${dr.bio || ""}`);
  if (ab.text) L.push("Maktab haqida: " + ab.text);
  (ab.timeline || []).forEach(t => L.push(`Tarix — ${t.y}: ${t.p}`));
  (ab.results || []).forEach(r => L.push(`Natija: ${r.big} ${r.unit || ""} — ${r.title}. ${r.text || ""}`));
  const today = new Date().toISOString().slice(0, 10);
  L.push("BUGUNGI SANA: " + today);
  (DATA.events || []).forEach(e => L.push(`Tadbir: ${e.date} — ${e.t}${e.s ? " (" + e.s + ")" : ""}`));
  (DATA.news || []).slice().sort((a, b) => (b.d || "").localeCompare(a.d || "")).slice(0, 15).forEach(n => {
    const more = n.more || {};
    const extra = [...(more.info || []).map(([k, v]) => k + ": " + v), ...(more.lists || []).map(l => l.h + ": " + (l.items || []).join("; ")),
      ...((more.teachers?.list) || []).map(t => "Ustoz " + t.n + " (" + t.r + ")")].join(". ");
    L.push(`Yangilik (${n.d}${n.soon ? ", tez orada" : ""}): ${n.t}. ${n.full || n.s || ""} ${extra}`.slice(0, 1200));
  });
  (DATA.teachers || []).forEach(t => L.push(`Ustoz: ${t.n} — ${t.s}, ${t.e || 0} yillik tajriba`));
  (DATA.achievements || []).forEach(a => L.push(`Yutuq: ${a.n} (${a.cl}) — ${a.a}, ${a.y}`));
  return L.join("\n").slice(0, 24000);
}
const CHAT_SYSTEM = () => `Sen 356-maktab saytidagi yordamchisan. Ota-onalar va o'quvchilarning savollariga O'ZBEK tilida (lotin yozuvida), qisqa, aniq va xushmuomala javob berasan.
QOIDALAR:
1. Faqat quyidagi MAKTAB MA'LUMOTLARI asosida javob ber. O'zingdan sana, raqam, ism yoki qoida to'qima.
2. Agar javob ma'lumotlarda bo'lmasa yoki aniq bilmasang, buni ochiq ayt va javob oxiriga alohida qatorda [MUROJAAT] deb yoz. Shunda foydalanuvchiga savolni ma'muriyatga yuborish taklif qilinadi.
3. Baholar, davomat, shaxsiy ma'lumotlar, to'lovlar yoki biror o'quvchi haqidagi shaxsiy masalalar so'ralsa, bunday ma'lumot senda yo'qligini ayt va [MUROJAAT] yoz.
4. Foydalanuvchidan telefon, manzil yoki boshqa shaxsiy ma'lumot so'rama.
5. Maktabga aloqasi yo'q savollarga (uy vazifasini to'liq yechib berish, o'yinlar, siyosat va h.k.) muloyimlik bilan rad et: sen faqat maktab haqidagi savollarga yordam berasan.
6. Javob 1–5 gapdan oshmasin. Markdown, jadval ishlatma.

MAKTAB MA'LUMOTLARI:
${siteKnowledge()}`;
const chatTries = new Map(); // ip -> { m, mReset, d, dReset }
function chatLimited(ip) {
  const now = Date.now(), t = chatTries.get(ip) || { m: 0, mReset: now + 60000, d: 0, dReset: now + 86400000 };
  if (now > t.mReset) { t.m = 0; t.mReset = now + 60000; }
  if (now > t.dReset) { t.d = 0; t.dReset = now + 86400000; }
  t.m++; t.d++; chatTries.set(ip, t);
  return t.m > 8 || t.d > 120;
}
const clientIp = req => (String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress;

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
  const raw = doc.b64 ? Buffer.from(doc.b64, "base64") : doc.data;
  const buf = Buffer.isBuffer(raw) ? raw
    : raw && raw.buffer instanceof Uint8Array ? Buffer.from(raw.buffer.subarray(0, raw.position ?? raw.buffer.length))
    : Buffer.from(raw);
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
    const { name, who, text, contactType, contact, source } = await readBody(req, 20000);
    if (!String(name || "").trim() || !String(text || "").trim()) return send(res, 400, { error: "Ismingiz va xabaringizni yozing" });
    const type = ["phone", "telegram", "email"].includes(contactType) ? contactType : null;
    const cleaned = type ? cleanContact(type, contact) : null;
    if (!cleaned) return send(res, 400, { error: type === "phone" ? "Telefon raqamini to'g'ri yozing, masalan: +998 90 123 45 67" : type === "telegram" ? "Telegram username'ni to'g'ri yozing, masalan: @aziz_karimov" : type === "email" ? "Gmail manzilini to'g'ri yozing, masalan: aziz@gmail.com" : "Siz bilan qanday bog'lanishimizni tanlang" });
    if (DATA.messages.length >= 1000) DATA.messages.shift();
    const code = newCode();
    DATA.messages.push({ id: newId(), code, name: String(name).trim().slice(0, 100), who: String(who || "Boshqa").slice(0, 40), text: String(text).trim().slice(0, 3000), contactType: type, contact: cleaned, at: new Date().toISOString(), read: false, answer: "", answeredAt: null, source: source === "chat" ? "chat" : "form" });
    await save();
    return send(res, 200, { ok: true, code });
  }

  // Sun'iy intellekt: holati
  if (m === "GET" && a === "chat" && b === "status") return send(res, 200, { enabled: !!GEMINI_API_KEY });

  // Sun'iy intellekt: saytdagi chat (hamma uchun)
  if (m === "POST" && a === "chat" && !b) {
    if (!GEMINI_API_KEY) return send(res, 503, { error: "AI yordamchi hozircha ulanmagan. Savolingizni ma'muriyatga yuboring." });
    if (chatLimited(clientIp(req))) return send(res, 429, { error: "Juda ko'p savol berildi. Bir oz kutib, qayta urinib ko'ring yoki savolni ma'muriyatga yuboring." });
    const { messages } = await readBody(req, 30000);
    const turns = (Array.isArray(messages) ? messages : []).slice(-10)
      .map(t => ({ role: t.role === "bot" ? "model" : "user", text: String(t.text || "").slice(0, 1000).trim() })).filter(t => t.text);
    while (turns.length && turns[0].role !== "user") turns.shift();
    if (!turns.length || turns[turns.length - 1].role !== "user") return send(res, 400, { error: "Savolingizni yozing" });
    try {
      let reply = await gemini(CHAT_SYSTEM(), turns, { maxTokens: 500, temperature: 0.2 });
      const handoff = /\[MUROJAAT\]/i.test(reply);
      reply = reply.replace(/\[MUROJAAT\]/gi, "").replace(/[*#`]/g, "").trim();
      return send(res, 200, { reply, handoff });
    } catch (e) { return send(res, e.status || 502, { error: e.error || "AI javob bermadi" }); }
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

  // Sun'iy intellekt: admin uchun matn qoralamasi
  if (m === "POST" && a === "ai" && b === "draft") {
    const { kind, input } = await readBody(req, 20000);
    const inp = String(input || "").slice(0, 4000).trim();
    if (!inp) return send(res, 400, { error: "Avval asosiy ma'lumotni yozing" });
    const sys = kind === "reply"
      ? `Sen 356-maktab ma'muriyati nomidan ota-ona yoki o'quvchining savoliga javob qoralamasini yozasan. O'zbek tilida (lotin), xushmuomala, 2–5 gap. Salomlashish va imzo YOZMA (ular avtomatik qo'shiladi). Faqat MAKTAB MA'LUMOTLARIDA bor faktlardan foydalan; aniq ma'lumot bo'lmasa, o'rniga [ANIQLASHTIRING: ...] deb belgi qo'y, o'zingdan to'qima. Markdown ishlatma.\n\nMAKTAB MA'LUMOTLARI:\n${siteKnowledge()}`
      : `Sen 356-maktab saytiga yangilik yozasan. Berilgan sarlavha va qisqa ma'lumot asosida o'zbek tilida (lotin) chiroyli, rasmiy-samimiy yangilik matnini yoz: 3–6 gap, bitta xatboshi. Faqat berilgan faktlardan foydalan, yangi ism, sana, raqam yoki joy qo'shma. Markdown, sarlavha va emoji ishlatma.`;
    try { return send(res, 200, { text: (await gemini(sys, [{ role: "user", text: inp }], { maxTokens: 700, temperature: 0.5 })).replace(/[*#`]/g, "").trim() }); }
    catch (e) { return send(res, e.status || 502, { error: e.error || "AI javob bermadi" }); }
  }

  if (m === "PUT" && a === "settings") { DATA.settings = await readBody(req, 100000); await save(); return send(res, 200, DATA.settings); }

  if (a === "messages" && b) {
    const msg = DATA.messages.find(x => x.id === b);
    if (!msg) return send(res, 404, { error: "Xabar topilmadi" });
    if (m === "PUT") {
      const body = await readBody(req, 20000);
      if ("read" in body) msg.read = !!body.read;
      if ("answer" in body) {
        msg.answer = String(body.answer || "").trim().slice(0, 3000);
        msg.answeredAt = msg.answer ? new Date().toISOString() : null;
        msg.read = true;
      }
      await save(); return send(res, 200, msg);
    }
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
    if (mongo) await mongo.images.insertOne({ _id: name, type: "image/" + match[1], b64: buf.toString("base64"), at: new Date() });
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
    if (m === "DELETE") {
      const removed = list[i];
      DATA[a] = list.filter(x => x.id !== b);
      // Yutuq o'chirilsa, u haqida avtomatik yozilgan yangilik ham o'chadi
      if (a === "achievements") DATA.news = DATA.news.filter(n => !(n.achId === b || (n.medal && n.who && n.who === removed.n)));
      await save(); return send(res, 200, { ok: true });
    }
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
    console.log(`  Admin panel:       http://localhost:${PORT}/admin`);
    console.log(`  AI yordamchi:      ${GEMINI_API_KEY ? "ulangan" : "ulanmagan (GEMINI_API_KEY yo'q)"}\n`);
    if (ADMIN_PASSWORD === "maktab356") console.log("  Diqqat: standart parol (maktab356) ishlatilmoqda. README.md dagi ko'rsatma bo'yicha o'zgartiring.\n");
  });
}).catch(err => {
  console.error("\n  Ma'lumotlar bazasiga ulanib bo'lmadi:", err.message);
  console.error("  MONGODB_URI to'g'ri yozilganini va Atlas'da 0.0.0.0/0 ruxsat berilganini tekshiring.\n");
  process.exit(1);
});
