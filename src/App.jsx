import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Zap, GraduationCap, ShoppingCart, Car, CreditCard, HeartPulse, Smile,
  MoreHorizontal, Plus, LogOut, Wallet, Target, X, Trash2, ArrowUpCircle,
  ArrowDownCircle, PiggyBank, Lock, User, ChevronRight, Calendar, Pencil,
  RotateCcw, CheckCircle2, AlertCircle, Clock, Paperclip, Bell
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip
} from 'recharts';
import { DEFAULT_DATA } from './lib/defaultData.js';
import { APP_NAME } from './lib/appName.js';
import { loadData, saveData, loadSession, saveSession, clearSession, uploadAttachment, getPushStatus, enablePushNotifications } from './lib/storage.js';

/* ---------------------------------------------------------
   Tokens & helpers
--------------------------------------------------------- */
const COLORS = {
  bg: '#F3F1EA',
  bgAlt: '#EDEAE1',
  ink: '#22301F',
  inkSoft: '#5B6357',
  card: '#FFFFFF',
  line: '#DEDACE',
  teal: '#2F6F5E',
  tealSoft: '#DCE8E1',
  ochre: '#B9793B',
  ochreSoft: '#F1E2CE',
  rust: '#A44B3B',
  rustSoft: '#F3DDD6',
};

const CATEGORY_DEFS = [
  { id: 'vivienda', label: 'Vivienda y servicios', icon: Zap, color: '#2F6F5E' },
  { id: 'educacion', label: 'Educación / pensión', icon: GraduationCap, color: '#4C7A3F' },
  { id: 'alimentacion', label: 'Alimentación', icon: ShoppingCart, color: '#B9793B' },
  { id: 'transporte', label: 'Transporte', icon: Car, color: '#8A6A3D' },
  { id: 'deudas', label: 'Deudas y tarjetas', icon: CreditCard, color: '#A44B3B' },
  { id: 'salud', label: 'Salud', icon: HeartPulse, color: '#6B5B7E' },
  { id: 'ocio', label: 'Ocio y varios', icon: Smile, color: '#3E6E8A' },
  { id: 'otros', label: 'Otros', icon: MoreHorizontal, color: '#7A7367' },
];
const catDef = (id) => CATEGORY_DEFS.find(c => c.id === id) || CATEGORY_DEFS[CATEGORY_DEFS.length - 1];

const INCOME_TYPES = [
  { id: 'quincena', label: 'Quincena' },
  { id: 'diario', label: 'Diario' },
  { id: 'extra', label: 'Extra' },
  { id: 'otro', label: 'Otro' },
];

