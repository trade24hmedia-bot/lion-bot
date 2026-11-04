import { useState, useEffect, useCallback } from 'react';
import { sb } from './lib.js';

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
