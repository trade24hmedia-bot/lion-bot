import { useEffect, useMemo, useState, useCallback } from 'react';
import { sb, rpc, fmt, usd, signed, signedUsd, cls, vnDate } from './lib.js';
import { Modal, F, useTable, usePeriod } from './ui.jsx';

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
  const [range, picker] = usePeriod();
  const [allDue, setAllDue] = useState(false);   // true = mọi kỳ còn nợ, bỏ qua thời gian
  const [data, setData] = useState(null); const [pays, setPays] = useState([]); const [err, setErr] = useState('');
  const [q, setQ] = useState(''); const [only, setOnly] = useState('');
  const [pay, setPay] = useState(null); const [edit, setEdit] = useState(null); const [saving, setSaving] = useState(false);
  const pFrom = range.from.slice(0, 7) + '-01', pTo = range.to.slice(0, 7) + '-01';
  const load = useCallback(() => {
    setData(null);
    rpc('admin_profit_range', allDue ? { p_from: null, p_to: null, p_due_only: true } : { p_from: range.from, p_to: range.to, p_due_only: false }).then(setData).catch(e => setErr(e.message));
    let qy = sb.from('profit_payments').select('*').order('paid_at', { ascending: false }).order('id', { ascending: false }).limit(500);
    if (!allDue) qy = qy.gte('period', pFrom).lte('period', pTo);
    qy.then(({ data }) => setPays(data || []));
  }, [range.from, range.to, allDue]);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="card neg">{err}</div>;
  const multi = allDue || pFrom !== pTo;
  const month = multi ? '' : pFrom;
  const title = allDue ? 'Mọi kỳ còn nợ' : range.label + (range.mode === 'custom' && multi ? ' (theo các tháng trong khoảng)' : '');
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
        <div className="row"><div className="title grow">Chia lợi nhuận · {title}</div>
          {!allDue && picker}
          <button type="button" className={'btn sm' + (allDue ? ' pri' : '')} onClick={() => setAllDue(!allDue)}>{allDue ? '← Theo thời gian' : 'Mọi kỳ còn nợ'}</button></div>
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
              <td className="r"><span style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                {Number(r.out) > 0 && <button className="btn pri sm" onClick={() => setPay({ account_id: r.account_id, period: r.period, amount: r.out, paid_at: iso(vnNow()), r })}>Ghi thu</button>}
                <button className="btn sm" onClick={() => setEdit({ account_id: r.account_id, period: r.period, override: r.manual ? r.profit_usd : '', pct: r.share_pct, note: r.note || '', r })}>Sửa</button></span></td>
            </tr>))}
          {!rows.length && <tr><td colSpan={11} className="empty">{allDue ? 'Không còn kỳ nào còn nợ' : 'Chưa có kết quả trong khoảng này'}</td></tr>}
        </tbody></table></div>}
      </section>
      <section className="card">
        <div className="title">Lịch sử thu tiền · {allDue ? 'tất cả' : title} ({pays.length})</div>
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

