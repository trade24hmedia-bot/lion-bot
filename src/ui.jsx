import { useState, useEffect, useCallback, useMemo } from 'react';
import { sb, t, vnDate } from './lib.js';

export function Toast({ msg }) { return msg ? <div className="toast">{msg}</div> : null; }

export function Modal({ title, children, onClose, onSave, saving, extra }) {
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={e => { e.preventDefault(); onSave(); }}>
        <div className="row"><div className="title grow">{title}</div><button type="button" className="btn sm" onClick={onClose}>Đóng</button></div>
        {children}
        <div className="row">{extra}<span className="grow" /><button type="button" className="btn" onClick={onClose}>Hủy</button><button className="btn pri" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu'}</button></div>
      </form>
    </div>
  );
}

export const F = ({ label, wide, children }) => <label className={'field' + (wide ? ' wide' : '')}>{label}{children}</label>;

export function useTable(name, order = 'created_at') {
  const [rows, setRows] = useState(null); const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await sb.from(name).select('*').order(order, { ascending: order !== 'created_at' });
    if (error) setErr(error.message); else setRows(data);
  }, [name, order]);
  useEffect(() => { load(); }, [load]);
  return [rows, load, err];
}

// ------------------------------------------------------------ chọn kỳ: tháng / quý / tùy chọn ngày (giờ Việt Nam)
const pad = n => String(n).padStart(2, '0');
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const vnNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
const mStart = (y, m) => new Date(y, m, 1), mEnd = (y, m) => new Date(y, m + 1, 0);
export const mLabel = d => `${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
export function usePeriod(initial = 'month') {
  const now = vnNow();
  const [mode, setMode] = useState(initial);
  const [m, setM] = useState(isoDate(mStart(now.getFullYear(), now.getMonth())));
  const [qtr, setQtr] = useState(`${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`);
  const [from, setFrom] = useState(isoDate(mStart(now.getFullYear(), now.getMonth())));
  const [to, setTo] = useState(isoDate(now));
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => mStart(now.getFullYear(), now.getMonth() - i)), []);
  const quarters = useMemo(() => { const out = []; let y = now.getFullYear(), q = Math.floor(now.getMonth() / 3) + 1; for (let i = 0; i < 6; i++) { out.push(`${y}-Q${q}`); q--; if (!q) { q = 4; y--; } } return out; }, []);
  const range = useMemo(() => {
    if (mode === 'month') { const d = new Date(m + 'T00:00:00'); return { mode, from: m, to: isoDate(mEnd(d.getFullYear(), d.getMonth())), label: t('pMonth') + ' ' + mLabel(d) }; }
    if (mode === 'quarter') { const [y, q] = qtr.split('-Q').map(Number); return { mode, from: isoDate(mStart(y, (q - 1) * 3)), to: isoDate(mEnd(y, q * 3 - 1)), label: `${t('pQuarter')} ${q}/${y}` }; }
    const a = from <= to ? from : to, b = from <= to ? to : from;
    return { mode, from: a, to: b, label: `${vnDate(a)} → ${vnDate(b)}` };
  }, [mode, m, qtr, from, to]);
  const ui = (
    <div className="row" style={{ gap: 8 }}>
      <div className="seg">{[['month', t('pMonth')], ['quarter', t('pQuarter')], ['custom', t('pCustom')]].map(([k, l]) => <button key={k} type="button" className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>)}</div>
      {mode === 'month' && <select id="per-month" className="btn sm" value={m} onChange={e => setM(e.target.value)}>{months.map(d => <option key={isoDate(d)} value={isoDate(d)}>{t('pMonth')} {mLabel(d)}</option>)}</select>}
      {mode === 'quarter' && <select id="per-q" className="btn sm" value={qtr} onChange={e => setQtr(e.target.value)}>{quarters.map(k => <option key={k} value={k}>{t('pQuarter')} {k.split('-Q')[1]}/{k.split('-Q')[0]}</option>)}</select>}
      {mode === 'custom' && <><input id="per-from" type="date" className="btn sm" value={from} onChange={e => setFrom(e.target.value)} /><span className="muted">→</span><input id="per-to" type="date" className="btn sm" value={to} onChange={e => setTo(e.target.value)} /></>}
    </div>);
  return [range, ui];
}
