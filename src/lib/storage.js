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

/* ---------------------------------------------------------
   Comprobantes (foto o PDF adjunto a un pago)
--------------------------------------------------------- */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Sube un archivo (File del input) y devuelve la URL donde queda guardado
// en el servidor, o null si falla.
export async function uploadAttachment(file) {
  try {
    const dataBase64 = await fileToBase64(file);
    const res = await fetch('/api/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, mimeType: file.type, dataBase64 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'No se pudo subir el archivo');
    }
    const { url } = await res.json();
    return url;
  } catch (e) {
    throw e;
  }
}

/* ---------------------------------------------------------
   Notificaciones push (resumen diario de vencimientos)
--------------------------------------------------------- */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function getPushStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { supported: false };
  }
  try {
    const res = await fetch('/api/push/vapid-public-key');
    const { publicKey, enabled } = await res.json();
    if (!enabled) return { supported: true, serverEnabled: false };
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    return { supported: true, serverEnabled: true, publicKey, subscribed: !!existing };
  } catch (e) {
    return { supported: true, serverEnabled: false };
  }
}

export async function enablePushNotifications() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Permiso de notificaciones denegado');
  }
  const res = await fetch('/api/push/vapid-public-key');
  const { publicKey, enabled } = await res.json();
  if (!enabled) throw new Error('El servidor todavía no tiene configuradas las notificaciones');

  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription),
  });
  return true;
}
