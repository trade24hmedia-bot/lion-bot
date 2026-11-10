import { useEffect, useState, useCallback } from 'react';
import { sb, fmt, vnDate, rpc } from './lib.js';
import { Toast, Modal, F, useTable } from './ui.jsx';
import { FinOverview, Balance, Profit, Telegram, BotLink } from './AdminFinance.jsx';

// Quản trị cơ bản (đợt 1): hệ thống, khách hàng, tài khoản + mã khóa EA, người dùng.
// Chỉ admin / tech được ghi (phân quyền trong cơ sở dữ liệu), core chỉ xem.



export default function Admin({ me, sub }) {
  const editor = ['admin', 'tech'].includes(me?.role);
  const [toast, setToast] = useState('');
  const say = m => { setToast(m); setTimeout(() => setToast(''), 2800); };
  const isAdmin = me?.role === 'admin';
  const tabs = [...(isAdmin ? [['overview', 'Tổng quan'], ['balance', 'Số dư & nạp rút'], ['profit', 'Chia lợi nhuận']] : []), ['accounts', 'Tài khoản & mã EA'], ['customers', 'Khách hàng'], ['systems', 'Hệ thống'], ['vps', 'VPS'], ...(me?.role === 'admin' ? [['users', 'Người dùng'], ...(isAdmin ? [['telegram', 'Telegram'], ['botlink', 'Kết nối bot']] : [])] : [])];
  return (
    <main className="wrap">
      <div className="row"><h1 className="h-lg grow">Quản trị</h1>
        <nav className="tabs">{tabs.map(([k, l]) => <a key={k} href={'#/admin/' + k} className={sub === k ? 'on' : ''}>{l}</a>)}</nav></div>
      {!editor && <div className="pill mut">Tài khoản Core team chỉ xem, không sửa được.</div>}
      {isAdmin && sub === 'overview' ? <FinOverview say={say} />
        : isAdmin && sub === 'balance' ? <Balance say={say} />
        : isAdmin && sub === 'profit' ? <Profit say={say} />
        : isAdmin && sub === 'telegram' ? <Telegram say={say} />
        : isAdmin && sub === 'botlink' ? <BotLink say={say} />
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
const shareUrl = tk => location.origin + '/#/b/' + tk;
function Systems({ editor, say }) {
  const [rows, load, err] = useTable('systems', 'name');
  const [custs] = useTable('customers', 'name');
  const [accs] = useTable('accounts', 'account_no');
  const copyLink = async tk => { try { await navigator.clipboard.writeText(shareUrl(tk)); say('Đã chép link nhánh'); } catch { say(shareUrl(tk)); } };
  const regen = async () => { if (!confirm('Tạo link mới? Link cũ sẽ không mở được nữa.')) return; const { data, error } = await sb.from('systems').update({ share_token: null }).eq('id', edit.id).select('share_token').single(); if (error) return say(error.message); setEdit({ ...edit, share_token: data.share_token }); load(); say('Đã tạo link mới'); };
  const [edit, setEdit] = useState(null); const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!edit.name?.trim()) return say('Cần nhập tên nhánh');
    setSaving(true);
    const body = { name: edit.name.trim(), parent_id: edit.parent_id || null, leader_customer_id: edit.leader_customer_id || null, leader_name: edit.leader_name?.trim() || null, note: edit.note || null,
      master_account_id: edit.master_account_id || null, share_enabled: !!edit.share_enabled, contact: edit.contact?.trim() || null, share_intro: edit.share_intro?.trim() || null };
    if (body.share_enabled && !body.master_account_id) { setSaving(false); return say('Bật link chia sẻ cần chọn tài khoản master'); }
    const { error } = edit.id ? await sb.from('systems').update(body).eq('id', edit.id) : await sb.from('systems').insert(body);
    setSaving(false); if (error) return say(error.message); setEdit(null); load(); say('Đã lưu nhánh');
  };
  const del = async () => { const { error } = await sb.from('systems').delete().eq('id', edit.id); if (error) return say('Không xóa được: nhánh còn nhánh con hoặc khách.'); setEdit(null); load(); say('Đã xóa'); };
  if (err) return <div className="card neg">{err}</div>;
  if (!rows) return <div className="empty">Đang tải…</div>;
  const kids = pid => rows.filter(r => (r.parent_id || null) === (pid || null));
  const desc = id => { const out = new Set([id]); let ch = true; while (ch) { ch = false; rows.forEach(r => { if (r.parent_id && out.has(r.parent_id) && !out.has(r.id)) { out.add(r.id); ch = true; } }); } return out; };
  const cname = id => custs?.find(c => c.id === id)?.name;
  const accNo = id => accs?.find(a => a.id === id)?.account_no || '';
  const inBranch = sid => { if (!sid) return []; const ids = desc(sid); const cs = new Set((custs || []).filter(c => ids.has(c.system_id)).map(c => c.id)); return (accs || []).filter(a => cs.has(a.customer_id)); };
  const walk = pid => { const k = kids(pid); if (!k.length) return null; return <ul>{k.map(n => <li key={n.id}>
    <div className="node"><span className="n">{n.name}{(n.leader_customer_id || n.leader_name) && <span className="small muted"> · trưởng nhánh {cname(n.leader_customer_id) || n.leader_name}</span>}
        {n.share_enabled && n.share_token && <span className="pill ok" style={{ marginLeft: 6 }}>🔗 Link master {accNo(n.master_account_id)}</span>}</span>
      {editor && <span className="row">{n.share_enabled && n.share_token && <button className="btn sm" onClick={() => copyLink(n.share_token)}>Chép link</button>}<button className="btn sm" onClick={() => setEdit({ parent_id: n.id })}>+ Nhánh con</button><button className="btn sm" onClick={() => setEdit({ ...n })}>Sửa</button></span>}</div>
    {walk(n.id)}</li>)}</ul>; };
  const opts = (exclude) => { const ex = exclude ? desc(exclude) : new Set(); const out = []; const w = (pid, d) => kids(pid).forEach(n => { if (ex.has(n.id)) return; out.push(<option key={n.id} value={n.id}>{'— '.repeat(d)}{n.name}</option>); w(n.id, d + 1); }); w(null, 0); return out; };
  return (
    <section className="card tree">
      <div className="row"><div className="title grow">Cây hệ thống</div>{editor && <button className="btn pri" onClick={() => setEdit({})}>+ Hệ thống cấp cao nhất</button>}</div>
      <p className="small muted" style={{ margin: 0 }}>Trưởng nhánh (leader) đăng nhập sẽ xem được toàn bộ tài khoản trong nhánh của mình và mọi nhánh con. Bấm <b>Sửa</b> một nhánh để chọn tài khoản master và bật <b>link chia sẻ</b> cho khách.</p>
      {rows.length ? walk(null) : <div className="empty"><b>Chưa có nhánh nào</b></div>}
      {edit && <Modal title={edit.id ? 'Sửa nhánh' : 'Thêm nhánh'} onClose={() => setEdit(null)} onSave={save} saving={saving}
        extra={edit.id && <button type="button" className="btn" style={{ color: 'var(--loss)' }} onClick={del}>Xóa</button>}>
        <div className="form">
          <F label="Tên nhánh" wide><input id="sys-name" value={edit.name || ''} onChange={e => setEdit({ ...edit, name: e.target.value })} /></F>
          <F label="Thuộc nhánh cha"><select id="sys-parent" value={edit.parent_id || ''} onChange={e => setEdit({ ...edit, parent_id: e.target.value })}><option value="">— Gốc —</option>{opts(edit.id)}</select></F>
          <F label="Trưởng nhánh (khách hàng)"><select id="sys-leader" value={edit.leader_customer_id || ''} onChange={e => setEdit({ ...edit, leader_customer_id: e.target.value })}><option value="">— Chưa có —</option>{(custs || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
          <F label="Tên trưởng nhánh (nếu chưa là khách)"><input id="sys-leadername" value={edit.leader_name || ''} onChange={e => setEdit({ ...edit, leader_name: e.target.value })} /></F>
          <F label="Ghi chú" wide><input id="sys-note" value={edit.note || ''} onChange={e => setEdit({ ...edit, note: e.target.value })} /></F>
          <div style={{ gridColumn: '1/-1', borderTop: '1px solid var(--line)', paddingTop: 12 }}><b>Link chia sẻ của nhánh</b><span className="small muted"> · khách mở link không cần đăng nhập, xem hiệu quả tài khoản master (số TK che 4 số đầu)</span></div>
          <F label="Tài khoản master" wide><select id="sys-master" value={edit.master_account_id || ''} onChange={e => setEdit({ ...edit, master_account_id: e.target.value })}>
            <option value="">— Chưa chọn —</option>
            {(() => { const inb = inBranch(edit.id); const ids = new Set(inb.map(a => a.id)); return <>
              {inb.length > 0 && <optgroup label="Tài khoản trong nhánh">{inb.map(a => <option key={a.id} value={a.id}>{a.account_no} · {cname(a.customer_id)} · {a.broker || ''}</option>)}</optgroup>}
              <optgroup label="Tài khoản khác">{(accs || []).filter(a => !ids.has(a.id)).map(a => <option key={a.id} value={a.id}>{a.account_no} · {cname(a.customer_id)} · {a.broker || ''}</option>)}</optgroup></>; })()}
          </select></F>
          <F label="Liên hệ hiện trên trang (Zalo / Telegram / link)"><input id="sys-contact" placeholder="0901234567 hoặc @telegram hoặc https://…" value={edit.contact || ''} onChange={e => setEdit({ ...edit, contact: e.target.value })} /></F>
          <F label="Bật link chia sẻ"><label className="row" style={{ gap: 8 }}><input id="sys-share" type="checkbox" style={{ width: 20, height: 20 }} checked={!!edit.share_enabled} onChange={e => setEdit({ ...edit, share_enabled: e.target.checked })} /> {edit.share_enabled ? 'Đang bật' : 'Đang tắt'}</label></F>
          <F label="Lời giới thiệu (để trống = mặc định)" wide><textarea id="sys-intro" rows={2} value={edit.share_intro || ''} onChange={e => setEdit({ ...edit, share_intro: e.target.value })} /></F>
          {edit.id && edit.share_token && <F label="Link nhánh" wide><span className="row" style={{ gap: 6 }}><span className="key" style={{ wordBreak: 'break-all' }}>{shareUrl(edit.share_token)}</span>
            <button type="button" className="btn sm" onClick={() => copyLink(edit.share_token)}>Chép</button>
            <a className="btn sm" href={'#/b/' + edit.share_token} target="_blank" rel="noopener noreferrer">Mở thử</a>
            <button type="button" className="btn sm" onClick={regen}>Tạo link mới</button></span>
            {!edit.share_enabled && <span className="small muted">Bật "Bật link chia sẻ" và lưu thì link mới hoạt động.</span>}</F>}
          {!edit.id && <p className="small muted" style={{ gridColumn: '1/-1', margin: 0 }}>Link được tạo sau khi lưu nhánh.</p>}
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
// Gói thời gian sử dụng bot (giống bản Google Sheet)
const PKGS = [['7 ngày', { d: 7 }], ['30 ngày', { d: 30 }], ['3 tháng', { m: 3 }], ['6 tháng', { m: 6 }], ['1 năm', { m: 12 }]];
const addPkg = (start, pkg) => {
  const p = PKGS.find(x => x[0] === pkg)?.[1]; if (!start || !p) return '';
  const d = new Date(start + 'T00:00:00'); if (p.d) d.setDate(d.getDate() + p.d); else d.setMonth(d.getMonth() + p.m);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const today = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).toISOString().slice(0, 10);
const Sec = ({ children, sub }) => <div className="wide" style={{ gridColumn: '1/-1', borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4 }}><b style={{ color: 'var(--ink)' }}>{children}</b>{sub && <span className="small muted"> · {sub}</span>}</div>;

function AccountsAdmin({ editor, say }) {
  const [rows, load, err] = useTable('accounts', 'account_no');
  const [custs, loadCusts] = useTable('customers', 'name');
  const [vpsList, loadVps] = useTable('vps', 'name');
  const [systems] = useTable('systems', 'name');
  const [status, setStatus] = useState({});
  const [edit, setEdit] = useState(null); const [saving, setSaving] = useState(false); const [q, setQ] = useState('');
  useEffect(() => {
    rpc('staff_ea_seen').then(data => { const m = {}; (data || []).forEach(r => { m[r.account_id] = r; }); setStatus(m); }).catch(() => {});
  }, [rows]);
  const set = (k, v) => setEdit(e => {
    const n = { ...e, [k]: v };
    if ((k === 'package' || k === 'bot_start') && !e.endTouched) n.bot_end = addPkg(n.bot_start, n.package) || n.bot_end;
    if (k === 'bot_end') n.endTouched = true;
    if (k === 'bot_start' && (!e.open_date || e.open_date === e.bot_start)) n.open_date = v;
    return n;
  });
  const openNew = () => setEdit({ cust: '', currency: 'USC', share_pct: 30, platform: 'MT5', status: 'active', package: '30 ngày', bot_name: 'LION', bot_version: 'V2',
    bot_start: today(), bot_end: addPkg(today(), '30 ngày'), open_date: today(), vpsSel: '', nv_start: today(), nv_end: addPkg(today(), '30 ngày'), nv_spec: '2 vCPU 8GB' });
  const openEdit = async a => {
    const e = { ...a, cust: a.customer_id, vpsSel: a.vps_id || '', investor_pass: '', endTouched: true };
    const { data } = await sb.from('account_secrets').select('investor_pass').eq('account_id', a.id).maybeSingle();
    if (data) e.investor_pass = data.investor_pass || '';
    setEdit(e);
  };
  const save = async () => {
    const e = edit, n = v => (v === '' || v == null ? null : Number(v));
    if (!e.cust) return say('Chọn khách hàng hoặc chọn "+ Khách mới"');
    if (e.cust === '__new' && !e.nc_name?.trim()) return say('Nhập họ tên khách mới');
    if (!e.account_no?.trim()) return say('Nhập số tài khoản');
    if (e.vpsSel === '__new' && !e.nv_name?.trim()) return say('Nhập tên / IP VPS mới');
    setSaving(true);
    try {
      let customer_id = e.cust;
      if (e.cust === '__new') {
        const r = await sb.from('customers').insert({ name: e.nc_name.trim(), phone: e.nc_phone || null, email: e.nc_email?.trim().toLowerCase() || null, system_id: e.nc_sys || null }).select('id').single();
        if (r.error) throw new Error(r.error.message.includes('duplicate') ? 'Email khách này đã có người dùng' : r.error.message); customer_id = r.data.id;
      }
      let vps_id = e.vpsSel || null;
      if (e.vpsSel === '__new') {
        const r = await sb.from('vps').insert({ name: e.nv_name.trim(), provider: e.nv_provider || null, spec: e.nv_spec || null, start_date: e.nv_start || null, end_date: e.nv_end || null, fee_usd: n(e.nv_fee) }).select('id').single();
        if (r.error) throw new Error(r.error.message); vps_id = r.data.id;
        if (e.nv_user || e.nv_pass) await sb.from('vps_secrets').upsert({ vps_id, login_user: e.nv_user || null, password: e.nv_pass || null });
      }
      const body = { customer_id, account_no: e.account_no.trim(), broker: e.broker?.trim() || null, server: e.server?.trim() || null, platform: e.platform || 'MT5',
        currency: e.currency || 'USD', share_pct: n(e.share_pct) ?? 30, bot_name: e.bot_name || null, bot_version: e.bot_version || null, package: e.package || null,
        bot_start: e.bot_start || null, bot_end: e.bot_end || null, status: e.status || 'active', open_balance: n(e.open_balance), open_date: e.open_date || null,
        note: e.note || null, vps_id, approved: true };
      let id = e.id;
      if (id) { const r = await sb.from('accounts').update(body).eq('id', id); if (r.error) throw r.error; }
      else {
        const r = await sb.from('accounts').insert(body).select('id').single(); if (r.error) throw r.error; id = r.data.id;
        const { data: u } = await sb.auth.getUser();
        await sb.from('renewals').insert({ kind: 'bot', account_id: id, action: 'Cài mới', package: body.package, from_date: body.bot_start, to_date: body.bot_end, done_by: u?.user?.email || null });
      }
      if (e.investor_pass || e.id) await sb.from('account_secrets').upsert({ account_id: id, investor_pass: e.investor_pass || null, updated_at: new Date().toISOString() });
      setEdit(null); load(); loadCusts(); loadVps(); say(e.id ? 'Đã lưu tài khoản' : 'Đã thêm tài khoản. Bấm Chép để lấy mã EA.');
    } catch (x) { say(String(x.message || x).includes('duplicate') ? 'Số tài khoản + server này đã có' : (x.message || String(x))); }
    finally { setSaving(false); }
  };
  const copy = async v => { try { await navigator.clipboard.writeText(v); say('Đã chép mã'); } catch { say('Không chép được, hãy bôi đen để chép'); } };
  if (err) return <div className="card neg">{err}</div>;
  if (!rows) return <div className="empty">Đang tải…</div>;
  const cname = id => custs?.find(c => c.id === id)?.name || '—';
  const sname = id => systems?.find(x => x.id === id)?.name || '';
  const uniq = k => Array.from(new Set(rows.map(r => r[k]).filter(Boolean))).sort();
  const pending = rows.filter(a => a.approved === false || a.blocked);
  const list = rows.filter(a => a.approved !== false && (!q || (a.account_no + ' ' + cname(a.customer_id) + ' ' + (a.broker || '')).toLowerCase().includes(q.toLowerCase())));
  const vUse = id => rows.filter(a => a.vps_id === id).length;
  const e = edit;
  const setBlock = async (a, v) => { if (v && !confirm('Chặn tài khoản ' + a.account_no + '? Web sẽ bỏ qua mọi dữ liệu bot gửi từ tài khoản này.')) return; const { error } = await sb.from('accounts').update({ blocked: v }).eq('id', a.id); if (error) return say(error.message); load(); say(v ? 'Đã chặn' : 'Đã bỏ chặn'); };
  const delPending = async a => { if (!confirm('Xóa tài khoản chờ duyệt ' + a.account_no + ' cùng dữ liệu đã nhận?')) return; const { error } = await sb.from('accounts').delete().eq('id', a.id); if (error) return say(error.message); load(); say('Đã xóa'); };
  const ago = ts => { if (!ts) return '—'; const m = Math.round((Date.now() - new Date(ts)) / 60000); return m < 1 ? 'vừa xong' : m < 60 ? m + ' phút trước' : m < 1440 ? Math.floor(m / 60) + ' giờ trước' : Math.floor(m / 1440) + ' ngày trước'; };
  return (<>
    {pending.length > 0 && <section className="card" style={{ borderColor: 'var(--brand)' }}>
      <div className="row"><div className="title grow">🆕 Tài khoản chờ duyệt / bị chặn ({pending.length})</div></div>
      <p className="small muted" style={{ margin: 0 }}>Bot gửi dữ liệu theo số tài khoản nên web tự tạo các tài khoản này. Bấm <b>Duyệt</b> để gán khách, tỷ lệ chia, VPS… Chưa duyệt thì <b>không</b> tính vào số liệu khách, chia lợi nhuận hay trang công khai.</p>
      <div className="tbl"><table><thead><tr><th>Số TK</th><th>Sàn / server</th><th>Bot</th><th>Lần gửi</th><th></th></tr></thead><tbody>
        {pending.map(a => <tr key={a.id}>
          <td className="num">{a.account_no}<div className="small muted">{a.currency}{a.blocked ? ' · ' : ''}{a.blocked && <span className="pill bad">Đã chặn</span>}</div></td>
          <td>{a.company || a.broker || '—'}<div className="small muted">{a.server || ''}</div></td>
          <td className="small">{a.bot_reported || '—'}<div className="small muted">{a.bot_build || ''}</div></td>
          <td className="small">Đầu: {a.first_seen ? new Date(a.first_seen).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }) : '—'}<div className="small muted">Cuối: {ago(a.last_seen)}</div></td>
          <td className="r">{editor && <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            {a.approved === false && <button className="btn pri sm" onClick={() => openEdit(a)}>Duyệt</button>}
            {a.blocked ? <button className="btn sm" onClick={() => setBlock(a, false)}>Bỏ chặn</button> : <button className="btn sm" onClick={() => setBlock(a, true)}>Chặn</button>}
            {a.approved === false && <button className="btn sm" onClick={() => delPending(a)}>Xóa</button>}</span>}</td>
        </tr>)}
      </tbody></table></div>
    </section>}
    <section className="card">
      <div className="row"><div className="title grow">Tài khoản giao dịch ({list.length})</div>
        <label className="field" style={{ width: 'min(260px,100%)' }}><input id="acc-q" type="search" placeholder="Tìm số TK, khách, sàn…" value={q} onChange={ev => setQ(ev.target.value)} /></label>
        {editor && <button className="btn pri" onClick={openNew}>+ Thêm tài khoản</button>}</div>
      <p className="small muted" style={{ margin: 0 }}>Kỹ thuật nhập sau khi cài bot. Mỗi tài khoản có một <b>mã khóa EA</b> riêng: dán mã này vào Inputs của EA trên đúng tài khoản đó.</p>
      <div className="tbl"><table><thead><tr><th>Số TK</th><th>Khách</th><th>Sàn</th><th className="r">Chia</th><th>Dữ liệu EA</th><th>Mã khóa EA</th></tr></thead><tbody>
        {list.map(a => { const s = status[a.id]; return (
          <tr key={a.id}>
            <td className={editor ? 'click num' : 'num'} onClick={() => editor && openEdit(a)} style={{ cursor: editor ? 'pointer' : 'default' }}>{a.account_no}<div className="small muted">{a.currency}{a.status === 'stopped' ? ' · đã dừng' : ''}</div></td>
            <td>{cname(a.customer_id)}{a.bot_end && <div className="small muted">Bot hết hạn {vnDate(a.bot_end)}</div>}</td><td>{a.broker || ''}<div className="small muted">{a.server || ''}</div></td><td className="r num">{fmt(a.share_pct, 0)}%</td>
            <td>{s?.last_seen ? <><span className={'pill ' + (s.stale_days >= 3 ? 'bad' : 'ok')}>{s.stale_days >= 3 ? 'Ngừng ' + s.stale_days + ' ngày' : 'Đang gửi'}</span><div className="small muted">Lần cuối {new Date(s.last_seen).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' })}</div></> : <span className="pill mut">Chưa nhận</span>}</td>
            <td>{editor ? <span className="row" style={{ gap: 6 }}><span className="key">{a.ingest_key.slice(0, 8)}…</span><button className="btn sm" onClick={() => copy(a.ingest_key)}>Chép</button></span> : '—'}</td>
          </tr>); })}
      </tbody></table></div>
      <datalist id="dl-brokers">{uniq('broker').map(x => <option key={x} value={x} />)}</datalist>
      <datalist id="dl-servers">{uniq('server').map(x => <option key={x} value={x} />)}</datalist>
      <datalist id="dl-bots">{uniq('bot_name').map(x => <option key={x} value={x} />)}</datalist>
      {e && <Modal title={e.id ? 'Sửa tài khoản · ' + e.account_no : 'Thêm tài khoản sau khi cài bot'} onClose={() => setEdit(null)} onSave={save} saving={saving}>
        <div className="form">
          <Sec>1. Khách hàng</Sec>
          <F label="Khách" wide><select id="acc-cus" value={e.cust || ''} onChange={ev => set('cust', ev.target.value)}>
            <option value="">— Chọn khách —</option><option value="__new">+ Khách mới</option>
            {(custs || []).map(c => <option key={c.id} value={c.id}>{c.name}{sname(c.system_id) ? ' · ' + sname(c.system_id) : ''}{c.email ? ' · ' + c.email : ''}</option>)}</select></F>
          {e.cust === '__new' && <>
            <F label="Họ tên khách"><input id="nc-name" value={e.nc_name || ''} onChange={ev => set('nc_name', ev.target.value)} /></F>
            <F label="Số điện thoại / Zalo"><input id="nc-phone" value={e.nc_phone || ''} onChange={ev => set('nc_phone', ev.target.value)} /></F>
            <F label="Thuộc nhánh hệ thống"><select id="nc-sys" value={e.nc_sys || ''} onChange={ev => set('nc_sys', ev.target.value)}><option value="">— Chưa gán —</option>{(systems || []).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></F>
            <F label="Email đăng nhập của khách (để khách xem kết quả)" wide><input id="nc-email" type="email" value={e.nc_email || ''} onChange={ev => set('nc_email', ev.target.value)} /></F>
          </>}
          <Sec>2. Tài khoản giao dịch</Sec>
          <F label="Số tài khoản (ID)"><input id="acc-no" value={e.account_no || ''} onChange={ev => set('account_no', ev.target.value)} inputMode="numeric" /></F>
          <F label="Sàn"><input id="acc-broker" list="dl-brokers" placeholder="Exness, GTC, Vantage…" value={e.broker || ''} onChange={ev => set('broker', ev.target.value)} /></F>
          <F label="Server sàn"><input id="acc-server" list="dl-servers" placeholder="Exness-MT5Real25" value={e.server || ''} onChange={ev => set('server', ev.target.value)} /></F>
          <F label="Nền tảng"><select id="acc-platform" value={e.platform || 'MT5'} onChange={ev => set('platform', ev.target.value)}><option>MT5</option><option>MT4</option></select></F>
          <F label="Đơn vị tiền tài khoản"><select id="acc-cur" value={e.currency || 'USD'} onChange={ev => set('currency', ev.target.value)}><option value="USD">USD</option><option value="USC">USC (tài khoản cent)</option></select></F>
          <F label="Công ty nhận (% lợi nhuận)"><input id="acc-pct" type="number" min="0" max="100" step="0.5" value={e.share_pct ?? 30} onChange={ev => set('share_pct', ev.target.value)} /></F>
          <F label={'Số dư ban đầu (' + (e.currency || 'USD') + ')'}><input id="acc-ob" type="number" step="0.01" placeholder="Số dư lúc cài bot" value={e.open_balance ?? ''} onChange={ev => set('open_balance', ev.target.value)} /></F>
          <F label="Ngày chốt số dư ban đầu"><input id="acc-od" type="date" value={e.open_date || ''} onChange={ev => set('open_date', ev.target.value)} /></F>
          <F label="Passview (mật khẩu xem / Investor) · quản lý, kỹ thuật, core xem"><input id="acc-pv" autoComplete="off" placeholder="Chỉ xem, không vào lệnh được" value={e.investor_pass || ''} onChange={ev => set('investor_pass', ev.target.value)} /></F>
          <Sec>3. Bot & thời gian sử dụng</Sec>
          <F label="Tên bot"><input id="acc-bot" list="dl-bots" value={e.bot_name || ''} onChange={ev => set('bot_name', ev.target.value)} /></F>
          <F label="Phiên bản"><input id="acc-ver" value={e.bot_version || ''} onChange={ev => set('bot_version', ev.target.value)} /></F>
          <F label="Thời gian sử dụng"><select id="acc-pkg" value={e.package || ''} onChange={ev => set('package', ev.target.value)}><option value="">— Chọn gói —</option>{PKGS.map(([l]) => <option key={l}>{l}</option>)}</select></F>
          <F label="Ngày bắt đầu"><input id="acc-start" type="date" value={e.bot_start || ''} onChange={ev => set('bot_start', ev.target.value)} /></F>
          <F label="Ngày hết hạn bot (tự tính theo gói)"><input id="acc-end" type="date" value={e.bot_end || ''} onChange={ev => set('bot_end', ev.target.value)} /></F>
          <F label="Trạng thái"><select id="acc-status" value={e.status || 'active'} onChange={ev => set('status', ev.target.value)}><option value="active">Đang chạy</option><option value="stopped">Đã dừng</option></select></F>
          <Sec>4. VPS</Sec>
          <F label="VPS chạy bot" wide><select id="acc-vps" value={e.vpsSel || ''} onChange={ev => set('vpsSel', ev.target.value)}>
            <option value="">Chưa gán VPS</option>{(vpsList || []).map(v => <option key={v.id} value={v.id}>{v.name}{v.provider ? ' · ' + v.provider : ''} · đang chạy {vUse(v.id)} TK{v.end_date ? ' · hết hạn ' + vnDate(v.end_date) : ''}</option>)}
            <option value="__new">+ VPS mới</option></select></F>
          {e.vpsSel === '__new' && <>
            <F label="Tên / IP:port"><input id="nv-name" value={e.nv_name || ''} onChange={ev => set('nv_name', ev.target.value)} /></F>
            <F label="Nhà cung cấp"><input id="nv-provider" value={e.nv_provider || ''} onChange={ev => set('nv_provider', ev.target.value)} /></F>
            <F label="Cấu hình"><input id="nv-spec" value={e.nv_spec || ''} onChange={ev => set('nv_spec', ev.target.value)} /></F>
            <F label="Phí mỗi kỳ (USD)"><input id="nv-fee" type="number" step="0.01" value={e.nv_fee ?? ''} onChange={ev => set('nv_fee', ev.target.value)} /></F>
            <F label="Ngày thuê"><input id="nv-start" type="date" value={e.nv_start || ''} onChange={ev => set('nv_start', ev.target.value)} /></F>
            <F label="Ngày hết hạn VPS"><input id="nv-end" type="date" value={e.nv_end || ''} onChange={ev => set('nv_end', ev.target.value)} /></F>
            <F label="User đăng nhập VPS"><input id="nv-user" autoComplete="off" value={e.nv_user || ''} onChange={ev => set('nv_user', ev.target.value)} /></F>
            <F label="Mật khẩu VPS (để trống nếu chưa có)"><input id="nv-pass" autoComplete="off" value={e.nv_pass || ''} onChange={ev => set('nv_pass', ev.target.value)} /></F>
          </>}
          <F label="Ghi chú cài đặt" wide><textarea id="acc-note" rows={2} value={e.note || ''} onChange={ev => set('note', ev.target.value)} /></F>
          {e.id && <F label="Mã khóa EA (dán vào Inputs của EA)" wide><span className="row" style={{ gap: 6 }}><span className="key">{e.ingest_key}</span><button type="button" className="btn sm" onClick={() => copy(e.ingest_key)}>Chép</button></span></F>}
        </div>
      </Modal>}
    </section>
  </>);
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
