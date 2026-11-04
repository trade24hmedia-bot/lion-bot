import { useEffect, useState, useCallback } from 'react';
import { sb, fmt, vnDate, rpc } from './lib.js';
import { Toast, Modal, F, useTable } from './ui.jsx';
import { FinOverview, Balance, Profit } from './AdminFinance.jsx';

// Quản trị cơ bản (đợt 1): hệ thống, khách hàng, tài khoản + mã khóa EA, người dùng.
// Chỉ admin / tech được ghi (phân quyền trong cơ sở dữ liệu), core chỉ xem.



export default function Admin({ me, sub }) {
  const editor = ['admin', 'tech'].includes(me?.role);
  const [toast, setToast] = useState('');
  const say = m => { setToast(m); setTimeout(() => setToast(''), 2800); };
  const isAdmin = me?.role === 'admin';
  const tabs = [...(isAdmin ? [['overview', 'Tổng quan'], ['balance', 'Số dư & nạp rút'], ['profit', 'Chia lợi nhuận']] : []), ['accounts', 'Tài khoản & mã EA'], ['customers', 'Khách hàng'], ['systems', 'Hệ thống'], ['vps', 'VPS'], ...(me?.role === 'admin' ? [['users', 'Người dùng']] : [])];
  return (
    <main className="wrap">
      <div className="row"><h1 className="h-lg grow">Quản trị</h1>
        <nav className="tabs">{tabs.map(([k, l]) => <a key={k} href={'#/admin/' + k} className={sub === k ? 'on' : ''}>{l}</a>)}</nav></div>
      {!editor && <div className="pill mut">Tài khoản Core team chỉ xem, không sửa được.</div>}
      {isAdmin && sub === 'overview' ? <FinOverview say={say} />
        : isAdmin && sub === 'balance' ? <Balance say={say} />
        : isAdmin && sub === 'profit' ? <Profit say={say} />
        : sub === 'customers' ? <Customers editor={editor} say={say} />
        : sub === 'systems' ? <Systems editor={editor} say={say} />
        : sub === 'users' ? <Users say={say} />
        : sub === 'vps' ? <Vps editor={editor} say={say} />
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
    const body = { name: edit.name.trim(), parent_id: edit.parent_id || null, leader_customer_id: edit.leader_customer_id || null, leader_name: edit.leader_name?.trim() || null, note: edit.note || null };
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
    <div className="node"><span className="n">{n.name}{(n.leader_customer_id || n.leader_name) && <span className="small muted"> · trưởng nhánh {cname(n.leader_customer_id) || n.leader_name}</span>}</span>
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
          <F label="Tên trưởng nhánh (nếu chưa là khách)"><input id="sys-leadername" value={edit.leader_name || ''} onChange={e => setEdit({ ...edit, leader_name: e.target.value })} /></F>
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
  const [vpsList] = useTable('vps', 'name');
  const [status, setStatus] = useState({});
  const [edit, setEdit] = useState(null); const [saving, setSaving] = useState(false); const [q, setQ] = useState('');
  useEffect(() => {
    rpc('staff_ea_seen').then(data => { const m = {}; (data || []).forEach(r => { m[r.account_id] = r; }); setStatus(m); }).catch(() => {});
  }, [rows]);
  const save = async () => {
    if (!edit.customer_id) return say('Chọn khách hàng');
    if (!edit.account_no?.trim()) return say('Cần nhập số tài khoản');
    setSaving(true);
    const n = v => (v === '' || v == null ? null : Number(v));
    const body = { customer_id: edit.customer_id, account_no: edit.account_no.trim(), broker: edit.broker || null, server: edit.server || null, platform: edit.platform || 'MT5',
      currency: edit.currency || 'USD', share_pct: n(edit.share_pct) ?? 30, bot_name: edit.bot_name || null, package: edit.package || null,
      bot_start: edit.bot_start || null, bot_end: edit.bot_end || null, status: edit.status || 'active', open_balance: n(edit.open_balance), open_date: edit.open_date || null, note: edit.note || null, vps_id: edit.vps_id || null };
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
            <td>{cname(a.customer_id)}{a.bot_end && <div className="small muted">Bot hết hạn {vnDate(a.bot_end)}</div>}</td><td>{a.broker || ''}<div className="small muted">{a.server || ''}</div></td><td className="r num">{fmt(a.share_pct, 0)}%</td>
            <td>{s?.last_seen ? <><span className={'pill ' + (s.stale_days >= 3 ? 'bad' : 'ok')}>{s.stale_days >= 3 ? 'Ngừng ' + s.stale_days + ' ngày' : 'Đang gửi'}</span><div className="small muted">Lần cuối {new Date(s.last_seen).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' })}</div></> : <span className="pill mut">Chưa nhận</span>}</td>
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
          <F label="VPS"><select id="acc-vps" value={edit.vps_id || ''} onChange={e => setEdit({ ...edit, vps_id: e.target.value })}><option value="">— Chưa gán —</option>{(vpsList || []).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></F>
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
      <Invites say={say} reload={load} />
      <div className="title">Người dùng đã đăng nhập ({rows.length})</div>
      <p className="small muted" style={{ margin: 0 }}>Người mới đăng nhập lần đầu sẽ hiện ở đây với vai trò Khách hàng. Đổi vai trò để cấp quyền cho nhân viên.</p>
      <div className="tbl"><table><thead><tr><th>Email</th><th>Khách hàng gắn với</th><th>Vai trò</th></tr></thead><tbody>
        {rows.map(u => <tr key={u.id}><td>{u.email}</td><td>{custs?.find(c => c.id === u.customer_id)?.name || <span className="muted">—</span>}</td>
          <td><select id={'role-' + u.id} className="btn sm" value={u.role} onChange={e => setRole(u.id, e.target.value)}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td></tr>)}
      </tbody></table></div>
    </section>
  );
}

// ------------------------------------------------------------ VPS
const daysLeft = d => (d ? Math.round((new Date(d + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000) : null);
function DueTag({ date }) {
  const n = daysLeft(date); if (n == null) return <span className="muted">—</span>;
  const c = n < 0 ? 'bad' : n <= 3 ? 'warn' : 'ok';
  return <span className={'pill ' + c}>{vnDate(date)} · {n < 0 ? 'quá ' + -n + ' ngày' : n === 0 ? 'hôm nay' : 'còn ' + n + ' ngày'}</span>;
}
function Vps({ editor, say }) {
  const [rows, load, err] = useTable('vps', 'end_date');
  const [accs] = useTable('accounts', 'account_no');
  const [custs] = useTable('customers', 'name');
  const [edit, setEdit] = useState(null); const [saving, setSaving] = useState(false); const [q, setQ] = useState('');
  const openEdit = async v => {
    const e = { ...v, login_user: '', password: '' };
    if (v.id && editor) { const { data } = await sb.from('vps_secrets').select('login_user,password').eq('vps_id', v.id).maybeSingle(); if (data) Object.assign(e, data); }
    setEdit(e);
  };
  const save = async () => {
    if (!edit.name?.trim()) return say('Cần nhập tên / IP VPS');
    setSaving(true);
    const n = v => (v === '' || v == null ? null : Number(v));
    const body = { name: edit.name.trim(), provider: edit.provider || null, spec: edit.spec || null, start_date: edit.start_date || null, end_date: edit.end_date || null, fee_usd: n(edit.fee_usd), note: edit.note || null };
    let id = edit.id, error;
    if (id) ({ error } = await sb.from('vps').update(body).eq('id', id));
    else { const r = await sb.from('vps').insert(body).select('id').single(); error = r.error; id = r.data?.id; }
    if (!error && id && (edit.login_user || edit.password)) ({ error } = await sb.from('vps_secrets').upsert({ vps_id: id, login_user: edit.login_user || null, password: edit.password || null, updated_at: new Date().toISOString() }));
    setSaving(false); if (error) return say(error.message); setEdit(null); load(); say('Đã lưu VPS');
  };
  const del = async () => { const { error } = await sb.from('vps').delete().eq('id', edit.id); if (error) return say(error.message); setEdit(null); load(); say('Đã xóa VPS'); };
  if (err) return <div className="card neg">{err}</div>;
  if (!rows) return <div className="empty">Đang tải…</div>;
  const cname = id => custs?.find(c => c.id === id)?.name || '';
  const onVps = id => (accs || []).filter(a => a.vps_id === id);
  const list = rows.filter(v => !q || (v.name + ' ' + (v.provider || '') + ' ' + onVps(v.id).map(a => a.account_no + ' ' + cname(a.customer_id)).join(' ')).toLowerCase().includes(q.toLowerCase()));
  const soon = rows.filter(v => { const n = daysLeft(v.end_date); return n != null && n <= 3; }).length;
  const free = (accs || []).filter(a => !a.vps_id && a.status === 'active').length;
  return (
    <section className="card">
      <div className="row"><div className="title grow">VPS ({rows.length})</div>
        <label className="field" style={{ width: 'min(260px,100%)' }}><input id="vps-q" type="search" placeholder="Tìm IP, nhà cung cấp, số TK…" value={q} onChange={e => setQ(e.target.value)} /></label>
        {editor && <button className="btn pri" onClick={() => openEdit({})}>+ Thêm VPS</button>}</div>
      <p className="small muted" style={{ margin: 0 }}>
        {soon > 0 && <span className="pill warn" style={{ marginRight: 8 }}>{soon} VPS hết hạn trong 3 ngày</span>}
        {free > 0 && <span className="pill mut" style={{ marginRight: 8 }}>{free} tài khoản đang chạy chưa gán VPS</span>}
        Mật khẩu VPS chỉ Quản lý và Kỹ thuật xem được. Gán VPS cho tài khoản ở tab Tài khoản.</p>
      <div className="tbl"><table><thead><tr><th>VPS</th><th>Cấu hình</th><th>Hết hạn</th><th className="r">Phí/kỳ</th><th>Tài khoản đang chạy</th></tr></thead><tbody>
        {list.map(v => { const on = onVps(v.id); return (
          <tr key={v.id} className={editor ? 'click' : ''} onClick={() => editor && openEdit(v)}>
            <td className="num">{v.name}<div className="small muted">{v.provider || ''}</div></td>
            <td>{v.spec || ''}</td><td><DueTag date={v.end_date} /></td><td className="r num">{v.fee_usd != null ? '$' + fmt(v.fee_usd) : ''}</td>
            <td>{on.length ? on.map(a => <div key={a.id} className="small"><span className="num">{a.account_no}</span> <span className="muted">· {cname(a.customer_id)}</span></div>) : <span className="muted small">Trống</span>}</td>
          </tr>); })}
      </tbody></table></div>
      {edit && <Modal title={edit.id ? 'Sửa VPS' : 'Thêm VPS'} onClose={() => setEdit(null)} onSave={save} saving={saving}
        extra={edit.id && !onVps(edit.id).length && <button type="button" className="btn" style={{ color: 'var(--loss)' }} onClick={del}>Xóa</button>}>
        <div className="form">
          <F label="Tên / IP:port"><input id="vps-name" value={edit.name || ''} onChange={e => setEdit({ ...edit, name: e.target.value })} /></F>
          <F label="Nhà cung cấp"><input id="vps-provider" value={edit.provider || ''} onChange={e => setEdit({ ...edit, provider: e.target.value })} /></F>
          <F label="Cấu hình"><input id="vps-spec" value={edit.spec || ''} onChange={e => setEdit({ ...edit, spec: e.target.value })} placeholder="2 vCPU 8GB" /></F>
          <F label="Phí mỗi kỳ (USD)"><input id="vps-fee" type="number" step="0.01" value={edit.fee_usd ?? ''} onChange={e => setEdit({ ...edit, fee_usd: e.target.value })} /></F>
          <F label="Ngày thuê"><input id="vps-start" type="date" value={edit.start_date || ''} onChange={e => setEdit({ ...edit, start_date: e.target.value })} /></F>
          <F label="Ngày hết hạn"><input id="vps-end" type="date" value={edit.end_date || ''} onChange={e => setEdit({ ...edit, end_date: e.target.value })} /></F>
          <F label="Tài khoản đăng nhập VPS"><input id="vps-user" value={edit.login_user || ''} onChange={e => setEdit({ ...edit, login_user: e.target.value })} autoComplete="off" /></F>
          <F label="Mật khẩu VPS"><input id="vps-pass" value={edit.password || ''} onChange={e => setEdit({ ...edit, password: e.target.value })} autoComplete="off" /></F>
          <F label="Ghi chú" wide><input id="vps-note" value={edit.note || ''} onChange={e => setEdit({ ...edit, note: e.target.value })} /></F>
        </div>
      </Modal>}
    </section>
  );
}

function Invites({ say, reload }) {
  const [rows, load] = useTable('preset_roles', 'email');
  const [f, setF] = useState({ email: '', full_name: '', role: 'tech' });
  const add = async e => {
    e.preventDefault(); if (!f.email.includes('@')) return say('Nhập email');
    const { error } = await sb.from('preset_roles').upsert({ email: f.email.trim().toLowerCase(), full_name: f.full_name || null, role: f.role });
    if (error) return say(error.message); setF({ email: '', full_name: '', role: 'tech' }); load(); reload(); say('Đã mời');
  };
  const del = async email => { await sb.from('preset_roles').delete().eq('email', email); load(); };
  return (
    <div className="card" style={{ background: 'var(--surface-200)' }}>
      <div className="title">Mời nhân viên</div>
      <p className="small muted" style={{ margin: 0 }}>Nhập email nhân viên và vai trò. Khi họ đăng nhập lần đầu sẽ tự có đúng quyền.</p>
      <form className="row" onSubmit={add} style={{ flexWrap: 'wrap' }}>
        <input id="inv-email" type="email" placeholder="email@gmail.com" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
        <input id="inv-name" placeholder="Tên" value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} />
        <select id="inv-role" className="btn sm" value={f.role} onChange={e => setF({ ...f, role: e.target.value })}><option value="admin">Quản lý</option><option value="tech">Kỹ thuật</option><option value="core">Core team</option></select>
        <button className="btn pri sm">Mời</button>
      </form>
      {rows?.length > 0 && <div className="tbl"><table><tbody>{rows.map(r => <tr key={r.email}><td>{r.email}</td><td>{r.full_name || ''}</td><td>{ROLES[r.role]}</td><td className="r"><button className="btn sm" onClick={() => del(r.email)}>Bỏ</button></td></tr>)}</tbody></table></div>}
    </div>
  );
}
