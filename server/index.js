import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import cron from 'node-cron';
import { computeObligationStatus } from './obligationStatus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const SUBS_FILE = path.join(DATA_DIR, 'push-subscriptions.json');
const DIST_DIR = path.join(ROOT, 'dist');

const DEFAULT_DATA = {
  setupDone: false,
  profiles: [],
  incomes: [],
  expenses: [],
  obligations: [],
  obligationPayments: [],
  goals: [],
  goalContributions: [],
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
    console.log(`Se creó ${DATA_FILE} con datos por defecto.`);
  }
  if (!fs.existsSync(SUBS_FILE)) {
    fs.writeFileSync(SUBS_FILE, JSON.stringify([], null, 2));
  }
}
ensureDataFile();

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    console.error('No se pudo leer data.json, se usan datos por defecto:', e.message);
    return DEFAULT_DATA;
  }
}

let writeQueue = Promise.resolve();

function writeData(data) {
  writeQueue = writeQueue.then(() => {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const backupFile = path.join(BACKUP_DIR, `data-${stamp}.json`);
      if (fs.existsSync(DATA_FILE) && !fs.existsSync(backupFile)) {
        fs.copyFileSync(DATA_FILE, backupFile);
      }
      const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('data-')).sort();
      while (files.length > 14) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
    } catch (e) {
      console.error('No se pudo crear el respaldo (se continúa igual):', e.message);
    }

    const tmpFile = DATA_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    fs.renameSync(tmpFile, DATA_FILE);
  });
  return writeQueue;
}

function readSubs() {
  try {
    return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf-8'));
  } catch (e) {
    return [];
  }
}
function writeSubs(subs) {
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
}

/* ---------------------------------------------------------
   Notificaciones push (VAPID)
--------------------------------------------------------- */
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails('mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.log('Notificaciones push desactivadas: falta VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en el entorno.');
}

async function sendDailySummary() {
  if (!pushEnabled) return;
  const data = readData();
  const subs = readSubs();
  if (subs.length === 0) return;

  const statuses = data.obligations.map((ob) => ({ ob, info: computeObligationStatus(ob, data.obligationPayments) }));
  const relevant = statuses
    .filter((x) => x.info.status === 'vencido' || x.info.status === 'proximo')
    .sort((a, b) => a.info.diffDays - b.info.diffDays);

  if (relevant.length === 0) {
    console.log('Resumen diario: nada vencido ni por vencer, no se envía notificación.');
    return;
  }

  const vencidos = relevant.filter((x) => x.info.status === 'vencido');
  const proximos = relevant.filter((x) => x.info.status === 'proximo');

  let body = 'Un paso más cerca de nuestra meta 💛 ';
  if (vencidos.length > 0) body += `Vencido: ${vencidos.map((x) => x.ob.name).join(', ')}. `;
  if (proximos.length > 0) body += `Por vencer: ${proximos.map((x) => x.ob.name).join(', ')}.`;

  const payload = JSON.stringify({
    title: '🏡 Construyendo Nuestro Sueño',
    body: body.trim(),
    url: '/',
  });

  const stillValid = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      stillValid.push(sub);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        console.log('Suscripción vencida, se elimina.');
      } else {
        console.error('Error enviando notificación push:', err.message);
        stillValid.push(sub);
      }
    }
  }
  writeSubs(stillValid);
}

// Todos los días a las 8:00am, hora de Colombia.
if (pushEnabled) {
  cron.schedule('0 8 * * *', sendDailySummary, { timezone: 'America/Bogota' });
  console.log('Resumen diario de vencimientos programado: 8:00am (America/Bogota).');
}

/* ---------------------------------------------------------
   App
--------------------------------------------------------- */
const app = express();
app.use(express.json({ limit: '8mb' })); // suficiente para fotos de comprobantes en base64

app.get('/api/data', (req, res) => {
  res.json(readData());
});

app.put('/api/data', async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }
  try {
    await writeData(body);
    res.json({ ok: true });
  } catch (e) {
    console.error('Error guardando data.json:', e);
    res.status(500).json({ error: 'No se pudo guardar' });
  }
});

/* --- Comprobantes (fotos / PDF adjuntos a un pago) --- */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

app.post('/api/uploads', (req, res) => {
  const { filename, mimeType, dataBase64 } = req.body || {};
  if (!filename || !mimeType || !dataBase64) {
    return res.status(400).json({ error: 'Faltan datos del archivo' });
  }
  if (!ALLOWED_MIME.includes(mimeType)) {
    return res.status(400).json({ error: 'Tipo de archivo no permitido (solo fotos o PDF)' });
  }
  const buffer = Buffer.from(dataBase64, 'base64');
  if (buffer.length > MAX_FILE_BYTES) {
    return res.status(400).json({ error: 'El archivo pesa más de 5 MB' });
  }
  const ext = path.extname(filename) || '';
  const safeName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, safeName), buffer);
  res.json({ url: `/uploads/${safeName}` });
});

app.use('/uploads', express.static(UPLOADS_DIR));

/* --- Notificaciones push --- */
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY, enabled: pushEnabled });
});

app.post('/api/push/subscribe', (req, res) => {
  if (!pushEnabled) return res.status(503).json({ error: 'Notificaciones no configuradas en el servidor' });
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Suscripción inválida' });
  }
  const subs = readSubs();
  const exists = subs.some((s) => s.endpoint === subscription.endpoint);
  if (!exists) {
    subs.push(subscription);
    writeSubs(subs);
  }
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  const subs = readSubs().filter((s) => s.endpoint !== endpoint);
  writeSubs(subs);
  res.json({ ok: true });
});

// Solo para probar que las notificaciones sí funcionan sin esperar a las 8am.
app.post('/api/push/test', async (req, res) => {
  if (!pushEnabled) return res.status(503).json({ error: 'Notificaciones no configuradas en el servidor' });
  await sendDailySummary();
  res.json({ ok: true });
});

/* --- Frontend compilado --- */
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
} else {
  app.get('*', (req, res) => {
    res.status(503).send('Falta compilar el frontend: ejecuta "npm run build" primero.');
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Casa en orden escuchando en http://localhost:${PORT}`);
  console.log(`Datos guardados en: ${DATA_FILE}`);
});