function uid() { return Math.random().toString(36).slice(2, 10); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function monthKey(dateStr) { return (dateStr || todayStr()).slice(0, 7); }
function formatCOP(n) {
  const num = Math.round(Number(n) || 0);
  return '$ ' + num.toLocaleString('es-CO');
}
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const s = d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function daysInMonth(year, month1based) {
  return new Date(year, month1based, 0).getDate();
}
function formatDateHuman(date) {
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}
// Convierte 'YYYY-MM-DD' a medianoche LOCAL (evita el corrimiento de un día
// que da `new Date('YYYY-MM-DD')`, que lo interpreta como UTC).
function parseDateLocal(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Saldo disponible real: todo lo que ha entrado, menos todo lo que ha
// salido (gastos y pagos de deudas/servicios, que ya quedan como gasto),
// menos lo que ya se apartó en metas de ahorro. Es acumulado, no se
// reinicia cada mes — si ahorraron el mes pasado, ese dinero sigue
// disponible.
function computeAvailableBalance(data) {
  const totalIncome = data.incomes.reduce((s, i) => s + Number(i.amount), 0);
  const totalExpense = data.expenses.reduce((s, e) => s + Number(e.amount), 0);
  const totalGoalContrib = data.goalContributions.reduce((s, c) => s + Number(c.amount), 0);
  return totalIncome - totalExpense - totalGoalContrib;
}

/* ---------------------------------------------------------
   Obligations (deudas y pagos fijos con vencimiento)
   scheduleType: 'monthly'  -> vence un día fijo (1-31) de cada mes
   scheduleType: 'interval' -> se repite cada N días desde el último pago
--------------------------------------------------------- */
function computeObligationStatus(ob, obligationPayments) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const payments = obligationPayments
    .filter(p => p.obligationId === ob.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const lastPayment = payments.length ? payments[payments.length - 1] : null;

  let dueDate, period = null, paidThisPeriod = false;

  if (ob.scheduleType === 'interval') {
    const intervalDays = Number(ob.intervalDays) || 1;
    dueDate = lastPayment
      ? addDays(parseDateLocal(lastPayment.date), intervalDays)
      : parseDateLocal(ob.anchorDate || todayStr());
    dueDate.setHours(0, 0, 0, 0);
    // en el esquema por intervalo no existe "ya pagado este período fijo":
    // al pagar, el ciclo se reinicia y vuelve a contar hacia el próximo pago.
  } else {
    const y = today.getFullYear();
    const m = today.getMonth() + 1;
    period = `${y}-${String(m).padStart(2, '0')}`;
    const dim = daysInMonth(y, m);
    const day = Math.min(Number(ob.dueDay) || 1, dim);
    dueDate = new Date(y, m - 1, day);
    dueDate.setHours(0, 0, 0, 0);
    paidThisPeriod = obligationPayments.some(p => p.obligationId === ob.id && p.period === period);
  }

  const diffDays = Math.round((dueDate - today) / 86400000);

  let status;
  if (!ob.active) status = 'terminado';
  else if (paidThisPeriod) status = 'pagado';
  else if (diffDays < 0) status = 'vencido';
  else if (diffDays <= 5) status = 'proximo';
  else status = 'pendiente';

  return { period, dueDate, diffDays, status, paidThisPeriod, lastPayment };
}

function statusMeta(status, diffDays) {
  switch (status) {
    case 'vencido':
      return { label: `Venció hace ${Math.abs(diffDays)} día${Math.abs(diffDays) === 1 ? '' : 's'}`, color: COLORS.rust, bg: COLORS.rustSoft, Icon: AlertCircle };
    case 'proximo':
      return { label: diffDays === 0 ? 'Vence hoy' : `Vence en ${diffDays} día${diffDays === 1 ? '' : 's'}`, color: COLORS.ochre, bg: COLORS.ochreSoft, Icon: Clock };
    case 'pagado':
      return { label: 'Pagado este mes', color: COLORS.teal, bg: COLORS.tealSoft, Icon: CheckCircle2 };
    case 'terminado':
      return { label: 'Terminada', color: COLORS.teal, bg: COLORS.tealSoft, Icon: CheckCircle2 };
    default:
      return { label: 'Al día', color: COLORS.inkSoft, bg: COLORS.bgAlt, Icon: Clock };
  }
}

/* ---------------------------------------------------------
   Small UI primitives
--------------------------------------------------------- */
function Modal({ open, onClose, title, children }) {
  // Truco para que el botón físico "atrás" de Android cierre esta ventana
  // en vez de cerrar toda la app: al abrir, agregamos una entrada falsa al
  // historial del navegador; "atrás" la consume y dispara popstate, que
  // cerramos aquí. Si se cierra con la X (no con "atrás"), consumimos esa
  // entrada nosotros mismos para no dejar basura en el historial.
  useEffect(() => {
    if (!open) return;
    window.history.pushState({ casaEnOrdenModal: true }, '');
    const handlePopState = () => onClose();
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (window.history.state && window.history.state.casaEnOrdenModal) {
        window.history.back();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(34,48,31,0.35)', zIndex: 50 }}
      className="flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        style={{ background: COLORS.card, borderTop: `1px solid ${COLORS.line}` }}
        className="w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 style={{ color: COLORS.ink, fontFamily: 'Fraunces, serif' }} className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} style={{ color: COLORS.inkSoft }} className="p-1">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-3">
      <label style={{ color: COLORS.inkSoft }} className="block text-sm mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '10px',
  border: `1px solid ${COLORS.line}`,
  background: '#FCFBF8',
  color: COLORS.ink,
  fontSize: '15px',
  outline: 'none',
};

function TextInput(props) {
  return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />;
}
function Select(props) {
  return <select {...props} style={{ ...inputStyle, ...(props.style || {}) }}>{props.children}</select>;
}

function PrimaryButton({ children, ...props }) {
  return (
    <button
      {...props}
      style={{ background: COLORS.teal, color: '#fff' }}
      className="w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
function SecondaryButton({ children, tone, ...props }) {
  const c = tone === 'rust' ? COLORS.rust : tone === 'ochre' ? COLORS.ochre : COLORS.teal;
  const bg = tone === 'rust' ? COLORS.rustSoft : tone === 'ochre' ? COLORS.ochreSoft : COLORS.tealSoft;
  return (
    <button {...props} style={{ background: bg, color: c }} className="py-2 px-3 rounded-lg text-sm font-medium flex items-center justify-center gap-1 disabled:opacity-50">
      {children}
    </button>
  );
}

function ProgressBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ background: COLORS.bgAlt, borderRadius: 999, height: 8, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 999 }} />
    </div>
  );
}

function ConfirmRow({ onConfirm, onCancel, label }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span style={{ color: COLORS.inkSoft }}>{label || '¿Eliminar?'}</span>
      <button onClick={onConfirm} style={{ color: COLORS.rust }} className="font-medium">Sí</button>
      <button onClick={onCancel} style={{ color: COLORS.inkSoft }}>No</button>
    </div>
  );
}

// Campo para adjuntar una foto o PDF del comprobante de pago. Sube el
// archivo apenas se selecciona y guarda la URL resultante vía onUploaded.
// Muestra el comprobante DENTRO de la app (no abre una pestaña aparte), así
// el botón de cerrar y el botón "atrás" de Android funcionan como se espera.
function AttachmentViewer({ url }) {
  const isPdf = url.toLowerCase().endsWith('.pdf');
  return (
    <div>
      {isPdf ? (
        <iframe src={url} title="Comprobante" className="w-full rounded-lg" style={{ height: '65vh', border: `1px solid ${COLORS.line}` }} />
      ) : (
        <img src={url} alt="Comprobante" className="w-full rounded-lg" />
      )}
      <a href={url} target="_blank" rel="noreferrer" style={{ color: COLORS.teal }} className="text-sm underline mt-3 inline-block">
        Abrir en una pestaña aparte
      </a>
    </div>
  );
}

function AttachmentField({ onUploaded, onClear, currentUrl }) {
  const [fileName, setFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setFileName(file.name);
    setUploading(true);
    try {
      const url = await uploadAttachment(file);
      onUploaded(url);
    } catch (err) {
      setError(err.message || 'No se pudo subir el archivo');
      setFileName('');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mb-3">
      <label style={{ color: COLORS.inkSoft }} className="block text-sm mb-1">Comprobante (opcional)</label>
      {currentUrl ? (
        <div className="flex items-center justify-between text-sm" style={{ color: COLORS.teal }}>
          <a href={currentUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline">
            <Paperclip size={14} /> Ver comprobante adjunto
          </a>
          <button onClick={onClear} style={{ color: COLORS.inkSoft }}><X size={15} /></button>
        </div>
      ) : (
        <>
          <label style={{ border: `1px dashed ${COLORS.line}`, color: COLORS.inkSoft }} className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm cursor-pointer">
            <Paperclip size={15} />
            {uploading ? 'Subiendo…' : (fileName || 'Adjuntar foto o PDF')}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleChange} disabled={uploading} />
          </label>
          {error && <p style={{ color: COLORS.rust }} className="text-xs mt-1">{error}</p>}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   Onboarding
--------------------------------------------------------- */
function Onboarding({ onDone }) {
  const [nameA, setNameA] = useState('John');
  const [pinA, setPinA] = useState('');
  const [nameB, setNameB] = useState('Marcela');
  const [pinB, setPinB] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!nameA.trim() || !nameB.trim()) { setError('Ponle un nombre a los dos perfiles.'); return; }
    if (!/^\d{4}$/.test(pinA) || !/^\d{4}$/.test(pinB)) { setError('Cada PIN debe tener 4 números.'); return; }
    setSaving(true);
    const data = {
      ...DEFAULT_DATA,
      setupDone: true,
      profiles: [
        { id: uid(), name: nameA.trim(), pin: pinA },
        { id: uid(), name: nameB.trim(), pin: pinB },
      ],
    };
    const ok = await saveData(data);
    setSaving(false);
    if (!ok) { setError('No se pudo guardar. Intenta de nuevo.'); return; }
    onDone(data);
  };

  return (
    <div style={{ background: COLORS.bg, minHeight: '100%' }} className="min-h-screen flex items-center justify-center p-5">
      <div style={{ background: COLORS.card }} className="w-full max-w-sm rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-1">
          <PiggyBank size={26} color={COLORS.teal} />
          <h1 style={{ color: COLORS.ink, fontFamily: 'Fraunces, serif' }} className="text-2xl font-semibold">{APP_NAME}</h1>
        </div>
        <p style={{ color: COLORS.inkSoft }} className="text-sm mb-5">Antes de empezar, crea los dos perfiles del hogar. El PIN es solo para diferenciar quién registra cada movimiento.</p>

        <div style={{ borderTop: `1px solid ${COLORS.line}`, paddingTop: 14 }} className="mb-4">
          <Field label="Nombre — persona 1">
            <TextInput value={nameA} onChange={e => setNameA(e.target.value)} placeholder="John" />
          </Field>
          <Field label="PIN de 4 dígitos">
            <TextInput value={pinA} onChange={e => setPinA(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1234" inputMode="numeric" />
          </Field>
        </div>

        <div style={{ borderTop: `1px solid ${COLORS.line}`, paddingTop: 14 }} className="mb-5">
          <Field label="Nombre — persona 2">
            <TextInput value={nameB} onChange={e => setNameB(e.target.value)} placeholder="Marcela" />
          </Field>
          <Field label="PIN de 4 dígitos">
            <TextInput value={pinB} onChange={e => setPinB(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="5678" inputMode="numeric" />
          </Field>
        </div>

        {error && <p style={{ color: COLORS.rust }} className="text-sm mb-3">{error}</p>}
        <PrimaryButton onClick={submit} disabled={saving}>
          {saving ? 'Guardando…' : 'Crear perfiles'}
        </PrimaryButton>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Login
--------------------------------------------------------- */
function Login({ profiles, onLogin }) {
  const [selected, setSelected] = useState(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const tryLogin = () => {
    const p = profiles.find(p => p.id === selected);
    if (!p) return;
    if (pin === p.pin) { onLogin(p.id); }
    else { setError('PIN incorrecto.'); }
  };

  return (
    <div style={{ background: COLORS.bg, minHeight: '100%' }} className="min-h-screen flex items-center justify-center p-5">
      <div style={{ background: COLORS.card }} className="w-full max-w-sm rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-6">
          <PiggyBank size={26} color={COLORS.teal} />
          <h1 style={{ color: COLORS.ink, fontFamily: 'Fraunces, serif' }} className="text-2xl font-semibold">{APP_NAME}</h1>
        </div>

        {!selected ? (
          <div className="flex flex-col gap-3">
            {profiles.map(p => (
              <button
                key={p.id}
                onClick={() => { setSelected(p.id); setError(''); setPin(''); }}
                style={{ border: `1px solid ${COLORS.line}`, background: '#FCFBF8' }}
                className="flex items-center justify-between p-4 rounded-xl"
              >
                <span className="flex items-center gap-3">
                  <span style={{ background: COLORS.tealSoft, color: COLORS.teal }} className="w-10 h-10 rounded-full flex items-center justify-center">
                    <User size={18} />
                  </span>
                  <span style={{ color: COLORS.ink }} className="font-medium">{p.name}</span>
                </span>
                <ChevronRight size={18} color={COLORS.inkSoft} />
              </button>
            ))}
          </div>
        ) : (
          <div>
            <button onClick={() => setSelected(null)} style={{ color: COLORS.inkSoft }} className="text-sm mb-4">← Elegir otro perfil</button>
            <Field label={`PIN de ${profiles.find(p => p.id === selected)?.name}`}>
              <TextInput
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                autoFocus
              />
            </Field>
            {error && <p style={{ color: COLORS.rust }} className="text-sm mb-3">{error}</p>}
            <PrimaryButton onClick={tryLogin} disabled={pin.length !== 4}>
              <Lock size={16} /> Entrar
            </PrimaryButton>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Main App
--------------------------------------------------------- */
export default function App() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [profileId, setProfileId] = useState(null);
  const [page, setPage] = useState('resumen');
  const [modal, setModal] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [month, setMonth] = useState(monthKey());
  const [pushStatus, setPushStatus] = useState(null);
  const [pushDismissed, setPushDismissed] = useState(false);
  const [viewingAttachment, setViewingAttachment] = useState(null);

  useEffect(() => {
    (async () => {
      const d = await loadData();
      const s = await loadSession();
      setData(d || DEFAULT_DATA);
      if (d && d.setupDone && s && s.profileId && d.profiles.some(p => p.id === s.profileId)) {
        setProfileId(s.profileId);
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!profileId) return;
    getPushStatus().then(setPushStatus);
  }, [profileId]);

  const handleEnablePush = async () => {
    try {
      await enablePushNotifications();
      setPushStatus((s) => ({ ...s, subscribed: true }));
    } catch (e) {
      setSaveError(e.message || 'No se pudo activar la notificación.');
    }
  };

  const persist = useCallback(async (next) => {
    setData(next);
    const ok = await saveData(next);
    if (!ok) setSaveError('No se pudo guardar el último cambio. Revisa tu conexión e intenta de nuevo.');
    else setSaveError('');
  }, []);

  const handleLogin = async (id) => {
    setProfileId(id);
    await saveSession({ profileId: id });
  };
  const handleLogout = async () => {
    setProfileId(null);
    await clearSession();
  };

  const availableMonths = useMemo(() => {
    const set = new Set([monthKey()]);
    if (data) {
      data.incomes.forEach(i => set.add(monthKey(i.date)));
      data.expenses.forEach(e => set.add(monthKey(e.date)));
    }
    return Array.from(set).sort().reverse();
  }, [data]);

  if (loading) {
    return (
      <div style={{ background: COLORS.bg, minHeight: '100%' }} className="min-h-screen flex items-center justify-center">
        <p style={{ color: COLORS.inkSoft }}>Cargando…</p>
      </div>
    );
  }

  if (!data.setupDone) {
    return <Onboarding onDone={(d) => setData(d)} />;
  }

  if (!profileId) {
    return <Login profiles={data.profiles} onLogin={handleLogin} />;
  }

  const me = data.profiles.find(p => p.id === profileId);

  /* ---------- derived data: mes ---------- */
  const monthIncomes = data.incomes.filter(i => monthKey(i.date) === month);
  const monthExpenses = data.expenses.filter(e => monthKey(e.date) === month);
  const totalIncome = monthIncomes.reduce((s, i) => s + Number(i.amount), 0);
  const totalExpense = monthExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const balance = totalIncome - totalExpense;
  const totalGoalsSaved = data.goals.reduce((s, g) => s + Number(g.savedAmount), 0);
  const totalGoalsTarget = data.goals.reduce((s, g) => s + Number(g.targetAmount), 0);

  const expenseByCategory = CATEGORY_DEFS.map(c => ({
    ...c,
    total: monthExpenses.filter(e => e.category === c.id).reduce((s, e) => s + Number(e.amount), 0),
  })).filter(c => c.total > 0);

  /* ---------- derived data: obligaciones ---------- */
  const obligationStatuses = data.obligations.map(o => ({ ob: o, info: computeObligationStatus(o, data.obligationPayments) }));
  const totalDebtRemaining = data.obligations
    .filter(o => o.type === 'deuda' && o.active)
    .reduce((s, o) => s + Number(o.remainingAmount || 0), 0);
  const upcoming = obligationStatuses
    .filter(x => x.info.status !== 'pagado' && x.info.status !== 'terminado')
    .sort((a, b) => a.info.diffDays - b.info.diffDays)
    .slice(0, 5);

  const availableBalance = computeAvailableBalance(data);

  /* ---------- mutation helpers ---------- */
  const addIncome = (payload) => persist({ ...data, incomes: [...data.incomes, { id: uid(), ...payload }] });
  const removeIncome = (id) => persist({ ...data, incomes: data.incomes.filter(i => i.id !== id) });
  const addExpense = (payload) => {
    if (Number(payload.amount) > computeAvailableBalance(data)) {
      setSaveError(`No hay saldo suficiente para registrar ese gasto. Disponible: ${formatCOP(computeAvailableBalance(data))}.`);
      return;
    }
    persist({ ...data, expenses: [...data.expenses, { id: uid(), ...payload }] });
  };
  const removeExpense = (id) => persist({ ...data, expenses: data.expenses.filter(e => e.id !== id) });

  const addObligation = (payload) => {
    const base = { id: uid(), active: true, cuotasPagadas: 0, ...payload };
    if (payload.type === 'deuda' && payload.hasCuotas) base.remainingAmount = Number(payload.totalAmount);
    persist({ ...data, obligations: [...data.obligations, base] });
  };
  const editObligation = (id, changes) => persist({
    ...data,
    obligations: data.obligations.map(o => o.id === id ? { ...o, ...changes } : o),
  });
  const deleteObligation = (id) => {
    const relatedPayments = data.obligationPayments.filter(p => p.obligationId === id);
    const expenseIds = new Set(relatedPayments.map(p => p.expenseId));
    persist({
      ...data,
      obligations: data.obligations.filter(o => o.id !== id),
      obligationPayments: data.obligationPayments.filter(p => p.obligationId !== id),
      expenses: data.expenses.filter(e => !expenseIds.has(e.id)),
    });
  };
  const markObligationPaid = (obligationId, amount, date, personId, attachmentUrl) => {
    const ob = data.obligations.find(o => o.id === obligationId);
    if (!ob) return;
    if (Number(amount) > computeAvailableBalance(data)) {
      setSaveError(`No hay saldo suficiente para registrar ese pago. Disponible: ${formatCOP(computeAvailableBalance(data))}.`);
      return;
    }
    const period = monthKey(date);
    const category = ob.type === 'deuda' ? 'deudas' : ob.category;
    const expense = { id: uid(), personId, category, amount: Number(amount), date, description: ob.name, source: 'obligacion', attachmentUrl: attachmentUrl || null };
    const payment = { id: uid(), obligationId, period, amount: Number(amount), date, personId, attachmentUrl: attachmentUrl || null, expenseId: expense.id };

    const obligations = data.obligations.map(o => {
      if (o.id !== obligationId || o.type !== 'deuda') return o;
      const newRemaining = Math.max(0, Number(o.remainingAmount || 0) - Number(amount));
      const newCuotasPagadas = o.hasCuotas ? Number(o.cuotasPagadas || 0) + 1 : o.cuotasPagadas;
      let active = o.active;
      if (o.hasCuotas && (newCuotasPagadas >= Number(o.totalCuotas) || newRemaining <= 0)) active = false;
      if (!o.hasCuotas && newRemaining <= 0) active = false;
      return { ...o, remainingAmount: newRemaining, cuotasPagadas: newCuotasPagadas, active };
    });

    persist({
      ...data,
      obligations,
      obligationPayments: [...data.obligationPayments, payment],
      expenses: [...data.expenses, expense],
    });
  };
  const undoObligationPayment = (paymentId) => {
    const payment = data.obligationPayments.find(p => p.id === paymentId);
    if (!payment) return;
    const obligations = data.obligations.map(o => {
      if (o.id !== payment.obligationId || o.type !== 'deuda') return o;
      const restored = Number(o.remainingAmount || 0) + Number(payment.amount);
      const cuotasPagadas = o.hasCuotas ? Math.max(0, Number(o.cuotasPagadas || 0) - 1) : o.cuotasPagadas;
      return { ...o, remainingAmount: restored, cuotasPagadas, active: true };
    });
    persist({
      ...data,
      obligations,
      obligationPayments: data.obligationPayments.filter(p => p.id !== paymentId),
      expenses: data.expenses.filter(e => e.id !== payment.expenseId),
    });
  };

  const addGoal = (payload) => persist({ ...data, goals: [...data.goals, { id: uid(), savedAmount: 0, ...payload }] });
  const removeGoal = (id) => persist({
    ...data,
    goals: data.goals.filter(g => g.id !== id),
    goalContributions: data.goalContributions.filter(c => c.goalId !== id),
  });
  const addGoalContribution = (goalId, amount, date) => {
    const goal = data.goals.find(g => g.id === goalId);
    if (!goal) return;
    if (Number(amount) > computeAvailableBalance(data)) {
      setSaveError(`No hay saldo suficiente para apartar ese monto. Disponible: ${formatCOP(computeAvailableBalance(data))}.`);
      return;
    }
    const newSaved = Number(goal.savedAmount) + Number(amount);
    const goals = data.goals.map(g => g.id === goalId ? { ...g, savedAmount: newSaved } : g);
    const goalContributions = [...data.goalContributions, { id: uid(), goalId, amount: Number(amount), date, personId: profileId }];
    persist({ ...data, goals, goalContributions });
  };

  const modalObligationId = typeof modal === 'string' && modal.startsWith('marcarPago:') ? modal.split(':')[1] : null;
  const editObligationId = typeof modal === 'string' && modal.startsWith('editarObligacion:') ? modal.split(':')[1] : null;
  const modalObligation = modalObligationId ? data.obligations.find(o => o.id === modalObligationId) : null;
  const editObligationObj = editObligationId ? data.obligations.find(o => o.id === editObligationId) : null;

  /* ---------- render ---------- */
  return (
    <div style={{ background: COLORS.bg, minHeight: '100%', fontFamily: 'Inter, sans-serif' }} className="min-h-screen pb-24">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@500;600&family=Inter:wght@400;500;600&display=swap');
      `}</style>

      <div style={{ background: COLORS.card, borderBottom: `1px solid ${COLORS.line}` }} className="sticky top-0 z-10 px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PiggyBank size={22} color={COLORS.teal} />
          <span style={{ color: COLORS.ink, fontFamily: 'Fraunces, serif' }} className="text-lg font-semibold">{APP_NAME}</span>
        </div>
        <button onClick={handleLogout} style={{ color: COLORS.inkSoft }} className="flex items-center gap-1 text-sm">
          {me?.name} <LogOut size={16} />
        </button>
      </div>

      {saveError && (
        <div style={{ background: COLORS.rustSoft, color: COLORS.rust }} className="mx-5 mt-3 p-3 rounded-lg text-sm">{saveError}</div>
      )}

      {pushStatus && pushStatus.supported && pushStatus.serverEnabled && !pushStatus.subscribed && !pushDismissed && (
        <div style={{ background: COLORS.tealSoft }} className="mx-5 mt-3 p-3 rounded-lg text-sm flex items-center justify-between gap-3">
          <span style={{ color: COLORS.teal }} className="flex items-center gap-2">
            <Bell size={15} /> Activa el aviso diario de pagos por vencer
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <button onClick={handleEnablePush} style={{ color: COLORS.teal }} className="text-sm font-semibold">Activar</button>
            <button onClick={() => setPushDismissed(true)} style={{ color: COLORS.teal }}><X size={15} /></button>
          </div>
        </div>
      )}

      <div className="max-w-md lg:max-w-6xl mx-auto px-5 pt-4">
        {page === 'resumen' && (
          <ResumenPage
            month={month} setMonth={setMonth} availableMonths={availableMonths}
            totalIncome={totalIncome} totalExpense={totalExpense} balance={balance}
            availableBalance={availableBalance}
            expenseByCategory={expenseByCategory} totalDebt={totalDebtRemaining}
            totalGoalsSaved={totalGoalsSaved} totalGoalsTarget={totalGoalsTarget}
            goals={data.goals}
            upcoming={upcoming}
            onMarkPaid={(id) => setModal(`marcarPago:${id}`)}
          />
        )}
        {page === 'movimientos' && (
          <MovimientosPage
            month={month} setMonth={setMonth} availableMonths={availableMonths}
            incomes={monthIncomes} expenses={monthExpenses}
            profiles={data.profiles}
            onAddIncome={() => setModal('ingreso')}
            onAddExpense={() => setModal('gasto')}
            onRemoveIncome={removeIncome}
            onRemoveExpense={removeExpense}
            onViewAttachment={setViewingAttachment}
          />
        )}
        {page === 'pagos' && (
          <PagosPage
            obligationStatuses={obligationStatuses}
            obligationPayments={data.obligationPayments}
            profiles={data.profiles}
            onAdd={() => setModal('nuevaObligacion')}
            onMarkPaid={(id) => setModal(`marcarPago:${id}`)}
            onUndo={undoObligationPayment}
            onEdit={(id) => setModal(`editarObligacion:${id}`)}
            onDelete={deleteObligation}
            onViewAttachment={setViewingAttachment}
          />
        )}
        {page === 'metas' && (
          <MetasPage
            goals={data.goals}
            goalContributions={data.goalContributions}
            profiles={data.profiles}
            onAdd={() => setModal('meta')}
            onAportar={(id) => setModal(`aporteMeta:${id}`)}
            onRemove={removeGoal}
          />
        )}
      </div>

      <div style={{ background: COLORS.card, borderTop: `1px solid ${COLORS.line}` }} className="fixed bottom-0 left-0 right-0 flex justify-around py-2 z-10">
        <NavButton icon={Wallet} label="Resumen" active={page === 'resumen'} onClick={() => setPage('resumen')} />
        <NavButton icon={ArrowUpCircle} label="Movimientos" active={page === 'movimientos'} onClick={() => setPage('movimientos')} />
        <NavButton icon={Calendar} label="Pagos" active={page === 'pagos'} onClick={() => setPage('pagos')} />
        <NavButton icon={Target} label="Metas" active={page === 'metas'} onClick={() => setPage('metas')} />
      </div>

      {/* modales */}
      <Modal open={modal === 'ingreso'} onClose={() => setModal(null)} title="Registrar ingreso">
        <IncomeForm defaultPerson={profileId} profiles={data.profiles} onSubmit={(p) => { addIncome(p); setModal(null); }} />
      </Modal>

      <Modal open={modal === 'gasto'} onClose={() => setModal(null)} title="Registrar gasto">
        <ExpenseForm defaultPerson={profileId} profiles={data.profiles} availableBalance={availableBalance} onSubmit={(p) => { addExpense(p); setModal(null); }} />
      </Modal>

      <Modal open={modal === 'nuevaObligacion'} onClose={() => setModal(null)} title="Nueva deuda o pago fijo">
        <ObligationForm onSubmit={(p) => { addObligation(p); setModal(null); }} />
      </Modal>

      <Modal open={!!editObligationObj} onClose={() => setModal(null)} title="Editar">
        {editObligationObj && (
          <EditObligationForm
            ob={editObligationObj}
            onSubmit={(changes) => { editObligation(editObligationObj.id, changes); setModal(null); }}
          />
        )}
      </Modal>

      <Modal open={!!modalObligation} onClose={() => setModal(null)} title={`Marcar pagado: ${modalObligation ? modalObligation.name : ''}`}>
        {modalObligation && (
          <MarkPaidForm
            ob={modalObligation}
            profiles={data.profiles}
            defaultPerson={profileId}
            availableBalance={availableBalance}
            onSubmit={({ amount, date, personId, attachmentUrl }) => { markObligationPaid(modalObligation.id, amount, date, personId, attachmentUrl); setModal(null); }}
          />
        )}
      </Modal>

      <Modal open={modal === 'meta'} onClose={() => setModal(null)} title="Nueva meta de ahorro">
        <GoalForm onSubmit={(p) => { addGoal(p); setModal(null); }} />
      </Modal>

      {typeof modal === 'string' && modal.startsWith('aporteMeta:') && (
        <Modal open onClose={() => setModal(null)} title="Agregar a la meta">
          <PaymentForm
            label="Monto a apartar"
            availableBalance={availableBalance}
            onSubmit={({ amount, date }) => { addGoalContribution(modal.split(':')[1], amount, date); setModal(null); }}
          />
        </Modal>
      )}

      <Modal open={!!viewingAttachment} onClose={() => setViewingAttachment(null)} title="Comprobante">
        {viewingAttachment && <AttachmentViewer url={viewingAttachment} />}
      </Modal>
    </div>
  );
}

function NavButton({ icon: Icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 px-2" style={{ color: active ? COLORS.teal : COLORS.inkSoft }}>
      <Icon size={22} />
      <span className="text-xs">{label}</span>
    </button>
  );
}

function MonthSelector({ month, setMonth, availableMonths }) {
  return (
    <Select value={month} onChange={e => setMonth(e.target.value)} style={{ width: 'auto', padding: '8px 10px' }}>
      {availableMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
    </Select>
  );
}

/* ---------------------------------------------------------
   Próximos vencimientos (usado en Resumen)
--------------------------------------------------------- */
function ProximosVencimientos({ upcoming, onMarkPaid }) {
  return (
    <div style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }} className="rounded-2xl p-5 mb-4">
      <p style={{ color: COLORS.ink }} className="font-medium mb-3 flex items-center gap-2">
        <Calendar size={17} color={COLORS.teal} /> Próximos vencimientos
      </p>
      {upcoming.length === 0 && <p style={{ color: COLORS.inkSoft }} className="text-sm">Todo al día, no hay pagos urgentes.</p>}
      <div className="flex flex-col gap-3">
        {upcoming.map(({ ob, info }) => {
          const meta = statusMeta(info.status, info.diffDays);
          const Icon = meta.Icon;
          return (
            <div key={ob.id} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span style={{ background: meta.bg, color: meta.color }} className="w-8 h-8 rounded-full flex items-center justify-center shrink-0">
                  <Icon size={15} />
                </span>
                <div className="min-w-0">
                  <p style={{ color: COLORS.ink }} className="text-sm font-medium truncate">{ob.name}</p>
                  <p style={{ color: meta.color }} className="text-xs">{meta.label}</p>
                </div>
              </div>
              <SecondaryButton tone={info.status === 'vencido' ? 'rust' : 'ochre'} onClick={() => onMarkPaid(ob.id)}>
                Pagar
              </SecondaryButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Resumen page
--------------------------------------------------------- */
function ResumenPage({ month, setMonth, availableMonths, totalIncome, totalExpense, balance, availableBalance, expenseByCategory, totalDebt, totalGoalsSaved, totalGoalsTarget, goals, upcoming, onMarkPaid }) {
  return (
    <div className="lg:max-w-2xl lg:mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 style={{ color: COLORS.ink, fontFamily: 'Fraunces, serif' }} className="text-xl font-semibold">Resumen</h2>
        <MonthSelector month={month} setMonth={setMonth} availableMonths={availableMonths} />
      </div>

      <ProximosVencimientos upcoming={upcoming} onMarkPaid={onMarkPaid} />

      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }} className="rounded-2xl p-5 mb-4">
        <p style={{ color: COLORS.inkSoft }} className="text-sm mb-1">Saldo disponible ahora</p>
        <p style={{ color: availableBalance >= 0 ? COLORS.teal : COLORS.rust, fontFamily: 'Fraunces, serif' }} className="text-3xl font-semibold mb-1">
          {formatCOP(availableBalance)}
        </p>
        <p style={{ color: COLORS.inkSoft }} className="text-xs">Esto es lo que de verdad pueden gastar hoy — ya descuenta lo apartado en metas.</p>
      </div>

      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }} className="rounded-2xl p-5 mb-4">
        <p style={{ color: COLORS.inkSoft }} className="text-sm mb-1">Balance del mes</p>
        <p style={{ color: balance >= 0 ? COLORS.teal : COLORS.rust, fontFamily: 'Fraunces, serif' }} className="text-3xl font-semibold mb-3">
          {formatCOP(balance)}
        </p>
        <div className="flex gap-4 text-sm">
          <span className="flex items-center gap-1" style={{ color: COLORS.teal }}><ArrowUpCircle size={16} /> {formatCOP(totalIncome)}</span>
          <span className="flex items-center gap-1" style={{ color: COLORS.rust }}><ArrowDownCircle size={16} /> {formatCOP(totalExpense)}</span>
        </div>
      </div>

      {expenseByCategory.length > 0 && (
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }} className="rounded-2xl p-5 mb-4">
          <p style={{ color: COLORS.ink }} className="font-medium mb-3">Gastos por categoría</p>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={expenseByCategory} dataKey="total" nameKey="label" innerRadius={45} outerRadius={75} paddingAngle={2}>
                  {expenseByCategory.map((c, i) => <Cell key={i} fill={c.color} />)}
                </Pie>
                <Tooltip formatter={(v) => formatCOP(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col gap-2 mt-2">
            {expenseByCategory.map(c => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2" style={{ color: COLORS.ink }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: c.color, display: 'inline-block' }} />
                  {c.label}
                </span>
                <span style={{ color: COLORS.inkSoft }}>{formatCOP(c.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }} className="rounded-2xl p-5 mb-4">
        <p style={{ color: COLORS.inkSoft }} className="text-sm mb-1">Deuda total pendiente</p>
        <p style={{ color: COLORS.ochre, fontFamily: 'Fraunces, serif' }} className="text-2xl font-semibold">{formatCOP(totalDebt)}</p>
      </div>

      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }} className="rounded-2xl p-5 mb-4">
        <p style={{ color: COLORS.inkSoft }} className="text-sm mb-2">Metas de ahorro</p>
        <p style={{ color: COLORS.teal, fontFamily: 'Fraunces, serif' }} className="text-2xl font-semibold mb-2">
          {formatCOP(totalGoalsSaved)} <span style={{ color: COLORS.inkSoft, fontSize: 15, fontFamily: 'Inter, sans-serif' }}>de {formatCOP(totalGoalsTarget)}</span>
        </p>
        <ProgressBar value={totalGoalsSaved} max={totalGoalsTarget} color={COLORS.teal} />
        {goals.length === 0 && <p style={{ color: COLORS.inkSoft }} className="text-sm mt-3">Aún no tienen metas creadas.</p>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Movimientos page
--------------------------------------------------------- */
function MovimientosPage({ month, setMonth, availableMonths, incomes, expenses, profiles, onAddIncome, onAddExpense, onRemoveIncome, onRemoveExpense, onViewAttachment }) {
  const nameOf = (id) => profiles.find(p => p.id === id)?.name || '—';
  const items = [
    ...incomes.map(i => ({ ...i, kind: 'ingreso' })),
    ...expenses.map(e => ({ ...e, kind: 'gasto' })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="lg:max-w-2xl lg:mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 style={{ color: COLORS.ink, fontFamily: 'Fraunces, serif' }} className="text-xl font-semibold">Movimientos</h2>
        <MonthSelector month={month} setMonth={setMonth} availableMonths={availableMonths} />
      </div>

      <div className="flex gap-3 mb-4">
        <button onClick={onAddIncome} style={{ background: COLORS.tealSoft, color: COLORS.teal }} className="flex-1 py-3 rounded-xl font-medium flex items-center justify-center gap-2">
          <Plus size={16} /> Ingreso
        </button>
        <button onClick={onAddExpense} style={{ background: COLORS.rustSoft, color: COLORS.rust }} className="flex-1 py-3 rounded-xl font-medium flex items-center justify-center gap-2">
          <Plus size={16} /> Gasto
        </button>
      </div>
      <p style={{ color: COLORS.inkSoft }} className="text-xs mb-4">Los pagos de deudas y servicios fijos se registran desde la pestaña "Pagos" — aquí son solo gastos e ingresos sueltos.</p>

      {items.length === 0 && <p style={{ color: COLORS.inkSoft }} className="text-sm">No hay movimientos este mes todavía.</p>}

      <div className="flex flex-col gap-2">
        {items.map(item => {
          const isIncome = item.kind === 'ingreso';
          const cat = !isIncome ? catDef(item.category) : null;
          const Icon = isIncome ? ArrowUpCircle : (cat ? cat.icon : MoreHorizontal);
          const isObligationPayment = !isIncome && item.source === 'obligacion';
          return (
            <div key={item.id} style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }} className="rounded-xl p-3 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <span style={{ background: isIncome ? COLORS.tealSoft : COLORS.rustSoft, color: isIncome ? COLORS.teal : COLORS.rust }} className="w-9 h-9 rounded-full flex items-center justify-center shrink-0">
                  <Icon size={16} />
                </span>
                <div className="min-w-0">
                  <p style={{ color: COLORS.ink }} className="text-sm font-medium truncate flex items-center gap-2">
                    {isIncome ? (INCOME_TYPES.find(t => t.id === item.type)?.label || 'Ingreso') : cat.label}
                    {isObligationPayment && (
                      <span style={{ background: COLORS.bgAlt, color: COLORS.inkSoft }} className="text-[10px] px-1.5 py-0.5 rounded-full font-normal shrink-0">Pago fijo</span>
                    )}
                  </p>
                  <p style={{ color: COLORS.inkSoft }} className="text-xs truncate">{item.date} · {nameOf(item.personId)}{item.description ? ` · ${item.description}` : ''}</p>
                  {item.attachmentUrl && (
                    <button onClick={() => onViewAttachment(item.attachmentUrl)} style={{ color: COLORS.teal }} className="text-xs underline flex items-center gap-1 mt-0.5">
                      <Paperclip size={11} /> Ver comprobante
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span style={{ color: isIncome ? COLORS.teal : COLORS.rust }} className="text-sm font-medium">
                  {isIncome ? '+' : '-'}{formatCOP(item.amount)}
                </span>
                {isObligationPayment ? (
                  <span style={{ color: COLORS.inkSoft }} title="Para deshacer este pago, ve a la pestaña Pagos">
                    <Lock size={14} />
                  </span>
                ) : (
                  <button onClick={() => isIncome ? onRemoveIncome(item.id) : onRemoveExpense(item.id)} style={{ color: COLORS.inkSoft }}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Pagos page (deudas y servicios fijos con vencimiento)
--------------------------------------------------------- */
function ObligationCard({ ob, info, payments, profiles, onMarkPaid, onUndo, onEdit, onDelete, onViewAttachment }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const meta = statusMeta(info.status, info.diffDays);
  const Icon = meta.Icon;

  const hasCuotas = ob.type === 'deuda' && ob.hasCuotas;
  const isRotativo = ob.type === 'deuda' && !ob.hasCuotas;
  const isInterval = ob.scheduleType === 'interval';

  const canMarkPaid = isInterval ? true : !info.paidThisPeriod;
  const canUndo = !!info.lastPayment && (isInterval ? true : info.paidThisPeriod);

  const nameOf = (id) => profiles.find(p => p.id === id)?.name || '—';
  const history = payments
    .filter(p => p.obligationId === ob.id)
    .sort((a, b) => b.date.localeCompare(a.date));

  // Color e ícono de categoría: para deudas siempre el color de "Deudas y
  // tarjetas"; para servicios, el de la categoría elegida (luz, pensión...).
  const catInfo = ob.type === 'servicio' ? catDef(ob.category) : catDef('deudas');
  const CatIcon = catInfo.icon;

  return (
    <div style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, borderLeft: `4px solid ${catInfo.color}` }} className="rounded-xl p-4">
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <span style={{ background: `${catInfo.color}1F`, color: catInfo.color }} className="w-9 h-9 rounded-full flex items-center justify-center shrink-0">
            <CatIcon size={16} />
          </span>
          <div className="min-w-0">
            <p style={{ color: COLORS.ink }} className="font-medium truncate">{ob.name}</p>
            <p style={{ color: COLORS.inkSoft }} className="text-xs">
              {isInterval
                ? `Se paga cada ${ob.intervalDays} días · próximo: ${formatDateHuman(info.dueDate)}`
                : `Vence el día ${ob.dueDay} de cada mes`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => onEdit(ob.id)} style={{ color: COLORS.inkSoft }}><Pencil size={15} /></button>
          {!confirmingDelete && <button onClick={() => setConfirmingDelete(true)} style={{ color: COLORS.inkSoft }}><Trash2 size={15} /></button>}
        </div>
      </div>

      {confirmingDelete && (
        <div className="mb-3">
          <ConfirmRow label="¿Eliminar y borrar su historial?" onConfirm={() => onDelete(ob.id)} onCancel={() => setConfirmingDelete(false)} />
        </div>
      )}

      {hasCuotas && (
        <>
          <ProgressBar value={Number(ob.totalAmount) - Number(ob.remainingAmount)} max={Number(ob.totalAmount)} color={catInfo.color} />
          <p style={{ color: COLORS.inkSoft }} className="text-xs mt-2">
            Cuota {Math.min(Number(ob.cuotasPagadas) + (info.status === 'terminado' ? 0 : 1), Number(ob.totalCuotas))} de {ob.totalCuotas} · faltan {Math.max(0, Number(ob.totalCuotas) - Number(ob.cuotasPagadas))}
          </p>
          <p style={{ color: COLORS.ink }} className="text-sm mt-1">Saldo pendiente: <strong>{formatCOP(ob.remainingAmount)}</strong></p>
        </>
      )}
      {isRotativo && (
        <p style={{ color: COLORS.ink }} className="text-sm">Saldo pendiente: <strong>{formatCOP(ob.remainingAmount)}</strong> · pago esperado {formatCOP(ob.cuotaAmount)}</p>
      )}
      {ob.type === 'servicio' && (
        <p style={{ color: COLORS.ink }} className="text-sm">Monto aproximado: <strong>{formatCOP(ob.cuotaAmount)}</strong></p>
      )}

      <div className="flex items-center gap-2 mt-3">
        <span style={{ background: meta.bg, color: meta.color }} className="text-xs px-2 py-1 rounded-full flex items-center gap-1">
          <Icon size={13} /> {meta.label}
        </span>
      </div>

      {ob.active && (
        <div className="mt-3 flex items-center gap-4 flex-wrap">
          {canMarkPaid && (
            <SecondaryButton onClick={() => onMarkPaid(ob.id)}>
              <CheckCircle2 size={15} /> Marcar como pagado
            </SecondaryButton>
          )}
          {canUndo && (
            <button
              onClick={() => onUndo(info.lastPayment.id)}
              style={{ color: COLORS.inkSoft }}
              className="text-sm flex items-center gap-1"
            >
              <RotateCcw size={14} /> {isInterval ? 'Deshacer último pago' : 'Deshacer pago de este mes'}
            </button>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-3" style={{ borderTop: `1px solid ${COLORS.line}`, paddingTop: 10 }}>
          <button onClick={() => setShowHistory(s => !s)} style={{ color: COLORS.inkSoft }} className="text-xs font-medium">
            {showHistory ? 'Ocultar historial' : `Ver historial (${history.length} pago${history.length === 1 ? '' : 's'})`}
          </button>
          {showHistory && (
            <div className="flex flex-col gap-1.5 mt-2">
              {history.map(p => (
                <div key={p.id} className="flex items-center justify-between text-xs gap-2">
                  <span style={{ color: COLORS.inkSoft }} className="truncate">
                    {p.date} · {nameOf(p.personId)}
                    {p.attachmentUrl && (
                      <button onClick={() => onViewAttachment(p.attachmentUrl)} style={{ color: COLORS.teal }} className="underline ml-1">
                        📎
                      </button>
                    )}
                  </span>
                  <span style={{ color: COLORS.ink }} className="font-medium shrink-0">{formatCOP(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PagosPage({ obligationStatuses, obligationPayments, profiles, onAdd, onMarkPaid, onUndo, onEdit, onDelete, onViewAttachment }) {
  const deudas = obligationStatuses.filter(x => x.ob.type === 'deuda' && x.ob.active)
    .sort((a, b) => a.info.diffDays - b.info.diffDays);
  const servicios = obligationStatuses.filter(x => x.ob.type === 'servicio' && x.ob.active)
    .sort((a, b) => a.info.diffDays - b.info.diffDays);
  const terminadas = obligationStatuses.filter(x => !x.ob.active);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 style={{ color: COLORS.ink, fontFamily: 'Fraunces, serif' }} className="text-xl font-semibold">Pagos</h2>
      </div>
      <button onClick={onAdd} style={{ background: COLORS.ochreSoft, color: COLORS.ochre }} className="w-full lg:w-auto py-3 px-6 rounded-xl font-medium flex items-center justify-center gap-2 mb-5">
        <Plus size={16} /> Nueva deuda o pago fijo
      </button>

      <p style={{ color: COLORS.ink }} className="font-medium mb-2">Deudas</p>
      {deudas.length === 0 && <p style={{ color: COLORS.inkSoft }} className="text-sm mb-4">No tienen deudas activas.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-6">
        {deudas.map(({ ob, info }) => (
          <ObligationCard key={ob.id} ob={ob} info={info} payments={obligationPayments} profiles={profiles} onMarkPaid={onMarkPaid} onUndo={onUndo} onEdit={onEdit} onDelete={onDelete} onViewAttachment={onViewAttachment} />
        ))}
      </div>

      <p style={{ color: COLORS.ink }} className="font-medium mb-2">Servicios y pagos fijos</p>
      {servicios.length === 0 && <p style={{ color: COLORS.inkSoft }} className="text-sm mb-4">No tienen servicios registrados (luz, agua, internet, pensión...).</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-6">
        {servicios.map(({ ob, info }) => (
          <ObligationCard key={ob.id} ob={ob} info={info} payments={obligationPayments} profiles={profiles} onMarkPaid={onMarkPaid} onUndo={onUndo} onEdit={onEdit} onDelete={onDelete} onViewAttachment={onViewAttachment} />
        ))}
      </div>

      {terminadas.length > 0 && (
        <>
          <p style={{ color: COLORS.ink }} className="font-medium mb-2">Terminadas</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {terminadas.map(({ ob, info }) => (
              <ObligationCard key={ob.id} ob={ob} info={info} payments={obligationPayments} profiles={profiles} onMarkPaid={onMarkPaid} onUndo={onUndo} onEdit={onEdit} onDelete={onDelete} onViewAttachment={onViewAttachment} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   Metas page
--------------------------------------------------------- */
function GoalCard({ g, contributions, profiles, onAportar, onRemove }) {
  const [showHistory, setShowHistory] = useState(false);
  const nameOf = (id) => profiles.find(p => p.id === id)?.name || '—';
  const history = contributions
    .filter(c => c.goalId === g.id)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, borderLeft: `4px solid ${COLORS.teal}` }} className="rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p style={{ color: COLORS.ink }} className="font-medium">{g.name}</p>
        <button onClick={() => onRemove(g.id)} style={{ color: COLORS.inkSoft }}><Trash2 size={15} /></button>
      </div>
      <ProgressBar value={g.savedAmount} max={g.targetAmount} color={COLORS.teal} />
      <div className="flex justify-between text-sm mt-2">
        <span style={{ color: COLORS.inkSoft }}>{formatCOP(g.savedAmount)} de {formatCOP(g.targetAmount)}</span>
        {g.targetDate && <span style={{ color: COLORS.inkSoft }}>Meta: {g.targetDate}</span>}
      </div>
      <button onClick={() => onAportar(g.id)} style={{ color: COLORS.teal }} className="text-sm font-medium mt-3">
        + Apartar dinero
      </button>

      {history.length > 0 && (
        <div className="mt-3" style={{ borderTop: `1px solid ${COLORS.line}`, paddingTop: 10 }}>
          <button onClick={() => setShowHistory(s => !s)} style={{ color: COLORS.inkSoft }} className="text-xs font-medium">
            {showHistory ? 'Ocultar historial' : `Ver historial (${history.length} aporte${history.length === 1 ? '' : 's'})`}
          </button>
          {showHistory && (
            <div className="flex flex-col gap-1.5 mt-2">
              {history.map(c => (
                <div key={c.id} className="flex items-center justify-between text-xs">
                  <span style={{ color: COLORS.inkSoft }}>{c.date} · {nameOf(c.personId)}</span>
                  <span style={{ color: COLORS.ink }} className="font-medium">{formatCOP(c.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetasPage({ goals, goalContributions, profiles, onAdd, onAportar, onRemove }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 style={{ color: COLORS.ink, fontFamily: 'Fraunces, serif' }} className="text-xl font-semibold">Metas de ahorro</h2>
      </div>
      <button onClick={onAdd} style={{ background: COLORS.tealSoft, color: COLORS.teal }} className="w-full lg:w-auto py-3 px-6 rounded-xl font-medium flex items-center justify-center gap-2 mb-4">
        <Plus size={16} /> Nueva meta
      </button>

      {goals.length === 0 && <p style={{ color: COLORS.inkSoft }} className="text-sm">Aún no tienen metas. ¡Creen la primera!</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {goals.map(g => (
          <GoalCard key={g.id} g={g} contributions={goalContributions} profiles={profiles} onAportar={onAportar} onRemove={onRemove} />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Forms
--------------------------------------------------------- */
function IncomeForm({ defaultPerson, profiles, onSubmit }) {
  const [personId, setPersonId] = useState(defaultPerson);
  const [amount, setAmount] = useState('');
  const [type, setType] = useState('quincena');
  const [date, setDate] = useState(todayStr());
  const [description, setDescription] = useState('');

  return (
    <div>
      <Field label="¿Quién registra?">
        <Select value={personId} onChange={e => setPersonId(e.target.value)}>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label="Monto">
        <TextInput type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Ej: 100000" />
      </Field>
      <Field label="Tipo de ingreso">
        <Select value={type} onChange={e => setType(e.target.value)}>
          {INCOME_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </Select>
      </Field>
      <Field label="Fecha">
        <TextInput type="date" value={date} onChange={e => setDate(e.target.value)} />
      </Field>
      <Field label="Nota (opcional)">
        <TextInput value={description} onChange={e => setDescription(e.target.value)} placeholder="Ej: pago de la quincena" />
      </Field>
      <PrimaryButton disabled={!amount || Number(amount) <= 0} onClick={() => onSubmit({ personId, amount: Number(amount), type, date, description })}>
        Guardar ingreso
      </PrimaryButton>
    </div>
  );
}

function ExpenseForm({ defaultPerson, profiles, availableBalance, onSubmit }) {
  const [personId, setPersonId] = useState(defaultPerson);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(CATEGORY_DEFS[0].id);
  const [date, setDate] = useState(todayStr());
  const [description, setDescription] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState(null);
  const exceeds = Number(amount) > availableBalance;

  return (
    <div>
      <Field label="¿Quién pagó?">
        <Select value={personId} onChange={e => setPersonId(e.target.value)}>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label="Monto">
        <TextInput type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Ej: 50000" />
      </Field>
      <p style={{ color: exceeds ? COLORS.rust : COLORS.inkSoft }} className="text-xs -mt-2 mb-3">
        Disponible: {formatCOP(availableBalance)}{exceeds ? ' — este gasto supera lo disponible.' : ''}
      </p>
      <Field label="Categoría">
        <Select value={category} onChange={e => setCategory(e.target.value)}>
          {CATEGORY_DEFS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
      </Field>
      <Field label="Fecha">
        <TextInput type="date" value={date} onChange={e => setDate(e.target.value)} />
      </Field>
      <Field label="Nota (opcional)">
        <TextInput value={description} onChange={e => setDescription(e.target.value)} placeholder="Ej: mercado de la semana" />
      </Field>
      <AttachmentField currentUrl={attachmentUrl} onUploaded={setAttachmentUrl} onClear={() => setAttachmentUrl(null)} />
      <PrimaryButton disabled={!amount || Number(amount) <= 0 || exceeds} onClick={() => onSubmit({ personId, amount: Number(amount), category, date, description, attachmentUrl })}>
        Guardar gasto
      </PrimaryButton>
    </div>
  );
}

function ObligationForm({ onSubmit }) {
  const [type, setType] = useState('deuda');
  const [name, setName] = useState('');
  const [hasCuotas, setHasCuotas] = useState(true);
  const [totalAmount, setTotalAmount] = useState('');
  const [totalCuotas, setTotalCuotas] = useState('');
  const [cuotaAmount, setCuotaAmount] = useState('');
  const [remainingAmount, setRemainingAmount] = useState('');
  const [category, setCategory] = useState('vivienda');
  const [scheduleType, setScheduleType] = useState('monthly');
  const [dueDay, setDueDay] = useState('15');
  const [intervalDays, setIntervalDays] = useState('15');
  const [anchorDate, setAnchorDate] = useState(todayStr());
  const [error, setError] = useState('');

  const suggestedCuota = totalAmount && totalCuotas ? Math.round(Number(totalAmount) / Number(totalCuotas)) : null;

  const submit = () => {
    if (!name.trim()) { setError('Ponle un nombre.'); return; }

    let scheduleFields;
    if (scheduleType === 'monthly') {
      const day = Number(dueDay);
      if (!day || day < 1 || day > 31) { setError('El día de vencimiento debe estar entre 1 y 31.'); return; }
      scheduleFields = { scheduleType: 'monthly', dueDay: day };
    } else {
      const interval = Number(intervalDays);
      if (!interval || interval < 1) { setError('Ingresa cada cuántos días se paga (ej: 3, 15).'); return; }
      if (!anchorDate) { setError('Ingresa la fecha del próximo pago.'); return; }
      scheduleFields = { scheduleType: 'interval', intervalDays: interval, anchorDate };
    }

    if (type === 'deuda' && hasCuotas) {
      if (!totalAmount || Number(totalAmount) <= 0) { setError('Ingresa el monto total de la deuda.'); return; }
      if (!totalCuotas || Number(totalCuotas) <= 0) { setError('Ingresa el número de cuotas.'); return; }
      onSubmit({
        type, name: name.trim(), hasCuotas: true, ...scheduleFields,
        totalAmount: Number(totalAmount), totalCuotas: Number(totalCuotas),
        cuotaAmount: Number(cuotaAmount) || suggestedCuota,
      });
    } else if (type === 'deuda' && !hasCuotas) {
      if (!remainingAmount || Number(remainingAmount) <= 0) { setError('Ingresa el saldo actual de la deuda.'); return; }
      onSubmit({
        type, name: name.trim(), hasCuotas: false, ...scheduleFields,
        remainingAmount: Number(remainingAmount), cuotaAmount: Number(cuotaAmount) || 0,
      });
    } else {
      if (!cuotaAmount || Number(cuotaAmount) <= 0) { setError('Ingresa el monto aproximado.'); return; }
      onSubmit({ type, name: name.trim(), ...scheduleFields, category, cuotaAmount: Number(cuotaAmount) });
    }
  };

  return (
    <div>
      <Field label="¿Qué tipo de pago es?">
        <Select value={type} onChange={e => setType(e.target.value)}>
          <option value="deuda">Deuda (tarjeta, colchón, juego de sala...)</option>
          <option value="servicio">Servicio o gasto fijo (luz, agua, internet, pensión...)</option>
        </Select>
      </Field>
      <Field label="Nombre">
        <TextInput value={name} onChange={e => setName(e.target.value)} placeholder={type === 'deuda' ? 'Ej: Tarjeta Falabella' : 'Ej: Luz'} />
      </Field>

      {type === 'deuda' && (
        <Field label="¿Tiene un número fijo de cuotas?">
          <Select value={hasCuotas ? 'si' : 'no'} onChange={e => setHasCuotas(e.target.value === 'si')}>
            <option value="si">Sí, es a cuotas (ej: colchón a 12 meses)</option>
            <option value="no">No, es un saldo abierto (ej: tarjeta de crédito)</option>
          </Select>
        </Field>
      )}

      {type === 'deuda' && hasCuotas && (
        <>
          <Field label="Monto total de la deuda">
            <TextInput type="number" inputMode="decimal" value={totalAmount} onChange={e => setTotalAmount(e.target.value)} placeholder="Ej: 1200000" />
          </Field>
          <Field label="Número de cuotas">
            <TextInput type="number" inputMode="numeric" value={totalCuotas} onChange={e => setTotalCuotas(e.target.value)} placeholder="Ej: 12" />
          </Field>
          <Field label={`Valor de cada cuota${suggestedCuota ? ` (sugerido: ${formatCOP(suggestedCuota)})` : ''}`}>
            <TextInput type="number" inputMode="decimal" value={cuotaAmount} onChange={e => setCuotaAmount(e.target.value)} placeholder={suggestedCuota ? String(suggestedCuota) : 'Ej: 100000'} />
          </Field>
        </>
      )}

      {type === 'deuda' && !hasCuotas && (
        <>
          <Field label="Saldo actual de la deuda">
            <TextInput type="number" inputMode="decimal" value={remainingAmount} onChange={e => setRemainingAmount(e.target.value)} placeholder="Ej: 800000" />
          </Field>
          <Field label="Pago mínimo esperado">
            <TextInput type="number" inputMode="decimal" value={cuotaAmount} onChange={e => setCuotaAmount(e.target.value)} placeholder="Ej: 80000" />
          </Field>
        </>
      )}

      {type === 'servicio' && (
        <>
          <Field label="Categoría">
            <Select value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORY_DEFS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Monto aproximado">
            <TextInput type="number" inputMode="decimal" value={cuotaAmount} onChange={e => setCuotaAmount(e.target.value)} placeholder="Ej: 90000" />
          </Field>
        </>
      )}

      <Field label="¿Cada cuánto se paga?">
        <Select value={scheduleType} onChange={e => setScheduleType(e.target.value)}>
          <option value="monthly">Un día fijo cada mes (ej: el día 15)</option>
          <option value="interval">Cada cierto número de días (ej: cada 3 días, cada 15 días)</option>
        </Select>
      </Field>

      {scheduleType === 'monthly' ? (
        <Field label="Día del mes en que vence (1-31)">
          <TextInput type="number" inputMode="numeric" value={dueDay} onChange={e => setDueDay(e.target.value)} placeholder="Ej: 15" />
        </Field>
      ) : (
        <>
          <Field label="Cada cuántos días se paga">
            <TextInput type="number" inputMode="numeric" value={intervalDays} onChange={e => setIntervalDays(e.target.value)} placeholder="Ej: 3" />
          </Field>
          <Field label="Fecha del próximo pago">
            <TextInput type="date" value={anchorDate} onChange={e => setAnchorDate(e.target.value)} />
          </Field>
        </>
      )}

      {error && <p style={{ color: COLORS.rust }} className="text-sm mb-3">{error}</p>}
      <PrimaryButton onClick={submit}>Guardar</PrimaryButton>
    </div>
  );
}

function EditObligationForm({ ob, onSubmit }) {
  const [name, setName] = useState(ob.name);
  const [scheduleType, setScheduleType] = useState(ob.scheduleType || 'monthly');
  const [dueDay, setDueDay] = useState(String(ob.dueDay || 15));
  const [intervalDays, setIntervalDays] = useState(String(ob.intervalDays || 15));
  const [anchorDate, setAnchorDate] = useState(ob.anchorDate || todayStr());
  const [cuotaAmount, setCuotaAmount] = useState(String(ob.cuotaAmount || ''));
  const [category, setCategory] = useState(ob.category || 'vivienda');
  const [error, setError] = useState('');

  const label = ob.type === 'servicio' ? 'Monto aproximado' : (ob.hasCuotas ? 'Valor de cada cuota' : 'Pago mínimo esperado');

  const submit = () => {
    if (!name.trim()) { setError('Ponle un nombre.'); return; }
    let scheduleFields;
    if (scheduleType === 'monthly') {
      const day = Number(dueDay);
      if (!day || day < 1 || day > 31) { setError('El día debe estar entre 1 y 31.'); return; }
      scheduleFields = { scheduleType: 'monthly', dueDay: day, intervalDays: undefined, anchorDate: undefined };
    } else {
      const interval = Number(intervalDays);
      if (!interval || interval < 1) { setError('Ingresa cada cuántos días se paga.'); return; }
      scheduleFields = { scheduleType: 'interval', intervalDays: interval, anchorDate, dueDay: undefined };
    }
    const changes = { name: name.trim(), cuotaAmount: Number(cuotaAmount) || 0, ...scheduleFields };
    if (ob.type === 'servicio') changes.category = category;
    onSubmit(changes);
  };

  return (
    <div>
      <Field label="Nombre">
        <TextInput value={name} onChange={e => setName(e.target.value)} />
      </Field>
      {ob.type === 'servicio' && (
        <Field label="Categoría">
          <Select value={category} onChange={e => setCategory(e.target.value)}>
            {CATEGORY_DEFS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </Field>
      )}
      <Field label={label}>
        <TextInput type="number" inputMode="decimal" value={cuotaAmount} onChange={e => setCuotaAmount(e.target.value)} />
      </Field>
      <Field label="¿Cada cuánto se paga?">
        <Select value={scheduleType} onChange={e => setScheduleType(e.target.value)}>
          <option value="monthly">Un día fijo cada mes</option>
          <option value="interval">Cada cierto número de días</option>
        </Select>
      </Field>
      {scheduleType === 'monthly' ? (
        <Field label="Día del mes en que vence (1-31)">
          <TextInput type="number" inputMode="numeric" value={dueDay} onChange={e => setDueDay(e.target.value)} />
        </Field>
      ) : (
        <>
          <Field label="Cada cuántos días se paga">
            <TextInput type="number" inputMode="numeric" value={intervalDays} onChange={e => setIntervalDays(e.target.value)} />
          </Field>
          <Field label="Fecha de referencia del próximo pago">
            <TextInput type="date" value={anchorDate} onChange={e => setAnchorDate(e.target.value)} />
          </Field>
          <p style={{ color: COLORS.inkSoft }} className="text-xs mb-3">
            Solo se usa si todavía no se ha registrado ningún pago de esta obligación; después, el ciclo se cuenta desde el último pago.
          </p>
        </>
      )}
      {error && <p style={{ color: COLORS.rust }} className="text-sm mb-3">{error}</p>}
      <PrimaryButton onClick={submit}>Guardar cambios</PrimaryButton>
    </div>
  );
}

function MarkPaidForm({ ob, profiles, defaultPerson, availableBalance, onSubmit }) {
  const [personId, setPersonId] = useState(defaultPerson);
  const [amount, setAmount] = useState(String(ob.cuotaAmount || ''));
  const [date, setDate] = useState(todayStr());
  const [attachmentUrl, setAttachmentUrl] = useState(null);
  const exceeds = Number(amount) > availableBalance;

  return (
    <div>
      <Field label="¿Quién realizó el pago?">
        <Select value={personId} onChange={e => setPersonId(e.target.value)}>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label="Monto pagado">
        <TextInput type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
      </Field>
      <p style={{ color: exceeds ? COLORS.rust : COLORS.inkSoft }} className="text-xs -mt-2 mb-3">
        Disponible: {formatCOP(availableBalance)}{exceeds ? ' — este pago supera lo disponible.' : ''}
      </p>
      <Field label="Fecha del pago">
        <TextInput type="date" value={date} onChange={e => setDate(e.target.value)} />
      </Field>
      <AttachmentField currentUrl={attachmentUrl} onUploaded={setAttachmentUrl} onClear={() => setAttachmentUrl(null)} />
      <p style={{ color: COLORS.inkSoft }} className="text-xs mb-3">Esto también se sumará automáticamente a los gastos del mes.</p>
      <PrimaryButton disabled={!amount || Number(amount) <= 0 || exceeds} onClick={() => onSubmit({ amount: Number(amount), date, personId, attachmentUrl })}>
        Confirmar pago
      </PrimaryButton>
    </div>
  );
}

function GoalForm({ onSubmit }) {
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');

  return (
    <div>
      <Field label="Nombre de la meta">
        <TextInput value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Arreglar la cocina" />
      </Field>
      <Field label="Monto a ahorrar">
        <TextInput type="number" inputMode="decimal" value={targetAmount} onChange={e => setTargetAmount(e.target.value)} placeholder="Ej: 2000000" />
      </Field>
      <Field label="Fecha meta (opcional)">
        <TextInput type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} />
      </Field>
      <PrimaryButton disabled={!name || !targetAmount || Number(targetAmount) <= 0} onClick={() => onSubmit({ name, targetAmount: Number(targetAmount), targetDate })}>
        Guardar meta
      </PrimaryButton>
    </div>
  );
}

function PaymentForm({ onSubmit, label, availableBalance }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayStr());
  const exceeds = availableBalance !== undefined && Number(amount) > availableBalance;
  return (
    <div>
      <Field label={label}>
        <TextInput type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Ej: 50000" />
      </Field>
      {availableBalance !== undefined && (
        <p style={{ color: exceeds ? COLORS.rust : COLORS.inkSoft }} className="text-xs -mt-2 mb-3">
          Disponible: {formatCOP(availableBalance)}{exceeds ? ' — supera lo disponible.' : ''}
        </p>
      )}
      <Field label="Fecha">
        <TextInput type="date" value={date} onChange={e => setDate(e.target.value)} />
      </Field>
      <PrimaryButton disabled={!amount || Number(amount) <= 0 || exceeds} onClick={() => onSubmit({ amount: Number(amount), date })}>
        Guardar
      </PrimaryButton>
    </div>
  );
}