// ------------------------------------------------------------ Telegram (chỉ quản lý)
const LVN = { orange: '🟠 Cam + 🔴 Đỏ', red: '🔴 Chỉ Đỏ' };
export function Telegram({ say }) {
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  const [tok, setTok] = useState(''); const [edit, setEdit] = useState(null); const [saving, setSaving] = useState(false);
  const [found, setFound] = useState(null); const [finding, setFinding] = useState(false);
  const load = useCallback(() => rpc('tg_settings').then(setD).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="card neg">{err}</div>;
  if (!d) return <div className="empty">Đang tải…</div>;
  const saveTok = async e => { e.preventDefault(); try { await rpc('tg_save_token', { p_token: tok.trim() }); setTok(''); load(); say('Đã lưu token bot'); } catch (x) { say(x.message); } };
  const find = async () => {
    setFinding(true); setFound(null);
    try {
      const req = await rpc('tg_discover');
      for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); const r = await rpc('tg_request_result', { p_req: req }); if (r.ready) { if (!r.ok) say('Telegram báo: ' + r.error); setFound(r.chats || []); break; } }
    } catch (x) { say(x.message); } finally { setFinding(false); }
  };
  const save = async () => {
    if (!edit.chat_id?.toString().trim()) return say('Nhập chat id');
    setSaving(true);
    try { await rpc('tg_save_chat', { p: edit }); setEdit(null); load(); say('Đã lưu nhóm'); } catch (x) { say(x.message); } finally { setSaving(false); }
  };
  const del = async c => { if (!confirm('Bỏ nhóm "' + c.name + '"?')) return; await rpc('tg_delete_chat', { p_id: c.id }); load(); say('Đã bỏ nhóm'); };
  const test = async c => { try { await rpc('tg_test', { p_chat: c.chat_id }); say('Đã gửi tin thử tới "' + c.name + '" — kiểm tra trong Telegram'); } catch (x) { say(x.message); } };
  const newChat = (x = {}) => setEdit({ name: x.title || '', chat_id: x.chat_id || '', min_level: 'orange', send_news: true, send_events: true, send_price: true, send_daily: true, enabled: true });
  const Ck = ({ k, l }) => <label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: 18, height: 18 }} checked={!!edit[k]} onChange={e => setEdit({ ...edit, [k]: e.target.checked })} />{l}</label>;
  const have = new Set(d.chats.map(c => String(c.chat_id)));
  return (
    <>
      <section className="card">
        <div className="title">Báo Telegram cho khách dùng bot</div>
        <p className="small muted" style={{ margin: 0 }}>Hệ thống tự gửi vào nhóm / kênh: 🔴🟠 tin tức Đỏ / Cam kèm lời khuyên xử lý bot · ⏰ nhắc 30 phút trước tin Đỏ / Cam trên lịch · ⚡ giá vàng chạy mạnh · ✅ hết cảnh báo · ☀️ bản tin 7:00 sáng. Mỗi tin chỉ gửi 1 lần.</p>
      </section>

      <section className="card">
        <div className="row"><div className="title grow">1. Bot Telegram</div>{d.has_token ? <span className="pill ok">Đã có token · {d.token_hint}</span> : <span className="pill bad">Chưa có token</span>}</div>
        <p className="small muted" style={{ margin: 0 }}>Dùng lại bot đang báo EA hoặc tạo bot mới: mở <b>@BotFather</b> trong Telegram → <b>/newbot</b> → đặt tên → chép token (dạng <span className="key">123456789:AAH…</span>) dán vào đây. Token được lưu riêng trên máy chủ, web không hiện lại đầy đủ.</p>
        <form className="row" onSubmit={saveTok}><label className="field" style={{ flex: '1 1 320px' }}><input id="tg-token" type="password" autoComplete="off" placeholder={d.has_token ? 'Dán token mới để thay' : 'Dán token bot'} value={tok} onChange={e => setTok(e.target.value)} /></label><button className="btn pri" disabled={!tok.trim()}>Lưu token</button></form>
      </section>

      <section className="card">
        <div className="row"><div className="title grow">2. Nhóm / kênh nhận tin ({d.chats.length})</div>
          <button className="btn" onClick={find} disabled={!d.has_token || finding}>{finding ? 'Đang tìm…' : '🔍 Tìm nhóm'}</button>
          <button className="btn pri" onClick={() => newChat()} disabled={!d.has_token}>+ Thêm thủ công</button></div>
        <p className="small muted" style={{ margin: 0 }}>Thêm bot vào nhóm khách (kênh thì thêm bot làm <b>quản trị viên</b>), gửi 1 tin bất kỳ trong nhóm (ví dụ <span className="key">/start</span>), rồi bấm <b>Tìm nhóm</b>. Sau khi thêm, bấm <b>Gửi thử</b> để kiểm tra.</p>
        {found && <div className="card" style={{ background: 'var(--surface-200)' }}>
          {found.length ? found.map(x => <div key={x.chat_id} className="row"><span className="grow"><b>{x.title || '(không tên)'}</b> <span className="small muted">{x.type} · {x.chat_id}</span></span>
            {have.has(String(x.chat_id)) ? <span className="pill ok">Đã thêm</span> : <button className="btn sm pri" onClick={() => newChat(x)}>Thêm</button>}</div>)
            : <span className="small muted">Chưa thấy nhóm nào. Kiểm tra bot đã ở trong nhóm và có ít nhất 1 tin nhắn mới trong nhóm, rồi tìm lại.</span>}
        </div>}
        {d.chats.length > 0 ? <div className="tbl"><table><thead><tr><th>Nhóm</th><th>Mức gửi</th><th>Loại tin</th><th>Trạng thái</th><th></th></tr></thead><tbody>
          {d.chats.map(c => <tr key={c.id}>
            <td><b>{c.name}</b><div className="small muted key">{c.chat_id}</div></td>
            <td>{LVN[c.min_level]}</td>
            <td className="small">{[c.send_news && 'Tin tức', c.send_events && 'Lịch tin', c.send_price && 'Giá chạy mạnh', c.send_daily && 'Bản tin sáng'].filter(Boolean).join(' · ')}</td>
            <td>{c.enabled ? <span className="pill ok">Đang gửi</span> : <span className="pill mut">Tạm tắt</span>}</td>
            <td className="r"><span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}><button className="btn sm" onClick={() => test(c)}>Gửi thử</button><button className="btn sm" onClick={() => setEdit({ ...c })}>Sửa</button><button className="btn sm" onClick={() => del(c)}>Bỏ</button></span></td>
          </tr>)}
        </tbody></table></div> : <div className="empty">Chưa có nhóm nào</div>}
      </section>

      <section className="card">
        <div className="title">Tin đã gửi gần đây</div>
        {d.log.length ? <div className="tbl" style={{ maxHeight: 360, overflowY: 'auto' }}><table><tbody>{d.log.map((x, i) => <tr key={i}>
          <td className="small" style={{ whiteSpace: 'nowrap' }}>{new Date(x.sent_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</td>
          <td className="small">{x.name || ''}</td><td className="small muted">{(x.preview || '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').slice(0, 140)}</td></tr>)}</tbody></table></div>
          : <div className="empty">Chưa gửi tin nào</div>}
      </section>

      {edit && <Modal title={edit.id ? 'Sửa nhóm' : 'Thêm nhóm nhận tin'} onClose={() => setEdit(null)} onSave={save} saving={saving}>
        <div className="form">
          <F label="Tên gợi nhớ"><input id="tg-name" value={edit.name || ''} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="Nhóm khách Lion Bot" /></F>
          <F label="Chat id (nhóm thường là số âm, ví dụ -100…)"><input id="tg-chat" value={edit.chat_id || ''} onChange={e => setEdit({ ...edit, chat_id: e.target.value })} /></F>
          <F label="Gửi từ mức"><select id="tg-level" value={edit.min_level} onChange={e => setEdit({ ...edit, min_level: e.target.value })}><option value="orange">🟠 Cam + 🔴 Đỏ</option><option value="red">🔴 Chỉ Đỏ</option></select></F>
          <F label="Trạng thái"><Ck k="enabled" l="Đang gửi" /></F>
          <div className="wide" style={{ gridColumn: '1/-1', display: 'grid', gap: 8 }}><b className="small">Loại tin gửi vào nhóm này</b>
            <Ck k="send_news" l="Tin tức Đỏ / Cam kèm lời khuyên" /><Ck k="send_events" l="Nhắc 30 phút trước tin Đỏ / Cam trên lịch kinh tế" />
            <Ck k="send_price" l="Giá vàng chạy mạnh" /><Ck k="send_daily" l="Bản tin 7:00 sáng (lịch tin trong ngày)" /></div>
        </div>
      </Modal>}
    </>
  );
}

