import { useEffect, useMemo, useState, useCallback } from 'react';
import { sb, rpc, fmt, usd, signed, signedUsd, cls, vnDate } from './lib.js';
import { Modal, F, useTable } from './ui.jsx';

// Màn tài chính: CHỈ QUẢN LÝ (cơ sở dữ liệu cũng chặn, không chỉ ẩn nút).

const toUsd = (v, cur) => (v == null ? null : cur === 'USC' ? Number(v) / 100 : Number(v));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const vnNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
const monthStart = (y, m) => new Date(y, m, 1);
const monthEnd = (y, m) => new Date(y, m + 1, 0);
const lastMonths = n => { const t = vnNow(); return Array.from({ length: n }, (_, i) => monthStart(t.getFullYear(), t.getMonth() - i)); };
const mLabel = d => `${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const accLabel = r => <><span>{r.customer}</span><div className="small muted"><span className="num">{r.account_no}</span> · {r.broker || ''}{r.system ? ' · ' + r.system : ''}</div></>;
// Số theo đơn vị tài khoản, kèm USD nếu là USC
const Amt = ({ v, cur, sign, dim }) => v == null || v === '' ? <span className="muted">—</span> : (
  <><span className={'num ' + (sign ? cls(v) : '')}>{sign ? signed(v) : fmt(v)}</span>
    {cur === 'USC' && !dim && <div className="small muted num">{sign ? signedUsd(toUsd(v, cur)) : usd(toUsd(v, cur))}</div>}</>);
const Kpi = ({ label, value, sub, tone }) => <div className="kpi"><span className="label">{label}</span><span className={'num-xl ' + (tone || '')}>{value}</span>{sub && <span className="sub">{sub}</span>}</div>;
const Search = ({ q, setQ, ph }) => <label className="field" style={{ width: 'min(260px,100%)' }}><input type="search" placeholder={ph || 'Tìm khách, số TK, sàn, nhánh…'} value={q} onChange={e => setQ(e.target.value)} /></label>;
const hit = (r, q) => !q || [r.customer, r.account_no, r.broker, r.system].join(' ').toLowerCase().includes(q.toLowerCase());
const seenTxt = ts => ts ? new Date(ts).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }) : '';

function BotCell({ r }) {
  if (!r.seen) return <span className="pill mut">Chưa nhận</span>;
  const d = r.stale_days || 0;
  return <><span className={'pill ' + (d >= 3 ? 'bad' : 'ok')}>{d >= 3 ? `Ngừng ${d} ngày` : 'Đang gửi'}</span><div className="small muted">{seenTxt(r.seen)}</div></>;
}

// ------------------------------------------------------------ chọn kỳ
function usePeriod() {
  const t = vnNow();
  const [mode, setMode] = useState('month');
  const [m, setM] = useState(iso(monthStart(t.getFullYear(), t.getMonth())));
  const [qtr, setQtr] = useState(`${t.getFullYear()}-Q${Math.floor(t.getMonth() / 3) + 1}`);
  const [from, setFrom] = useState(iso(monthStart(t.getFullYear(), t.getMonth())));
  const [to, setTo] = useState(iso(t));
  const range = useMemo(() => {
    if (mode === 'month') { const d = new Date(m + 'T00:00:00'); return { from: m, to: iso(monthEnd(d.getFullYear(), d.getMonth())), label: 'Tháng ' + mLabel(d) }; }
    if (mode === 'quarter') { const [y, q] = qtr.split('-Q').map(Number); return { from: iso(monthStart(y, (q - 1) * 3)), to: iso(monthEnd(y, q * 3 - 1)), label: `Quý ${q}/${y}` }; }
    return { from, to, label: `${vnDate(from)} → ${vnDate(to)}` };
  }, [mode, m, qtr, from, to]);
  const quarters = useMemo(() => { const out = []; let y = t.getFullYear(), q = Math.floor(t.getMonth() / 3) + 1; for (let i = 0; i < 6; i++) { out.push(`${y}-Q${q}`); q--; if (!q) { q = 4; y--; } } return out; }, []);
  const ui = (
    <div className="row">
      <div className="seg">{[['month', 'Tháng'], ['quarter', 'Quý'], ['custom', 'Tùy chọn ngày']].map(([k, l]) => <button key={k} type="button" className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>)}</div>
      {mode === 'month' && <select id="per-month" className="btn sm" value={m} onChange={e => setM(e.target.value)}>{lastMonths(12).map(d => <option key={iso(d)} value={iso(d)}>Tháng {mLabel(d)}</option>)}</select>}
      {mode === 'quarter' && <select id="per-q" className="btn sm" value={qtr} onChange={e => setQtr(e.target.value)}>{quarters.map(k => <option key={k} value={k}>Quý {k.split('-Q')[1]}/{k.split('-Q')[0]}</option>)}</select>}
      {mode === 'custom' && <><input id="per-from" type="date" className="btn sm" value={from} onChange={e => setFrom(e.target.value)} /><span className="muted">→</span><input id="per-to" type="date" className="btn sm" value={to} onChange={e => setTo(e.target.value)} /></>}
    </div>);
  return [range, ui];
}

// ------------------------------------------------------------ tổng quan
export function FinOverview() {
  const t = vnNow();
  const m0 = iso(monthStart(t.getFullYear(), t.getMonth())), m1 = iso(monthEnd(t.getFullYear(), t.getMonth()));
  const [bal, setBal] = useState(null); const [pro, setPro] = useState(null); const [err, setErr] = useState('');
  const [accs] = useTable('accounts', 'account_no'); const [vps] = useTable('vps', 'end_date'); const [custs] = useTable('customers', 'name');
  useEffect(() => {
    rpc('admin_balance', { p_from: m0, p_to: m1 }).then(setBal).catch(e => setErr(e.message));
    rpc('admin_profit', { p_month: m0 }).then(setPro).catch(e => setErr(e.message));
  }, []);
  if (err) return <div className="card neg">{err}</div>;
  if (!bal || !pro || !accs || !vps) return <div className="empty">Đang tải…</div>;
  const active = bal.filter(r => r.status !== 'stopped');
  const cap = active.reduce((s, r) => s + (toUsd(r.p?.ea_bal ?? r.p?.close, r.currency) || 0), 0);
  const net = bal.reduce((s, r) => s + (toUsd(r.p?.net, r.currency) || 0), 0);
  const flo = bal.reduce((s, r) => s + (toUsd(r.st?.floating, r.currency) || 0), 0);
  const due = pro.rows.reduce((s, r) => s + Number(r.due || 0), 0), paid = pro.rows.reduce((s, r) => s + Number(r.paid || 0), 0);
  const today = new Date(iso(t) + 'T00:00:00');
  const left = d => (d ? Math.round((new Date(d + 'T00:00:00') - today) / 864e5) : null);
  const cname = id => custs?.find(c => c.id === id)?.name || '';
  const botDue = accs.filter(a => a.status !== 'stopped' && left(a.bot_end) != null && left(a.bot_end) <= 3).sort((a, b) => (a.bot_end > b.bot_end ? 1 : -1));
  const vpsDue = vps.filter(v => left(v.end_date) != null && left(v.end_date) <= 3);
  const stale = active.filter(r => (r.stale_days || 0) >= 3);
  const off = bal.filter(r => r.p?.diff != null && Math.abs(r.p.diff) >= 1);
  const noVps = accs.filter(a => a.status !== 'stopped' && !a.vps_id);
  const leftTxt = n => n < 0 ? `quá ${-n} ngày` : n === 0 ? 'hôm nay' : `còn ${n} ngày`;
  const Box = ({ title, n, tone, children }) => (
    <section className="card"><div className="row"><div className="title grow">{title}</div><span className={'pill ' + (n ? tone : 'ok')}>{n || 'Không có'}</span></div>{n > 0 && <div className="tbl"><table><tbody>{children}</tbody></table></div>}</section>);
  return (
    <>
      <section className="kpis">
        <Kpi label="Vốn đang chạy" value={usd(cap)} sub={`${active.length} tài khoản đang chạy`} />
        <Kpi label={'Lãi/lỗ ròng tháng ' + mLabel(t)} value={signedUsd(net)} tone={cls(net)} sub={'PNL chưa chốt ' + signedUsd(flo)} />
        <Kpi label="Công ty phải thu tháng này" value={usd(due)} sub={'Đã thu ' + usd(paid)} />
        <Kpi label="Còn nợ (mọi kỳ)" value={usd(pro.total_out)} tone={Number(pro.total_out) > 0 ? 'neg' : ''} sub={<a href="#/admin/profit">Xem chia lợi nhuận →</a>} />
      </section>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', alignItems: 'start' }}>
        <Box title="Bot sắp hết hạn / quá hạn" n={botDue.length} tone="warn">
          {botDue.map(a => <tr key={a.id}><td>{cname(a.customer_id)}<div className="small muted num">{a.account_no} · {a.broker}</div></td><td className="r"><span className={'pill ' + (left(a.bot_end) < 0 ? 'bad' : 'warn')}>{vnDate(a.bot_end)} · {leftTxt(left(a.bot_end))}</span></td></tr>)}
        </Box>
        <Box title="VPS sắp hết hạn" n={vpsDue.length} tone="warn">
          {vpsDue.map(v => <tr key={v.id}><td className="num">{v.name}<div className="small muted">{accs.filter(a => a.vps_id === v.id).length} tài khoản đang chạy</div></td><td className="r"><span className={'pill ' + (left(v.end_date) < 0 ? 'bad' : 'warn')}>{vnDate(v.end_date)} · {leftTxt(left(v.end_date))}</span></td></tr>)}
        </Box>
        <Box title="Bot ngừng gửi dữ liệu (≥ 3 ngày giao dịch)" n={stale.length} tone="bad">
          {stale.map(r => <tr key={r.id}><td>{accLabel(r)}</td><td className="r"><BotCell r={r} /></td></tr>)}
        </Box>
        <Box title="Lệch đối chiếu số dư tháng này" n={off.length} tone="bad">
          {off.map(r => <tr key={r.id}><td>{accLabel(r)}</td><td className="r"><span className="pill bad num">{signed(r.p.diff)} {r.currency}</span></td></tr>)}
        </Box>
        <Box title="Tài khoản đang chạy chưa gán VPS" n={noVps.length} tone="warn">
          {noVps.map(a => <tr key={a.id}><td>{cname(a.customer_id)}</td><td className="r num">{a.account_no} · {a.broker}</td></tr>)}
        </Box>
      </div>
    </>
  );
}

// ------------------------------------------------------------ số dư & nạp rút
const TYPES = { deposit: 'Nạp', withdraw: 'Rút', bonus: 'Bonus', credit: 'Credit', other: 'Điều chỉnh' };
export function Balance({ say }) {
  const [range, picker] = usePeriod();
  const [rows, setRows] = useState(null); const [flows, setFlows] = useState(null); const [err, setErr] = useState('');
  const [q, setQ] = useState(''); const [only, setOnly] = useState(''); const [fq, setFq] = useState('');
  const [add, setAdd] = useState(null); const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    setRows(null); setFlows(null);
    rpc('admin_balance', { p_from: range.from, p_to: range.to }).then(setRows).catch(e => setErr(e.message));
    sb.from('transfers').select('id,ticket,date,type,amount,time_text,comment,source,account_id').gte('date', range.from).lte('date', range.to)
      .order('date', { ascending: false }).order('id', { ascending: false }).limit(1000)
      .then(({ data, error }) => error ? setErr(error.message) : setFlows(data));
  }, [range.from, range.to]);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="card neg">{err}</div>;
  const byId = Object.fromEntries((rows || []).map(r => [r.id, r]));
  const list = (rows || []).filter(r => hit(r, q) && (only !== 'off' || (r.p?.diff != null && Math.abs(r.p.diff) >= 1)) && (only !== 'stale' || (r.stale_days || 0) >= 3) && (only !== 'nodata' || !r.p?.days));
  const sum = k => list.reduce((s, r) => s + (toUsd(r.p?.[k], r.currency) || 0), 0);
  const flo = list.reduce((s, r) => s + (toUsd(r.st?.floating, r.currency) || 0), 0);
  const nOff = (rows || []).filter(r => r.p?.diff != null && Math.abs(r.p.diff) >= 1).length;
  const flist = (flows || []).filter(f => { const r = byId[f.account_id]; return r && hit(r, fq); });
  const save = async () => {
    const amt = Number(add.amount);
    if (!add.account_id || !add.date || !amt) return say('Chọn tài khoản, ngày và số tiền');
    setSaving(true);
    const { error } = await sb.from('transfers').insert({ account_id: add.account_id, date: add.date, type: add.type, amount: add.type === 'deposit' || add.type === 'withdraw' ? Math.abs(amt) : amt,
      comment: add.comment || null, source: 'tay', ticket: 'TAY-' + Date.now().toString(36).toUpperCase() });
    setSaving(false); if (error) return say(error.message); setAdd(null); load(); say('Đã ghi giao dịch');
  };
  const del = async f => { if (!confirm('Xóa giao dịch nhập tay này?')) return; const { error } = await sb.from('transfers').delete().eq('id', f.id); if (error) return say(error.message); load(); say('Đã xóa'); };
  return (
    <>
      <section className="card">
        <div className="row"><div className="title grow">Số dư & nạp rút · {range.label}</div>{picker}</div>
        <p className="small muted" style={{ margin: 0 }}>Cuối kỳ (tính) = Đầu kỳ + Nạp − Rút + Điều chỉnh (bonus…) + Lãi/lỗ ròng. Đối chiếu với số dư EA báo ngày cuối có dữ liệu. Credit không tính vào số dư. Số theo đơn vị tài khoản; tài khoản USC có thêm dòng USD.</p>
        {rows && <div className="kpis">
          <Kpi label="Nạp" value={usd(sum('dep'))} />
          <Kpi label="Rút" value={usd(sum('wd'))} />
          <Kpi label="Lãi/lỗ ròng" value={signedUsd(sum('net'))} tone={cls(sum('net'))} sub={'PNL chưa chốt ' + signedUsd(flo)} />
          <Kpi label="Lệch đối chiếu" value={nOff} tone={nOff ? 'neg' : 'pos'} sub={nOff ? 'tài khoản cần kiểm tra' : 'Tất cả khớp'} />
        </div>}
        <div className="row"><Search q={q} setQ={setQ} />
          <div className="seg">{[['', 'Tất cả'], ['off', 'Lệch'], ['stale', 'Bot ngừng gửi'], ['nodata', 'Không có dữ liệu']].map(([k, l]) => <button key={k} type="button" className={only === k ? 'on' : ''} onClick={() => setOnly(k)}>{l}</button>)}</div></div>
        {!rows ? <div className="empty">Đang tải…</div> : <div className="tbl" style={{ maxHeight: '70vh', overflowY: 'auto' }}><table style={{ minWidth: 1280 }}><thead style={{ position: 'sticky', top: 0, background: 'var(--surface-100)', zIndex: 1 }}><tr>
          <th style={{ minWidth: 200 }}>Khách / TK</th><th className="r">Đầu kỳ</th><th className="r">Nạp</th><th className="r">Rút</th><th className="r">Điều chỉnh</th><th className="r">Lãi/lỗ ròng</th><th className="r">PNL chưa chốt</th><th className="r">Cuối kỳ (tính)</th><th className="r">EA báo</th><th>Đối chiếu</th><th>Bot gửi dữ liệu</th></tr></thead><tbody>
          {list.map(r => { const p = r.p || {}; const c = r.currency; return (
            <tr key={r.id}>
              <td>{accLabel(r)}<div className="small muted">{c}{r.status === 'stopped' ? ' · đã dừng' : ''}</div></td>
              <td className="r"><Amt v={p.open} cur={c} />{p.open_from === 'tay' && <div className="small muted">nhập tay</div>}</td>
              <td className="r"><Amt v={p.dep || null} cur={c} /></td><td className="r"><Amt v={p.wd || null} cur={c} /></td><td className="r"><Amt v={p.other || null} cur={c} sign /></td>
              <td className="r"><Amt v={p.days ? p.net : null} cur={c} sign /><div className="small muted">{p.days || 0} ngày</div></td>
              <td className="r">{r.st ? <><Amt v={r.st.floating} cur={c} sign /><div className="small muted">{r.st.positions ?? 0} lệnh mở{r.st.dd_pct != null ? ' · DD ' + fmt(r.st.dd_pct) + '%' : ''}</div></> : <span className="muted">—</span>}</td>
              <td className="r"><Amt v={p.close} cur={c} /></td>
              <td className="r"><Amt v={p.ea_bal} cur={c} />{p.ea_bal_date && <div className="small muted">{vnDate(p.ea_bal_date)}</div>}</td>
              <td>{p.diff == null ? <span className="pill mut">Chưa đủ dữ liệu</span> : Math.abs(p.diff) < 1 ? <span className="pill ok">Khớp</span> : <span className="pill bad num">Lệch {signed(p.diff)}</span>}</td>
              <td><BotCell r={r} /></td>
            </tr>); })}
          {!list.length && <tr><td colSpan={11} className="empty">Không có tài khoản phù hợp</td></tr>}
        </tbody></table></div>}
      </section>
      <section className="card">
        <div className="row"><div className="title grow">Giao dịch nạp / rút · {range.label} ({flist.length})</div><Search q={fq} setQ={setFq} />
          <button className="btn pri" onClick={() => setAdd({ type: 'deposit', date: iso(vnNow()) })}>+ Ghi nạp/rút tay</button></div>
        <p className="small muted" style={{ margin: 0 }}>Giao dịch từ EA tự vào theo mã deal MT5. Chỉ ghi tay khi EA chưa gắn hoặc cần điều chỉnh; giao dịch ghi tay xóa được.</p>
        {!flows ? <div className="empty">Đang tải…</div> : flist.length ? <div className="tbl" style={{ maxHeight: '60vh', overflowY: 'auto' }}><table><thead><tr><th>Ngày</th><th>Khách / TK</th><th>Loại</th><th className="r">Số tiền</th><th>Nguồn</th><th>Ghi chú</th><th></th></tr></thead><tbody>
          {flist.map(f => { const r = byId[f.account_id]; return (
            <tr key={f.id}><td>{vnDate(f.date)}<div className="small muted">{f.time_text || ''}</div></td><td>{accLabel(r)}</td>
              <td><span className={'pill ' + (f.type === 'deposit' ? 'ok' : f.type === 'withdraw' ? 'bad' : 'mut')}>{TYPES[f.type] || f.type}</span></td>
              <td className="r"><Amt v={f.amount} cur={r.currency} /></td><td>{f.source === 'ea' ? 'EA' : 'Nhập tay'}</td><td className="small">{f.comment || ''}</td>
              <td className="r">{f.source !== 'ea' && <button className="btn sm" onClick={() => del(f)}>Xóa</button>}</td></tr>); })}
        </tbody></table></div> : <div className="empty">{fq ? 'Không tìm thấy giao dịch phù hợp' : 'Chưa có giao dịch nạp/rút trong kỳ'}</div>}
      </section>
      {add && <Modal title="Ghi nạp / rút tay" onClose={() => setAdd(null)} onSave={save} saving={saving}>
        <div className="form">
          <F label="Tài khoản" wide><select id="tr-acc" value={add.account_id || ''} onChange={e => setAdd({ ...add, account_id: e.target.value })}><option value="">— Chọn —</option>{(rows || []).map(r => <option key={r.id} value={r.id}>{r.customer} · {r.account_no} · {r.broker} ({r.currency})</option>)}</select></F>
          <F label="Ngày (giờ sàn)"><input id="tr-date" type="date" value={add.date} onChange={e => setAdd({ ...add, date: e.target.value })} /></F>
          <F label="Loại"><select id="tr-type" value={add.type} onChange={e => setAdd({ ...add, type: e.target.value })}>{Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
          <F label={'Số tiền (đơn vị tài khoản' + (byId[add.account_id]?.currency ? ': ' + byId[add.account_id].currency : '') + ')'}><input id="tr-amt" type="number" step="0.01" value={add.amount ?? ''} onChange={e => setAdd({ ...add, amount: e.target.value })} /></F>
          <F label="Ghi chú" wide><input id="tr-note" value={add.comment || ''} onChange={e => setAdd({ ...add, comment: e.target.value })} /></F>
        </div>
      </Modal>}
    </>
  );
}

// ------------------------------------------------------------ chia lợi nhuận
const ST = { none: ['mut', 'Không phát sinh'], paid: ['ok', 'Đã thu'], partial: ['warn', 'Thu một phần'], due: ['bad', 'Còn nợ'] };
export function Profit({ say }) {
  const t = vnNow();
  const [month, setMonth] = useState(iso(monthStart(t.getFullYear(), t.getMonth())));   // '' = mọi kỳ còn nợ
  const [data, setData] = useState(null); const [pays, setPays] = useState([]); const [err, setErr] = useState('');
  const [q, setQ] = useState(''); const [only, setOnly] = useState('');
  const [pay, setPay] = useState(null); const [edit, setEdit] = useState(null); const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    setData(null);
    rpc('admin_profit', { p_month: month || null }).then(setData).catch(e => setErr(e.message));
    let qy = sb.from('profit_payments').select('*').order('paid_at', { ascending: false }).order('id', { ascending: false }).limit(300);
    if (month) qy = qy.eq('period', month);
    qy.then(({ data }) => setPays(data || []));
  }, [month]);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="card neg">{err}</div>;
  const months = Array.from(new Set([...(data?.months || []), ...lastMonths(3).map(iso)])).sort().reverse();
  const rows = (data?.rows || []).filter(r => hit(r, q) && (!only || r.status === only || (only === 'due' && r.status === 'partial')));
  const tot = k => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
  const label = r => (data?.rows || []).find(x => x.account_id === r.account_id);
  const doPay = async () => {
    const amt = Number(pay.amount); if (!amt) return say('Nhập số tiền');
    setSaving(true);
    try { await rpc('admin_profit_pay', { p_account: pay.account_id, p_period: pay.period, p_amount: amt, p_paid_at: pay.paid_at || null, p_note: pay.note || null }); setPay(null); load(); say('Đã ghi thu'); }
    catch (e) { say(e.message); } finally { setSaving(false); }
  };
  const doEdit = async () => {
    const n = v => (v === '' || v == null ? null : Number(v));
    setSaving(true);
    try { await rpc('admin_profit_set', { p_account: edit.account_id, p_period: edit.period, p_profit_usd: n(edit.override), p_share_pct: n(edit.pct), p_note: edit.note || null }); setEdit(null); load(); say('Đã lưu kỳ'); }
    catch (e) { say(e.message); } finally { setSaving(false); }
  };
  const undo = async p => { if (!confirm('Xóa lần thu ' + usd(p.amount_usd) + '?')) return; const { error } = await sb.from('profit_payments').delete().eq('id', p.id); if (error) return say(error.message); load(); say('Đã xóa lần thu'); };
  return (
    <>
      <section className="card">
        <div className="row"><div className="title grow">Chia lợi nhuận · {month ? 'Tháng ' + mLabel(new Date(month + 'T00:00:00')) : 'Mọi kỳ còn nợ'}</div>
          <select id="pro-month" className="btn sm" value={month} onChange={e => setMonth(e.target.value)}>
            <option value="">Mọi kỳ còn nợ</option>{months.map(m => <option key={m} value={m}>Tháng {mLabel(new Date(m + 'T00:00:00'))}</option>)}</select></div>
        <p className="small muted" style={{ margin: 0 }}>Lợi nhuận tháng = tổng lãi/lỗ ròng các ngày EA gửi (quy USD). Công ty nhận = lợi nhuận × tỷ lệ của tài khoản; tháng lỗ thì không phát sinh. Bấm <b>Sửa</b> để chỉnh tay lợi nhuận hoặc tỷ lệ riêng cho kỳ đó.</p>
        {data && <div className="kpis">
          <Kpi label="Lợi nhuận (USD)" value={signedUsd(tot('profit_usd'))} tone={cls(tot('profit_usd'))} sub={rows.length + ' tài khoản'} />
          <Kpi label="Công ty phải thu" value={usd(tot('due'))} />
          <Kpi label="Đã thu" value={usd(tot('paid'))} tone="pos" />
          <Kpi label="Còn nợ" value={usd(tot('out'))} tone={tot('out') > 0 ? 'neg' : ''} sub={'Tổng mọi kỳ ' + usd(data.total_out)} />
        </div>}
        <div className="row"><Search q={q} setQ={setQ} />
          <div className="seg">{[['', 'Tất cả'], ['due', 'Còn nợ'], ['paid', 'Đã thu'], ['none', 'Không phát sinh']].map(([k, l]) => <button key={k} type="button" className={only === k ? 'on' : ''} onClick={() => setOnly(k)}>{l}</button>)}</div></div>
        {!data ? <div className="empty">Đang tải…</div> : <div className="tbl" style={{ maxHeight: '70vh', overflowY: 'auto' }}><table style={{ minWidth: 1100 }}><thead style={{ position: 'sticky', top: 0, background: 'var(--surface-100)', zIndex: 1 }}><tr>
          {!month && <th>Kỳ</th>}<th style={{ minWidth: 200 }}>Khách / TK</th><th className="r">Số ngày</th><th className="r">LN ròng (đơn vị TK)</th><th className="r">Lợi nhuận (USD)</th><th className="r">Tỷ lệ</th><th className="r">Phải thu</th><th className="r">Đã thu</th><th className="r">Còn nợ</th><th>Trạng thái</th><th></th></tr></thead><tbody>
          {rows.map(r => (
            <tr key={r.account_id + r.period}>
              {!month && <td>{mLabel(new Date(r.period + 'T00:00:00'))}</td>}
              <td>{accLabel(r)}</td><td className="r num">{r.days}</td>
              <td className="r"><span className={'num ' + cls(r.net)}>{signed(r.net)}</span><div className="small muted">{r.currency}</div></td>
              <td className="r"><span className={'num ' + cls(r.profit_usd)}>{signedUsd(r.profit_usd)}</span>{r.manual && <div className="small muted">sửa tay (EA: {signedUsd(r.net_usd)})</div>}</td>
              <td className="r num">{fmt(r.share_pct, Number(r.share_pct) % 1 ? 1 : 0)}%</td>
              <td className="r num">{usd(r.due)}</td><td className="r num pos">{Number(r.paid) ? usd(r.paid) : '—'}{r.last_paid && <div className="small muted">{vnDate(r.last_paid)}</div>}</td>
              <td className={'r num ' + (Number(r.out) > 0 ? 'neg' : '')}>{Number(r.out) ? usd(r.out) : '—'}</td>
              <td><span className={'pill ' + ST[r.status][0]}>{ST[r.status][1]}</span>{r.note && <div className="small muted">{r.note}</div>}</td>
              <td className="r"><span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                {Number(r.out) > 0 && <button className="btn pri sm" onClick={() => setPay({ account_id: r.account_id, period: r.period, amount: r.out, paid_at: iso(vnNow()), r })}>Ghi thu</button>}
                <button className="btn sm" onClick={() => setEdit({ account_id: r.account_id, period: r.period, override: r.manual ? r.profit_usd : '', pct: r.share_pct, note: r.note || '', r })}>Sửa</button></span></td>
            </tr>))}
          {!rows.length && <tr><td colSpan={11} className="empty">{month ? 'Chưa có kết quả trong tháng này' : 'Không còn kỳ nào còn nợ'}</td></tr>}
        </tbody></table></div>}
      </section>
      <section className="card">
        <div className="title">Lịch sử thu tiền{month ? ' · tháng ' + mLabel(new Date(month + 'T00:00:00')) : ''} ({pays.length})</div>
        {pays.length ? <div className="tbl"><table><thead><tr><th>Ngày thu</th><th>Khách / TK</th><th>Kỳ</th><th className="r">Số tiền</th><th>Ghi chú</th><th>Người ghi</th><th></th></tr></thead><tbody>
          {pays.map(p => { const r = label(p); return (
            <tr key={p.id}><td>{vnDate(p.paid_at)}</td><td>{r ? accLabel(r) : <span className="muted">—</span>}</td><td>{mLabel(new Date(p.period + 'T00:00:00'))}</td>
              <td className="r num pos">{usd(p.amount_usd)}</td><td className="small">{p.note || ''}</td><td className="small muted">{p.created_by || ''}</td>
              <td className="r"><button className="btn sm" onClick={() => undo(p)}>Xóa</button></td></tr>); })}
        </tbody></table></div> : <div className="empty">Chưa ghi lần thu nào</div>}
      </section>
      {pay && <Modal title={'Ghi thu · ' + pay.r.customer + ' · ' + pay.r.account_no} onClose={() => setPay(null)} onSave={doPay} saving={saving}>
        <p className="small muted" style={{ margin: 0 }}>Kỳ {mLabel(new Date(pay.period + 'T00:00:00'))} · phải thu {usd(pay.r.due)} · đã thu {usd(pay.r.paid)} · còn nợ {usd(pay.r.out)}</p>
        <div className="form">
          <F label="Số tiền thu (USD)"><input id="pay-amt" type="number" step="0.01" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} /></F>
          <F label="Ngày thu"><input id="pay-date" type="date" value={pay.paid_at} onChange={e => setPay({ ...pay, paid_at: e.target.value })} /></F>
          <F label="Ghi chú (ví dụ: USDT BEP20, mã giao dịch)" wide><input id="pay-note" value={pay.note || ''} onChange={e => setPay({ ...pay, note: e.target.value })} /></F>
        </div>
      </Modal>}
      {edit && <Modal title={'Sửa kỳ · ' + edit.r.customer + ' · ' + edit.r.account_no} onClose={() => setEdit(null)} onSave={doEdit} saving={saving}>
        <p className="small muted" style={{ margin: 0 }}>Kỳ {mLabel(new Date(edit.period + 'T00:00:00'))} · EA tính {signedUsd(edit.r.net_usd)} trong {edit.r.days} ngày. Để trống ô lợi nhuận = dùng số EA. Tỷ lệ chỉ áp cho kỳ này; đổi tỷ lệ lâu dài thì sửa ở tab Tài khoản.</p>
        <div className="form">
          <F label="Lợi nhuận chỉnh tay (USD)"><input id="ed-profit" type="number" step="0.01" placeholder={String(edit.r.net_usd)} value={edit.override ?? ''} onChange={e => setEdit({ ...edit, override: e.target.value })} /></F>
          <F label="Tỷ lệ công ty kỳ này (%)"><input id="ed-pct" type="number" min="0" max="100" step="0.5" value={edit.pct ?? ''} onChange={e => setEdit({ ...edit, pct: e.target.value })} /></F>
          <F label="Ghi chú" wide><input id="ed-note" value={edit.note} onChange={e => setEdit({ ...edit, note: e.target.value })} /></F>
        </div>
      </Modal>}
    </>
  );
}
