import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
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
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
    console.log(`Se creó ${DATA_FILE} con datos por defecto.`);
  }
}
ensureDataFile();

function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('No se pudo leer data.json, se usan datos por defecto:', e.message);
    return DEFAULT_DATA;
  }
}

// Cola de escritura: evita que dos guardados simultáneos (John y Marcela
// guardando al mismo tiempo) corrompan el archivo. Las escrituras se hacen
// una detrás de otra, nunca en paralelo.
let writeQueue = Promise.resolve();

function writeData(data) {
  writeQueue = writeQueue.then(() => {
    // Respaldo diario: antes de sobrescribir, guarda una copia fechada
    // (una por día, se conservan los últimos 14 días).
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const backupFile = path.join(BACKUP_DIR, `data-${stamp}.json`);
      if (fs.existsSync(DATA_FILE) && !fs.existsSync(backupFile)) {
        fs.copyFileSync(DATA_FILE, backupFile);
      }
      const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('data-')).sort();
      while (files.length > 14) {
        fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
      }
    } catch (e) {
      console.error('No se pudo crear el respaldo (se continúa igual):', e.message);
    }

    // Escritura atómica: se escribe primero en un archivo temporal y luego
    // se renombra, así nunca queda un data.json a medio escribir si el
    // proceso se cae justo en ese instante.
    const tmpFile = DATA_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    fs.renameSync(tmpFile, DATA_FILE);
  });
  return writeQueue;
}

const app = express();
app.use(express.json({ limit: '2mb' }));

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

// Sirve la app ya compilada (carpeta dist, generada con `npm run build`)
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