// ------------------------------------------------------------ Kết nối bot theo số TK (chỉ quản lý)
const FN_ACC = ['ingest_status_acc', 'ingest_daily_acc', 'ingest_event_acc', 'ingest_config_acc'];
export function BotLink({ say }) {
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  const [paste, setPaste] = useState(''); const [keepOld, setKeepOld] = useState(true); const [shown, setShown] = useState('');
  const load = useCallback(() => rpc('bot_link_settings').then(setD).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);
  if (err) return <div className="card neg">{err}</div>;
  if (!d) return <div className="empty">Đang tải…</div>;
  const base = (import.meta.env.VITE_SUPABASE_URL || 'https://sypkzdcazdzekmgmgfhu.supabase.co') + '/rest/v1/rpc/';
  const copy = async v => { try { await navigator.clipboard.writeText(v); say('Đã chép'); } catch { say(v); } };
  const gen = async () => { if (d.has_secret && !confirm('Tạo mã bí mật mới? ' + (keepOld ? 'Mã hiện tại vẫn dùng được (mã cũ) đến khi anh bấm "Bỏ mã cũ".' : 'Mã hiện tại sẽ NGỪNG dùng ngay, bot đang chạy sẽ bị từ chối.'))) return; try { const v = await rpc('bot_secret_generate', { p_keep_old: keepOld }); setShown(v); load(); } catch (x) { say(x.message); } };
  const save = async e => { e.preventDefault(); try { await rpc('bot_secret_set', { p_secret: paste.trim(), p_keep_old: keepOld }); setPaste(''); load(); say('Đã lưu mã bí mật'); } catch (x) { say(x.message); } };
  const reveal = async () => { if (!confirm('Hiện mã bí mật trên màn hình? Chỉ làm khi không có ai xem màn hình.')) return; try { setShown(await rpc('bot_secret_reveal')); } catch (x) { say(x.message); } };
  const dropOld = async () => { if (!confirm('Bỏ mã cũ? Bot chưa cập nhật mã mới sẽ bị từ chối.')) return; try { await rpc('bot_secret_drop_old'); load(); say('Đã bỏ mã cũ'); } catch (x) { say(x.message); } };
  const st = d.stats || {};
  return (
    <>
      <section className="card">
        <div className="title">Kết nối bot theo số tài khoản MT5</div>
        <p className="small muted" style={{ margin: 0 }}>Bot gửi dữ liệu kèm <b>số tài khoản + server</b> và <b>chữ ký HMAC-SHA256</b> bằng mã bí mật chung. Khách không phải nhập gì trên MT5. Tài khoản lạ tự vào mục <a href="#/admin/accounts">Chờ duyệt</a>. Cách cũ (mã riêng từng tài khoản) vẫn chạy song song.</p>
        <div className="kpis">
          <div className="kpi"><span className="label">Lần gửi 24 giờ</span><span className="num-xl">{st.calls_24h || 0}</span><span className="sub">thành công {st.ok_24h || 0}</span></div>
          <div className="kpi"><span className="label">Tài khoản gửi 24 giờ</span><span className="num-xl">{st.accounts_24h || 0}</span></div>
          <div className="kpi"><span className="label">Kiểm 4 ví dụ của bên bot</span><span className={'num-xl ' + ((d.selftest || []).every(x => x.ok) ? 'pos' : 'neg')}>{(d.selftest || []).filter(x => x.ok).length}/4</span><span className="sub">tính trên máy chủ web</span></div>
        </div>
      </section>

      <section className="card">
        <div className="row"><div className="title grow">1. Mã bí mật bot (BOT_SECRET)</div>
          {d.has_secret ? <span className="pill ok">Đang dùng · {d.hint}</span> : <span className="pill bad">Chưa có</span>}
          {d.has_old && <span className="pill warn">Mã cũ vẫn nhận · {d.hint_old}</span>}</div>
        <p className="small muted" style={{ margin: 0 }}>Chỉ gửi mã cho bên bot qua kênh riêng (Zalo / Telegram cá nhân), <b>không</b> gửi vào nhóm. Đổi mã: giữ tick "vẫn nhận mã cũ" cho đến khi mọi bot đã cập nhật bản mới, rồi bấm <b>Bỏ mã cũ</b>.</p>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: 18, height: 18 }} checked={keepOld} onChange={e => setKeepOld(e.target.checked)} /> Khi đổi mã: vẫn nhận mã cũ trong thời gian chuyển</label>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn pri" onClick={gen}>{d.has_secret ? 'Tạo mã mới' : 'Tạo mã bí mật'}</button>
          {d.has_secret && <button className="btn" onClick={reveal}>Xem mã hiện tại</button>}
          {d.has_old && <button className="btn" onClick={dropOld}>Bỏ mã cũ</button>}
        </div>
        {shown && <div className="card" style={{ background: 'var(--surface-200)' }}>
          <span className="small muted">Mã bí mật (chép gửi riêng cho bên bot, rồi bấm Ẩn):</span>
          <span className="row" style={{ gap: 8 }}><span className="key" style={{ wordBreak: 'break-all' }}>{shown}</span><button className="btn sm" onClick={() => copy(shown)}>Chép</button><button className="btn sm" onClick={() => setShown('')}>Ẩn</button></span>
        </div>}
        <form className="row" onSubmit={save} style={{ gap: 8 }}>
          <label className="field" style={{ flex: '1 1 320px' }}><input id="bot-secret" type="password" autoComplete="off" placeholder="Hoặc dán mã do bên bot gửi (≥ 32 ký tự)" value={paste} onChange={e => setPaste(e.target.value)} /></label>
          <button className="btn" disabled={paste.trim().length < 32}>Lưu mã dán vào</button>
        </form>
      </section>

      <section className="card">
        <div className="title">2. Thông tin gửi bên bot</div>
        <div className="tbl"><table><tbody>
          {FN_ACC.map(f => <tr key={f}><td className="key" style={{ wordBreak: 'break-all' }}>POST {base}{f}</td><td className="r"><button className="btn sm" onClick={() => copy(base + f)}>Chép</button></td></tr>)}
          <tr><td className="small">Header: <span className="key">apikey</span> + <span className="key">Authorization: Bearer</span> = khóa anon (như gói EA hiện tại) · body: <span className="key">{'{"p": {...}}'}</span></td><td /></tr>
          <tr><td className="small">Giờ máy chủ web lúc tải trang: <span className="key">{d.now}</span> (giây unix UTC) · cho phép lệch ±900 giây · tối đa 20 lần / phút / tài khoản</td><td /></tr>
        </tbody></table></div>
        <div className="small">{(d.selftest || []).map(x => <div key={x.msg}>{x.ok ? '✅' : '❌'} <span className="key">{x.msg}</span></div>)}</div>
      </section>

      <section className="card">
        <div className="title">3. Nhật ký nhận gần đây (tự cập nhật 30 giây)</div>
        {d.log.length ? <div className="tbl" style={{ maxHeight: 420, overflowY: 'auto' }}><table><thead><tr><th>Lúc (giờ VN)</th><th>Hàm</th><th>Số TK</th><th>Server</th><th>Kết quả</th></tr></thead><tbody>
          {d.log.map(l => <tr key={l.id}><td className="small" style={{ whiteSpace: 'nowrap' }}>{new Date(l.at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' })}</td>
            <td className="small">{l.fn}</td><td className="num small">{l.login}</td><td className="small">{l.server}</td>
            <td>{l.ok ? <span className="pill ok">{l.error === 'duplicate' ? 'Trùng, bỏ qua' : 'OK'}</span> : <span className="pill bad">{l.error}</span>}</td></tr>)}
        </tbody></table></div> : <div className="empty">Chưa nhận lần nào</div>}
      </section>
    </>
  );
}
