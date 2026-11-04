import { useEffect, useState, useCallback } from 'react';
import { sb, fmt, vnDate } from './lib.js';

// Quản trị cơ bản (đợt 1): hệ thống, khách hàng, tài khoản + mã khóa EA, người dùng.
// Chỉ admin / tech được ghi (phân quyền trong cơ sở dữ liệu), core chỉ xem.

function Toast({ msg }) { return msg ? <div className="toast">{msg}</div> : null; }

function Modal({ title, children, onClose, onSave, saving, extra }) {
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

const F = ({ label, wide, children }) => <label className={'field' + (wide ? ' wide' : '')}>{label}{children}</label>;

function useTable(name, order = 'created_at') {
  const [rows, setRows] = useState(null); const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await sb.from(name).select('*').order(order, { ascending: order !== 'created_at' });
    if (error) setErr(error.message); else setRows(data);
  }, [name, order]);
  useEffect(() => { load(); }, [load]);
  return [rows, load, err];
}

export default function Admin({ me, sub }) {
  const editor = ['admin', 'tech'].includes(me?.role);
  const [toast, setToast] = useState('');
  const say = m => { setToast(m); setTimeout(() => setToast(''), 2800); };
  const tabs = [['accounts', 'Tài khoản & mã EA'], ['customers', 'Khách hàng'], ['systems', 'Hệ thống'], ...(me?.role === 'admin' ? [['users', 'Người dùng']] : [])];
  return (
    <main className="wrap">
      <div className="row"><h1 className="h-lg grow">Quản trị</h1>
        <nav className="tabs">{tabs.map(([k, l]) => <a key={k} href={'#/admin/' + k} className={sub === k ? 'on' : ''}>{l}</a>)}</nav></div>
      {!editor && <div className="pill mut">Tài khoản Core team chỉ xem, không sửa được.</div>}
      {sub === 'customers' ? <Customers editor={editor} say={say} />
        : sub === 'systems' ? <Systems editor={editor} say={say} />
        : sub === 'users' ? <Users say={say} />
        : <AccountsAdmin editor={editor} say={say} />}
      <Toast msg={toast} />
    </main>
  );
}

