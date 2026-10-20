# 356-maktab sayti va admin paneli

Toshkent shahri, Yangi hayot tumani, Yangi Darxon mahallasidagi 356-maktabning rasmiy sayti.

Muallif: **Raxatjanov Shoxrux**

- **Sayt**: yangiliklar, o'quvchilar yutuqlari, maktab tarixi, ustozlar, galereya, aloqa formasi
- **Admin panel** (`/admin`): parol bilan kiriladi. Yangilik, yutuq, ustoz, tadbir, rasm, maktab haqida va direktor ma'lumotlarini boshqarish; saytdan kelgan savollarga javob berish.
- **AI yordamchi** (Google Gemini): saytdagi chat ota-onalar savollariga sayt ma'lumotlari asosida javob beradi; javob topilmasa, savol admin panelga yuboriladi. Admin panelda AI javob va yangilik qoralamalarini yozib beradi.

---

## 1. Kompyuterda ishga tushirish

1. https://nodejs.org saytidan **LTS** versiyasini o'rnating.
2. **Ishga tushirish.bat** faylini ikki marta bosing. Yoki papkada terminal ochib `node server.js` deb yozing.
3. Sayt: http://localhost:3000, admin panel: http://localhost:3000/admin
4. Standart parol: **maktab356**

Kompyuterda `npm install` shart emas. Ma'lumotlar `data/data.json` faylida, rasmlar `uploads/` papkasida saqlanadi.

---

## 2. Internetga chiqarish (MongoDB Atlas + GitHub + Render)

### 2.1. MongoDB Atlas (bepul ma'lumotlar bazasi)

1. https://www.mongodb.com/atlas saytida ro'yxatdan o'ting.
2. **Create** → bepul **M0 (Free)** klasterni tanlang → yaratish.
3. **Database Access** (yoki Security → Database Users) → foydalanuvchi qo'shing. Login va parolni yozib qo'ying. Parolda `@ : / ?` belgilari bo'lmasin.
4. **Network Access** → **Add IP Address** → **Allow access from anywhere** (`0.0.0.0/0`). Render'ning manzili doimiy emas, shuning uchun bu kerak.
5. **Connect** → **Drivers** → ulanish havolasini nusxalang. U shunga o'xshaydi:
   ```
   mongodb+srv://login:<db_password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   `<db_password>` o'rniga 3-qadamdagi parolni yozing. Bu sizning **MONGODB_URI** qiymatingiz.

> Bu havolani hech kimga bermang va GitHub'ga yozmang.

### 2.2. GitHub

1. https://github.com da **New repository** → nomi: `maktab356` → **Create repository**.
2. Fayllarni yuklash (ikki usuldan biri):
   - **Brauzer orqali:** "uploading an existing file" havolasini bosing va papka ichidagi hamma fayl va papkalarni sudrab tashlang (`node_modules`, `data/data.json` va `uploads` ichidagi rasmlardan tashqari) → **Commit changes**.
   - **Git orqali:** papkada terminal ochib:
     ```
     git init
     git add .
     git commit -m "356-maktab sayti"
     git branch -M main
     git remote add origin https://github.com/sraxatjanov-sudo/maktab356.git
     git push -u origin main
     ```

### 2.3. Render (serverni ishga tushirish)

1. https://render.com saytiga **GitHub orqali** kiring.
2. **New** → **Web Service** → `maktab356` repozitoriyangizni tanlang.
3. Sozlamalar:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** Free
4. **Environment Variables** bo'limiga ikkita qiymat qo'shing:
   | Key | Value |
   |---|---|
   | `MONGODB_URI` | 2.1-bosqichdagi havola |
   | `ADMIN_PASSWORD` | admin panel uchun o'zingiz o'ylagan kuchli parol |
   | `GEMINI_API_KEY` | AI yordamchi uchun kalit (2.5-bo'limga qarang). Bo'lmasa, chat savollarni to'g'ridan-to'g'ri ma'muriyatga yuboradi |
5. **Create Web Service** → bir necha daqiqa kuting. Logda `Ma'lumotlar: MongoDB` yozuvi chiqsa, hammasi joyida.
6. Render bergan manzil (masalan, `https://maktab356.onrender.com`) — bu sizning saytingiz, admin panel esa `https://maktab356.onrender.com/admin`.

Birinchi ishga tushishda `data/seed.json` dagi ma'lumotlar MongoDB'ga avtomatik yoziladi. Keyin hamma narsa admin panel orqali boshqariladi.

### 2.4. Bilish kerak bo'lgan narsalar

- **Bepul Render** 15 daqiqa hech kim kirmasa "uxlab qoladi". Keyingi safar ochilishi 30–60 soniya oladi, keyin tez ishlaydi.
- **Kodni o'zgartirsangiz:** GitHub'ga yuklang, Render o'zi yangilaydi. Ma'lumotlar MongoDB'da bo'lgani uchun o'chib ketmaydi.
- **Parol** faqat Render sozlamalarida turadi. Kodni hamma ko'rsa ham, parolsiz admin panelga kirib bo'lmaydi.

### 2.5. AI yordamchini ulash (Google Gemini, bepul)

1. https://aistudio.google.com/apikey saytiga Google hisobingiz bilan kiring.
2. **Create API key** → kalitni nusxalang.
3. Render → xizmatingiz → **Environment** → **Add Environment Variable**:
   `GEMINI_API_KEY` = nusxalangan kalit → **Save Changes**.
4. 2–3 daqiqadan keyin Render logida `AI yordamchi: ulangan` yozuvi chiqadi.

> Kalitni hech kimga bermang va GitHub'ga yozmang. Bepul tarifda Google so'rovlardan o'z xizmatlarini yaxshilash uchun foydalanishi mumkin, shuning uchun chatda shaxsiy ma'lumot yozilmasligi so'raladi.
> Model nomini o'zgartirish kerak bo'lsa: `GEMINI_MODEL` (masalan `gemini-2.5-flash`).

---

## Papkalar

```
server.js            server (Node.js)
public/index.html    sayt
admin/index.html     admin panel
data/seed.json       boshlang'ich (namuna) ma'lumotlar
uploads/             kompyuterda yuklangan rasmlar
Ishga tushirish.bat  Windows'da bir bosishda ishga tushirish
```
