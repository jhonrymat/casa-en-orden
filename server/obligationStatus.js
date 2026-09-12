// Misma lógica de vencimientos que usa el frontend (src/App.jsx), pero para
// que el servidor pueda revisar los pagos sin depender de que alguien tenga
// la app abierta en el navegador.

function daysInMonth(year, month1based) {
  return new Date(year, month1based, 0).getDate();
}

function parseDateLocal(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function computeObligationStatus(ob, obligationPayments) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const payments = obligationPayments
    .filter((p) => p.obligationId === ob.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const lastPayment = payments.length ? payments[payments.length - 1] : null;

  let dueDate, period = null, paidThisPeriod = false;

  if (ob.scheduleType === 'interval') {
    const intervalDays = Number(ob.intervalDays) || 1;
    dueDate = lastPayment
      ? addDays(parseDateLocal(lastPayment.date), intervalDays)
      : parseDateLocal(ob.anchorDate || today.toISOString().slice(0, 10));
    dueDate.setHours(0, 0, 0, 0);
  } else {
    const y = today.getFullYear();
    const m = today.getMonth() + 1;
    period = `${y}-${String(m).padStart(2, '0')}`;
    const dim = daysInMonth(y, m);
    const day = Math.min(Number(ob.dueDay) || 1, dim);
    dueDate = new Date(y, m - 1, day);
    dueDate.setHours(0, 0, 0, 0);
    paidThisPeriod = obligationPayments.some((p) => p.obligationId === ob.id && p.period === period);
  }

  const diffDays = Math.round((dueDate - today) / 86400000);

  let status;
  if (!ob.active) status = 'terminado';
  else if (paidThisPeriod) status = 'pagado';
  else if (diffDays < 0) status = 'vencido';
  else if (diffDays <= 5) status = 'proximo';
  else status = 'pendiente';

  return { period, dueDate, diffDays, status, paidThisPeriod };
}