// ------------------------------------------------------------ hệ thống
function Systems({ editor, say }) {
  const [rows, load, err] = useTable('systems', 'name');
  const [custs] = useTable('customers', 'name');
  const [edit, setEdit] = useState(null); const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!edit.name?.trim()) return say('Cần nhập tên nhánh');
    setSaving(true);
    const body = { name: edit.name.trim(), parent_id: edit.parent_id || null, leader_customer_id: edit.leader_customer_id || null, note: edit.note || null };
    const { error } = edit.id ? await sb.from('systems').update(body).eq('id', edit.id) : await sb.from('systems').insert(body);
    setSaving(false); if (error) return say(error.message); setEdit(null); load(); say('Đã lưu nhánh');
  };
  const del = async () => { const { error } = await sb.from('systems').delete().eq('id', edit.id); if (error) return say('Không xóa được: nhánh còn nhánh con hoặc khách.'); setEdit(null); load(); say('Đã xóa'); };
  if (err) return <div className="card neg">{err}</div>;
  if (!rows) return <div className="empty">Đang tải…</div>;
  const kids = pid => rows.filter(r => (r.parent_id || null) === (pid || null));
  const desc = id => { const out = new Set([id]); let ch = true; while (ch) { ch = false; rows.forEach(r => { if (r.parent_id && out.has(r.parent_id) && !out.has(r.id)) { out.add(r.id); ch = true; } }); } return out; };
  const cname = id => custs?.find(c => c.id === id)?.name;
  const walk = pid => { const k = kids(pid); if (!k.length) return null; return <ul>{k.map(n => <li key={n.id}>
    <div className="node"><span className="n">{n.name}{n.leader_customer_id && <span className="small muted"> · trưởng nhánh {cname(n.leader_customer_id)}</span>}</span>
      {editor && <span className="row"><button className="btn sm" onClick={() => setEdit({ parent_id: n.id })}>+ Nhánh con</button><button className="btn sm" onClick={() => setEdit({ ...n })}>Sửa</button></span>}</div>
    {walk(n.id)}</li>)}</ul>; };
  const opts = (exclude) => { const ex = exclude ? desc(exclude) : new Set(); const out = []; const w = (pid, d) => kids(pid).forEach(n => { if (ex.has(n.id)) return; out.push(<option key={n.id} value={n.id}>{'— '.repeat(d)}{n.name}</option>); w(n.id, d + 1); }); w(null, 0); return out; };
  return (
    <section className="card tree">
      <div className="row"><div className="title grow">Cây hệ thống</div>{editor && <button className="btn pri" onClick={() => setEdit({})}>+ Hệ thống cấp cao nhất</button>}</div>
      <p className="small muted" style={{ margin: 0 }}>Trưởng nhánh (leader) đăng nhập sẽ xem được toàn bộ tài khoản trong nhánh của mình và mọi nhánh con.</p>
      {rows.length ? walk(null) : <div className="empty"><b>Chưa có nhánh nào</b></div>}
      {edit && <Modal title={edit.id ? 'Sửa nhánh' : 'Thêm nhánh'} onClose={() => setEdit(null)} onSave={save} saving={saving}
        extra={edit.id && <button type="button" className="btn" style={{ color: 'var(--loss)' }} onClick={del}>Xóa</button>}>
        <div className="form">
          <F label="Tên nhánh" wide><input id="sys-name" value={edit.name || ''} onChange={e => setEdit({ ...edit, name: e.target.value })} /></F>
          <F label="Thuộc nhánh cha"><select id="sys-parent" value={edit.parent_id || ''} onChange={e => setEdit({ ...edit, parent_id: e.target.value })}><option value="">— Gốc —</option>{opts(edit.id)}</select></F>
          <F label="Trưởng nhánh (khách hàng)"><select id="sys-leader" value={edit.leader_customer_id || ''} onChange={e => setEdit({ ...edit, leader_customer_id: e.target.value })}><option value="">— Chưa có —</option>{(custs || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
          <F label="Ghi chú" wide><input id="sys-note" value={edit.note || ''} onChange={e => setEdit({ ...edit, note: e.target.value })} /></F>
        </div>
      </Modal>}
    </section>
  );
}

// ------------------------------------------------------------ khách hàng
function Customers({ editor, say }) {
  const [rows, load, err] = useTable('customers', 'name');
  const [systems] = useTable('systems', 'name');
  const [edit, setEdit] = useState(null); const [saving, setSaving] = useState(false); const [q, setQ] = useState('');
  const save = async () => {
    if (!edit.name?.trim()) return say('Cần nhập tên khách');
    setSaving(true);
    const body = { name: edit.name.trim(), email: edit.email?.trim().toLowerCase() || null, phone: edit.phone || null, system_id: edit.system_id || null, note: edit.note || null };
    const { error } = edit.id ? await sb.from('customers').update(body).eq('id', edit.id) : await sb.from('customers').insert(body);
    setSaving(false); if (error) return say(error.message.includes('duplicate') ? 'Email này đã có khách khác dùng' : error.message); setEdit(null); load(); say('Đã lưu khách');
  };
  if (err) return <div className="card neg">{err}</div>;
  if (!rows) return <div className="empty">Đang tải…</div>;
  const sname = id => systems?.find(s => s.id === id)?.name || '—';
  const list = rows.filter(c => !q || (c.name + ' ' + (c.email || '') + ' ' + (c.phone || '')).toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="card">
      <div className="row"><div className="title grow">Khách hàng ({rows.length})</div>
        <label className="field" style={{ width: 'min(260px,100%)' }}><input id="cus-q" type="search" placeholder="Tìm tên, email, SĐT…" value={q} onChange={e => setQ(e.target.value)} /></label>
        {editor && <button className="btn pri" onClick={() => setEdit({})}>+ Thêm khách</button>}</div>
      <p className="small muted" style={{ margin: 0 }}>Khách đăng nhập bằng đúng email ghi ở đây. Chưa có email thì khách chưa đăng nhập được.</p>
      <div className="tbl"><table><thead><tr><th>Tên</th><th>Email</th><th>SĐT</th><th>Hệ thống</th></tr></thead><tbody>
        {list.map(c => <tr key={c.id} className={editor ? 'click' : ''} onClick={() => editor && setEdit({ ...c })}><td>{c.name}</td><td>{c.email || <span className="muted">—</span>}</td><td>{c.phone || ''}</td><td>{sname(c.system_id)}</td></tr>)}
      </tbody></table></div>
      {edit && <Modal title={edit.id ? 'Sửa khách' : 'Thêm khách'} onClose={() => setEdit(null)} onSave={save} saving={saving}>
        <div className="form">
          <F label="Họ tên"><input id="cus-name" value={edit.name || ''} onChange={e => setEdit({ ...edit, name: e.target.value })} /></F>
          <F label="Email đăng nhập"><input id="cus-email" type="email" value={edit.email || ''} onChange={e => setEdit({ ...edit, email: e.target.value })} /></F>
          <F label="SĐT / Zalo"><input id="cus-phone" value={edit.phone || ''} onChange={e => setEdit({ ...edit, phone: e.target.value })} /></F>
          <F label="Thuộc nhánh"><select id="cus-sys" value={edit.system_id || ''} onChange={e => setEdit({ ...edit, system_id: e.target.value })}><option value="">— Chưa gán —</option>{(systems || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></F>
          <F label="Ghi chú" wide><input id="cus-note" value={edit.note || ''} onChange={e => setEdit({ ...edit, note: e.target.value })} /></F>
        </div>
      </Modal>}
    </section>
  );
}

// ------------------------------------------------------------ tài khoản
function AccountsAdmin({ editor, say }) {
  const [rows, load, err] = useTable('accounts', 'account_no');
  const [custs] = useTable('customers', 'name');
  const [status, setStatus] = useState({});
  const [edit, setEdit] = useState(null); const [saving, setSaving] = useState(false); const [q, setQ] = useState('');
  useEffect(() => {
    sb.from('daily_results').select('account_id,date,balance,received_at').order('date', { ascending: false }).limit(2000)
      .then(({ data }) => { const m = {}; (data || []).forEach(r => { if (!m[r.account_id]) m[r.account_id] = r; }); setStatus(m); });
  }, [rows]);
  const save = async () => {
    if (!edit.customer_id) return say('Chọn khách hàng');
    if (!edit.account_no?.trim()) return say('Cần nhập số tài khoản');
    setSaving(true);
    const n = v => (v === '' || v == null ? null : Number(v));
    const body = { customer_id: edit.customer_id, account_no: edit.account_no.trim(), broker: edit.broker || null, server: edit.server || null, platform: edit.platform || 'MT5',
      currency: edit.currency || 'USD', share_pct: n(edit.share_pct) ?? 30, bot_name: edit.bot_name || null, package: edit.package || null,
      bot_start: edit.bot_start || null, bot_end: edit.bot_end || null, status: edit.status || 'active', open_balance: n(edit.open_balance), open_date: edit.open_date || null, note: edit.note || null };
    const { error } = edit.id ? await sb.from('accounts').update(body).eq('id', edit.id) : await sb.from('accounts').insert(body);
    setSaving(false); if (error) return say(error.message.includes('duplicate') ? 'Số tài khoản + server này đã có' : error.message); setEdit(null); load(); say('Đã lưu tài khoản');
  };
  const copy = async v => { try { await navigator.clipboard.writeText(v); say('Đã chép mã'); } catch { say('Không chép được, hãy bôi đen để chép'); } };
  if (err) return <div className="card neg">{err}</div>;
  if (!rows) return <div className="empty">Đang tải…</div>;
  const cname = id => custs?.find(c => c.id === id)?.name || '—';
  const list = rows.filter(a => !q || (a.account_no + ' ' + cname(a.customer_id) + ' ' + (a.broker || '')).toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="card">
      <div className="row"><div className="title grow">Tài khoản giao dịch ({rows.length})</div>
        <label className="field" style={{ width: 'min(260px,100%)' }}><input id="acc-q" type="search" placeholder="Tìm số TK, khách, sàn…" value={q} onChange={e => setQ(e.target.value)} /></label>
        {editor && <button className="btn pri" onClick={() => setEdit({ currency: 'USD', share_pct: 30, platform: 'MT5', status: 'active' })}>+ Thêm tài khoản</button>}</div>
      <p className="small muted" style={{ margin: 0 }}>Mỗi tài khoản có một <b>mã khóa EA</b> riêng. Kỹ thuật dán mã này vào Inputs của EA trên đúng tài khoản đó.</p>
      <div className="tbl"><table><thead><tr><th>Số TK</th><th>Khách</th><th>Sàn</th><th className="r">Chia</th><th>Dữ liệu EA</th><th>Mã khóa EA</th></tr></thead><tbody>
        {list.map(a => { const s = status[a.id]; return (
          <tr key={a.id}>
            <td className={editor ? 'click num' : 'num'} onClick={() => editor && setEdit({ ...a })} style={{ cursor: editor ? 'pointer' : 'default' }}>{a.account_no}<div className="small muted">{a.currency}{a.status === 'stopped' ? ' · đã dừng' : ''}</div></td>
            <td>{cname(a.customer_id)}</td><td>{a.broker || ''}<div className="small muted">{a.server || ''}</div></td><td className="r num">{fmt(a.share_pct, 0)}%</td>
            <td>{s ? <><span className="num">{fmt(s.balance)}</span><div className="small muted">{vnDate(s.date)}</div></> : <span className="pill mut">Chưa nhận</span>}</td>
            <td>{editor ? <span className="row" style={{ gap: 6 }}><span className="key">{a.ingest_key.slice(0, 8)}…</span><button className="btn sm" onClick={() => copy(a.ingest_key)}>Chép</button></span> : '—'}</td>
          </tr>); })}
      </tbody></table></div>
      {edit && <Modal title={edit.id ? 'Sửa tài khoản' : 'Thêm tài khoản'} onClose={() => setEdit(null)} onSave={save} saving={saving}>
        <div className="form">
          <F label="Khách hàng" wide><select id="acc-cus" value={edit.customer_id || ''} onChange={e => setEdit({ ...edit, customer_id: e.target.value })}><option value="">— Chọn —</option>{(custs || []).map(c => <option key={c.id} value={c.id}>{c.name}{c.email ? ' · ' + c.email : ''}</option>)}</select></F>
          <F label="Số tài khoản"><input id="acc-no" value={edit.account_no || ''} onChange={e => setEdit({ ...edit, account_no: e.target.value })} inputMode="numeric" /></F>
          <F label="Sàn"><input id="acc-broker" value={edit.broker || ''} onChange={e => setEdit({ ...edit, broker: e.target.value })} /></F>
          <F label="Server"><input id="acc-server" value={edit.server || ''} onChange={e => setEdit({ ...edit, server: e.target.value })} /></F>
          <F label="Đơn vị tiền"><select id="acc-cur" value={edit.currency || 'USD'} onChange={e => setEdit({ ...edit, currency: e.target.value })}><option>USD</option><option value="USC">USC (tài khoản cent)</option></select></F>
          <F label="Công ty nhận (%)"><input id="acc-pct" type="number" min="0" max="100" step="0.5" value={edit.share_pct ?? 30} onChange={e => setEdit({ ...edit, share_pct: e.target.value })} /></F>
          <F label="Tên bot"><input id="acc-bot" value={edit.bot_name || ''} onChange={e => setEdit({ ...edit, bot_name: e.target.value })} /></F>
          <F label="Ngày bắt đầu bot"><input id="acc-start" type="date" value={edit.bot_start || ''} onChange={e => setEdit({ ...edit, bot_start: e.target.value })} /></F>
          <F label="Ngày hết hạn bot"><input id="acc-end" type="date" value={edit.bot_end || ''} onChange={e => setEdit({ ...edit, bot_end: e.target.value })} /></F>
          <F label="Số dư ban đầu (đơn vị TK)"><input id="acc-ob" type="number" step="0.01" value={edit.open_balance ?? ''} onChange={e => setEdit({ ...edit, open_balance: e.target.value })} /></F>
          <F label="Ngày chốt số dư"><input id="acc-od" type="date" value={edit.open_date || ''} onChange={e => setEdit({ ...edit, open_date: e.target.value })} /></F>
          <F label="Trạng thái"><select id="acc-status" value={edit.status || 'active'} onChange={e => setEdit({ ...edit, status: e.target.value })}><option value="active">Đang chạy</option><option value="stopped">Đã dừng</option></select></F>
          <F label="Ghi chú" wide><input id="acc-note" value={edit.note || ''} onChange={e => setEdit({ ...edit, note: e.target.value })} /></F>
          {edit.id && <F label="Mã khóa EA (dán vào Inputs của EA)" wide><span className="key">{edit.ingest_key}</span></F>}
        </div>
      </Modal>}
    </section>
  );
}

// ------------------------------------------------------------ người dùng
const ROLES = { admin: 'Quản lý', tech: 'Kỹ thuật', core: 'Core team', customer: 'Khách hàng' };
function Users({ say }) {
  const [rows, load, err] = useTable('profiles', 'email');
  const [custs] = useTable('customers', 'name');
  const setRole = async (id, role) => { const { error } = await sb.from('profiles').update({ role }).eq('id', id); if (error) return say(error.message); load(); say('Đã đổi vai trò'); };
  if (err) return <div className="card neg">{err}</div>;
  if (!rows) return <div className="empty">Đang tải…</div>;
  return (
    <section className="card">
      <div className="title">Người dùng đã đăng nhập ({rows.length})</div>
      <p className="small muted" style={{ margin: 0 }}>Người mới đăng nhập lần đầu sẽ hiện ở đây với vai trò Khách hàng. Đổi vai trò để cấp quyền cho nhân viên.</p>
      <div className="tbl"><table><thead><tr><th>Email</th><th>Khách hàng gắn với</th><th>Vai trò</th></tr></thead><tbody>
        {rows.map(u => <tr key={u.id}><td>{u.email}</td><td>{custs?.find(c => c.id === u.customer_id)?.name || <span className="muted">—</span>}</td>
          <td><select id={'role-' + u.id} className="btn sm" value={u.role} onChange={e => setRole(u.id, e.target.value)}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td></tr>)}
      </tbody></table></div>
    </section>
  );
}
