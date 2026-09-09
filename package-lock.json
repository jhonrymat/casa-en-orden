import { DEFAULT_DATA } from './defaultData.js';

/* ---------------------------------------------------------
   Datos compartidos (gastos, deudas, metas...) — viven en el
   servidor, en un archivo data.json (ver server/index.js).
--------------------------------------------------------- */
export async function loadData() {
  try {
    const res = await fetch('/api/data');
    if (!res.ok) return null;
    const raw = await res.json();
    return { ...DEFAULT_DATA, ...raw };
  } catch (e) {
    return null;
  }
}

export async function saveData(data) {
  try {
    const res = await fetch('/api/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

/* ---------------------------------------------------------
   Sesión (quién quedó con la sesión iniciada en ESTE dispositivo)
   — es solo un recordatorio local, no se comparte entre celulares,
   así que puede vivir tranquilamente en localStorage del navegador.
--------------------------------------------------------- */
export async function loadSession() {
  try {
    const raw = localStorage.getItem('hf_session');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export async function saveSession(session) {
  try {
    localStorage.setItem('hf_session', JSON.stringify(session));
  } catch (e) { /* no pasa nada si falla, solo no se recuerda la sesión */ }
}

export async function clearSession() {
  try {
    localStorage.removeItem('hf_session');
  } catch (e) { /* ignorar */ }
}
