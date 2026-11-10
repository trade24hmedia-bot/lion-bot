import { useEffect, useState, useCallback, useMemo } from 'react';
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { rpc, fmt, vnDate } from './lib.js';
import { Modal, F } from './ui.jsx';

// Giám sát bot (Quản lý + Kỹ thuật): danh sách TK trực tiếp, cảnh báo, chi tiết từng TK.
const vn = (ts, sec) => (ts ? new Date(ts).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}), day: '2-digit', month: '2-digit' }) : '—');
const mins = ts => (ts ? Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 60000)) : null);
const ago = m => (m == null ? '—' : m < 1 ? 'vừa xong' : m < 60 ? m + ' phút trước' : m < 1440 ? Math.floor(m / 60) + ' giờ ' + (m % 60) + ' phút trước' : Math.floor(m / 1440) + ' ngày trước');
const LV = { red: '🔴', orange: '🟠', info: '⚪' };
const KIND = { event: 'Sự kiện bot', lost: 'Mất tín hiệu', two_terminals: 'Chạy 2 máy', pending: 'Chờ duyệt', cfg: 'Lệch cài đặt chuẩn' };
const STATE = { running: 'Đang chạy', stopped: 'Đã dừng', paused: 'Tạm dừng', news: 'Dừng theo tin' };

function signal(a) {
  const m = mins(a.last_seen || a.received_at);
  if (!a.last_seen && !a.received_at) return { k: 'none', pill: <span className="pill mut">Chưa kết nối</span>, m };
  if (m < 5) return { k: 'ok', pill: <span className="pill ok">● Trực tuyến</span>, m };
  if (m < 15) return { k: 'slow', pill: <span className="pill warn">Chậm {m} phút</span>, m };
  return { k: 'lost', pill: <span className="pill bad">Mất tín hiệu</span>, m };
}
// CSV có BOM để Excel đọc đúng tiếng Việt
export function csv(name, head, rows) {
  const q = v => { if (v == null) return ''; const t = typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const body = '\uFEFF' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n');
  const u = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  const l = document.createElement('a'); l.href = u; l.download = name + '.csv'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000);
}
const vnIso = ts => (ts ? new Date(ts).toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) : '');
const daysTo = (d, today) => (d ? Math.round((new Date(d) - new Date(today)) / 86400000) : null);
function Due({ d, today, label }) {
  const n = daysTo(d, today); if (n == null) return null;
  return <div className="small"><span className="muted">{label} </span><span className={n < 0 ? 'neg' : n <= 7 ? '' : 'muted'} style={n >= 0 && n <= 7 ? { color: 'var(--brand)' } : null}>{vnDate(d).slice(0, 5)}{n < 0 ? ' · quá ' + -n + ' ngày' : n <= 7 ? ' · còn ' + n + ' ngày' : ''}</span></div>;
}
const ddCls = (dd, max) => (dd == null ? '' : max && dd >= max * 0.7 ? 'neg' : dd >= 10 ? 'neg' : '');

export default function BotMon({ say, arg, isAdmin }) {
  return arg === 'presets' ? <Presets say={say} /> : arg ? <Detail id={arg} say={say} /> : <List say={say} isAdmin={isAdmin} />;
}

// ------------------------------------------------------------ danh sách + cảnh báo
function List({ say, isAdmin }) {
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  const [f, setF] = useState('all'); const [q, setQ] = useState(''); const [showDone, setShowDone] = useState(false);
  const [, tick] = useState(0);
  const load = useCallback(() => rpc('ops_overview').then(x => { setD(x); setErr(''); }).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); const a = setInterval(load, 30000); const b = setInterval(() => tick(x => x + 1), 15000); return () => { clearInterval(a); clearInterval(b); }; }, [load]);
  if (err) return <div className="card neg">{err}</div>;
  if (!d) return <div className="empty">Đang tải…</div>;

  const accs = d.accounts.map(a => ({ ...a, sig: signal(a) }));
  const open = d.alerts.filter(x => !x.handled_at);
  const done = d.alerts.filter(x => x.handled_at);
  const cnt = { live: accs.filter(a => a.sig.k === 'ok').length, lost: accs.filter(a => a.sig.k === 'lost').length, pending: accs.filter(a => !a.approved).length };
  const s = q.trim().toLowerCase();
  const list = accs.filter(a => (f === 'all' ? true : f === 'alert' ? a.alerts_open > 0 : f === 'lost' ? a.sig.k === 'lost' || a.sig.k === 'slow' : f === 'pending' ? !a.approved : f === 'none' ? a.sig.k === 'none' : f === 'expire' ? [daysTo(a.bot_end, d.today), daysTo(a.vps_end, d.today)].some(n => n != null && n <= 7) : f === 'old' ? a.old_build : f === 'cfg' ? a.cfg_diff > 0 : true)
    && (!s || [a.account_no, a.customer, a.broker, a.server, a.system_name, a.bot_reported].some(v => (v || '').toLowerCase().includes(s))));
  const handle = async ids => { try { const n = await rpc('ops_alert_handle', { p_ids: ids }); say('Đã đánh dấu xử lý ' + n + ' cảnh báo'); load(); } catch (x) { say(x.message); } };

  return (
    <>
      <section className="card">
        <div className="row"><div className="title grow">Giám sát bot</div>
          <a className="btn sm" href="#/admin/botmon/presets">⚙️ Cài đặt chuẩn & phiên bản</a>
          {d.market_closed && <span className="pill mut">Thị trường đang nghỉ · tạm không báo mất tín hiệu</span>}
          <span className="small muted">Tự cập nhật 30 giây</span></div>
        <div className="kpis">
          <div className="kpi"><span className="label">Đang trực tuyến</span><span className="num-xl pos">{cnt.live}</span><span className="sub">gửi trong 5 phút</span></div>
          <div className="kpi"><span className="label">Mất tín hiệu</span><span className={'num-xl ' + (cnt.lost ? 'neg' : '')}>{cnt.lost}</span><span className="sub">quá 15 phút không gửi</span></div>
          <div className="kpi"><span className="label">Cảnh báo chưa xử lý</span><span className={'num-xl ' + (open.length ? 'neg' : '')}>{open.length}</span><span className="sub">{open.filter(x => x.level === 'red').length} đỏ · {open.filter(x => x.level !== 'red').length} cam</span></div>
          <div className="kpi"><span className="label">Chờ duyệt</span><span className={'num-xl ' + (cnt.pending ? 'warn' : '')} style={cnt.pending ? { color: 'var(--brand)' } : null}>{cnt.pending}</span><span className="sub"><a href="#/admin/accounts">Duyệt ở tab Tài khoản</a></span></div>
        </div>
        {!d.has_internal && <div className="small muted">⚠️ Chưa có nhóm Telegram nội bộ nên cảnh báo chỉ hiện trên web. {isAdmin ? <a href="#/admin/telegram">Thêm nhóm nội bộ</a> : 'Nhờ Quản lý thêm nhóm nội bộ ở tab Telegram.'}</div>}
      </section>

      <section className="card">
        <div className="row"><div className="title grow">Cảnh báo {open.length ? `(${open.length})` : ''}</div>
          {open.length > 1 && <button className="btn sm" onClick={() => confirm('Đánh dấu đã xử lý tất cả ' + open.length + ' cảnh báo?') && handle(open.map(x => x.id))}>Đã xử lý tất cả</button>}
          <button className="btn sm" onClick={() => setShowDone(!showDone)}>{showDone ? 'Ẩn đã xử lý' : `Xem đã xử lý (${done.length})`}</button></div>
        {open.length ? <AlertTable rows={open} onHandle={id => handle([id])} /> : <div className="empty">✅ Không có cảnh báo nào cần xử lý</div>}
        {showDone && (done.length ? <><div className="label">Đã xử lý 3 ngày gần đây</div><AlertTable rows={done} /></> : <div className="small muted">Chưa có.</div>)}
      </section>

      <section className="card">
        <div className="row">
          <label className="field" style={{ width: 'min(300px,100%)' }}><input id="bm-q" type="search" placeholder="Tìm số TK, khách, sàn, nhánh…" value={q} onChange={e => setQ(e.target.value)} /></label>
          <div className="seg">{[['all', 'Tất cả'], ['alert', 'Có cảnh báo'], ['lost', 'Chậm / mất tín hiệu'], ['pending', 'Chờ duyệt'], ['none', 'Chưa kết nối'], ['expire', `Sắp hết hạn (${accs.filter(a => [daysTo(a.bot_end, d.today), daysTo(a.vps_end, d.today)].some(n => n != null && n <= 7)).length})`], ['old', `Bản cũ (${accs.filter(a => a.old_build).length})`], ['cfg', `Lệch chuẩn (${accs.filter(a => a.cfg_diff > 0).length})`]].map(([k, l]) => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}</button>)}</div>
          <span className="grow" /><span className="small muted">{list.length} tài khoản</span>
          <button className="btn sm" onClick={() => csv('lionbot_giam_sat_' + d.today, ['Số TK', 'Tiền', 'Khách', 'Nhánh', 'Sàn', 'Server', 'Chờ duyệt', 'Bot', 'Bản', 'Bản cũ', 'Trạng thái bot', 'Lần cuối gửi', 'Balance', 'Equity', 'Lãi/lỗ mở', 'DD %', 'Max DD %', 'Lệnh', 'Lot mua', 'Lot bán', 'Số máy', 'Cảnh báo mở', 'Bộ chuẩn', 'Thông số lệch', 'Bot hết hạn', 'VPS', 'VPS hết hạn'],
            list.map(a => [a.account_no, a.currency, a.customer, a.system_name, a.broker, a.server, a.approved ? '' : 'x', a.bot_reported, a.bot_build, a.old_build ? 'x' : '', a.bot_state, vnIso(a.last_seen || a.received_at), a.balance, a.equity, a.floating, a.dd_pct, a.maxdd_pct, a.orders, a.lots_buy, a.lots_sell, a.terminals, a.alerts_open, a.preset, a.cfg_diff || '', a.bot_end, a.vps_name, a.vps_end]))}>⬇ CSV</button>
        </div>
        <div className="tbl"><table style={{ minWidth: 1250 }}><thead><tr>
          <th>Tín hiệu</th><th>Tài khoản</th><th>Bot</th><th className="r">Balance</th><th className="r">Equity</th><th className="r">Lãi/lỗ đang mở</th><th className="r">DD</th><th className="r">Lệnh</th><th className="r">Lot mua / bán</th><th>Máy</th><th>Hạn</th><th>Sự kiện gần nhất</th>
        </tr></thead><tbody>
          {list.map(a => <tr key={a.id} className="click" onClick={() => { location.hash = '/admin/botmon/' + a.id; }}>
            <td>{a.sig.pill}<div className="small muted">{a.last_seen ? ago(a.sig.m) : ''}</div>
              {a.alerts_open > 0 && <div style={{ marginTop: 4 }}><span className={'pill ' + (a.alert_lv >= 3 ? 'bad' : 'warn')}>{a.alerts_open} cảnh báo</span></div>}</td>
            <td><b className="num">{a.account_no}</b> <span className="small muted">{a.currency}</span>{!a.approved && <> <span className="pill warn">Chờ duyệt</span></>}{a.blocked && <> <span className="pill bad">Đã chặn</span></>}
              <div className="small">{a.customer || <i className="muted">chưa gắn khách</i>}{a.system_name ? <span className="muted"> · {a.system_name}</span> : ''}</div>
              <div className="small muted">{a.broker || ''} · {a.server || ''}</div></td>
            <td className="small">{a.bot_reported || '—'}{a.bot_build && <div className="muted">{a.bot_build}</div>}{a.bot_state && <div><span className={'pill ' + (a.bot_state === 'running' ? 'ok' : 'warn')}>{STATE[a.bot_state] || a.bot_state}</span></div>}
              {a.old_build && <div style={{ marginTop: 4 }}><span className="pill warn">Bản cũ</span></div>}{a.cfg_diff > 0 && <div style={{ marginTop: 4 }}><span className="pill warn" title={a.preset}>Lệch chuẩn {a.cfg_diff}</span></div>}</td>
            <td className="r num">{fmt(a.balance)}</td>
            <td className="r num">{fmt(a.equity)}</td>
            <td className={'r num ' + (Number(a.floating) < 0 ? 'neg' : Number(a.floating) > 0 ? 'pos' : '')}>{fmt(a.floating)}</td>
            <td className={'r num ' + ddCls(a.dd_pct, a.maxdd_pct)}>{a.dd_pct == null ? '—' : fmt(a.dd_pct) + '%'}{a.maxdd_pct != null && <div className="small muted">max {fmt(a.maxdd_pct, 0)}%</div>}</td>
            <td className="r num">{a.orders ?? a.positions ?? '—'}</td>
            <td className="r num">{a.lots_buy == null ? '—' : fmt(a.lots_buy) + ' / ' + fmt(a.lots_sell)}</td>
            <td>{a.terminals >= 2 ? <span className="pill bad">{a.terminals} máy!</span> : a.terminals === 1 ? <span className="small muted">1 máy</span> : <span className="small muted">—</span>}</td>
            <td><Due d={a.bot_end} today={d.today} label="Bot" /><Due d={a.vps_end} today={d.today} label="VPS" /></td>
            <td className="small" style={{ maxWidth: 280 }}>{a.last_event ? <>{LV[a.last_event.level]} {a.last_event.label}<div className="muted">{vn(a.last_event.at)}</div></> : '—'}</td>
          </tr>)}
          {!list.length && <tr><td colSpan={12}><div className="empty">Không có tài khoản nào</div></td></tr>}
        </tbody></table></div>
        <p className="small muted" style={{ margin: 0 }}>Số tiền theo đơn vị của tài khoản (USC = cent). Tín hiệu: gửi trong 5 phút là trực tuyến, 5–15 phút là chậm, quá 15 phút là mất tín hiệu (báo Telegram nội bộ mốc 15 và 45 phút).</p>
      </section>
    </>
  );
}

function AlertTable({ rows, onHandle }) {
  return (
    <div className="tbl" style={{ maxHeight: '50vh', overflowY: 'auto' }}><table><thead><tr><th>Mức</th><th>Tài khoản</th><th>Loại</th><th>Nội dung</th><th>Lúc (giờ VN)</th><th></th></tr></thead><tbody>
      {rows.map(x => <tr key={x.id}>
        <td>{LV[x.level]}</td>
        <td><a href={'#/admin/botmon/' + x.account_id} className="num">{x.account_no}</a><div className="small muted">{x.customer || 'chưa gắn khách'}</div></td>
        <td className="small">{KIND[x.kind] || x.kind}{x.cnt > 1 && <div><span className="pill mut">×{x.cnt} lần</span></div>}</td>
        <td className="small" style={{ maxWidth: 520 }}>{x.message}</td>
        <td className="small" style={{ whiteSpace: 'nowrap' }}>{vn(x.last_at)}{x.cnt > 1 && <div className="muted">từ {vn(x.first_at)}</div>}</td>
        <td className="r">{onHandle ? <button className="btn sm pri" onClick={() => onHandle(x.id)}>Đã xử lý</button>
          : <span className="small muted">{x.handled_by}<div>{vn(x.handled_at)}</div></span>}</td>
      </tr>)}
    </tbody></table></div>
  );
}

// ------------------------------------------------------------ chi tiết 1 tài khoản
const RANGES = [[6, '6 giờ'], [24, '24 giờ'], [72, '3 ngày'], [168, '7 ngày'], [720, '30 ngày']];
function Detail({ id, say }) {
  const [hours, setHours] = useState(24);
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  const [tab, setTab] = useState('events'); const [evLv, setEvLv] = useState('all'); const [cq, setCq] = useState(''); const [note, setNote] = useState('');
  const load = useCallback(() => rpc('ops_account', { p_id: id, p_hours: hours }).then(x => { setD(x); setErr(''); }).catch(e => setErr(e.message)), [id, hours]);
  useEffect(() => { load(); const a = setInterval(load, 30000); return () => clearInterval(a); }, [load]);
  const changed = useMemo(() => { const m = {}; (d?.config_hist || []).forEach(h => h.changes && Object.keys(h.changes).forEach(k => { if (!m[k]) m[k] = h.at; })); return m; }, [d]);
  if (err) return <div className="card neg">{err}</div>;
  if (!d) return <div className="empty">Đang tải…</div>;
  if (!d.acc) return <div className="card">Không tìm thấy tài khoản. <a href="#/admin/botmon">← Quay lại</a></div>;
  const a = d.acc, s = d.status || {}, sig = signal({ ...a, received_at: s.received_at });
  const handle = async ids => { try { await rpc('ops_alert_handle', { p_ids: ids }); say('Đã đánh dấu xử lý'); load(); } catch (x) { say(x.message); } };
  const addNote = async e => { e.preventDefault(); try { await rpc('ops_note_add', { p_id: id, p_body: note }); setNote(''); load(); say('Đã lưu ghi chú'); } catch (x) { say(x.message); } };
  const delNote = async n => { if (!confirm('Xóa ghi chú này?')) return; await rpc('ops_note_delete', { p_note: n.id }); load(); };
  const openAl = d.alerts.filter(x => !x.handled_at);
  const evs = d.events.filter(e => evLv === 'all' || e.level === evLv);
  const settings = d.config?.settings || {};
  const keys = Object.keys(settings).filter(k => !cq || k.toLowerCase().includes(cq.toLowerCase())).sort((x, y) => x.localeCompare(y));
  const activeTerms = d.terminals.filter(t => mins(t.last_seen) < 30);
  const series = d.series.map(p => ({ ...p, t: new Date(p.ts).getTime() }));
  const std = d.check?.preset_settings || {}; const diff = d.check?.diff || {};
  const exportHist = async () => { try { const rows = await rpc('ops_hist', { p_id: id, p_hours: hours }); csv('lionbot_' + a.account_no + '_trang_thai_' + hours + 'h', ['Thời điểm (VN)', 'Balance', 'Equity', 'Lãi/lỗ mở', 'DD %', 'Credit', 'Lệnh', 'Vị thế', 'Lot mua', 'Lot bán'], rows.map(r => [vnIso(r[0]), ...r.slice(1)])); } catch (x) { say(x.message); } };

  return (
    <>
      <section className="card">
        <div className="row"><a href="#/admin/botmon" className="btn sm">← Danh sách</a>
          <div className="title grow"><span className="num">{a.account_no}</span> · {a.customer || <i className="muted">chưa gắn khách</i>}</div>
          {sig.pill}{!a.approved && <span className="pill warn">Chờ duyệt</span>}{a.blocked && <span className="pill bad">Đã chặn</span>}</div>
        <div className="small muted">{a.broker || a.company || ''} · {a.server} · {a.currency}{a.system_name ? ' · nhánh ' + a.system_name : ''} · bot {a.bot_reported || a.bot_name || '—'}{a.bot_build ? ' (' + a.bot_build + ')' : ''} · lần cuối {vn(a.last_seen, true)} ({ago(sig.m)})</div>
        <div className="row" style={{ gap: 8 }}>
          {a.old_build && <span className="pill warn">Bot bản cũ · mới nhất {a.latest_build}</span>}
          {d.check?.diff && <span className="pill warn">Lệch cài đặt chuẩn "{d.check.preset}": {Object.keys(d.check.diff).length} thông số</span>}
          {d.check?.preset && !d.check?.diff && <span className="pill ok">Đúng cài đặt chuẩn "{d.check.preset}"</span>}
          {a.bot_end && <span className="pill mut">Bot hết hạn {vnDate(a.bot_end)}</span>}{a.vps_end && <span className="pill mut">VPS {a.vps_name} hết hạn {vnDate(a.vps_end)}</span>}
          <span className="grow" />
          <button className="btn sm" onClick={exportHist}>⬇ CSV trạng thái ({RANGES.find(x => x[0] === hours)?.[1]})</button>
          <button className="btn sm" onClick={() => csv('lionbot_' + a.account_no + '_su_kien', ['Nhận lúc (VN)', 'Giờ sàn', 'Loại', 'Mức', 'Nội dung', 'DD %', 'Balance', 'Equity', 'Lãi/lỗ', 'Thêm'], d.events.map(e => [vnIso(e.at), e.time_server, e.label, e.level, e.message, e.dd_pct, e.balance, e.equity, e.pnl, e.extra]))}>⬇ CSV sự kiện</button>
          <button className="btn sm" onClick={() => csv('lionbot_' + a.account_no + '_theo_ngay', ['Ngày', 'Lãi/lỗ ròng', 'Balance', 'Nạp', 'Rút', 'Lệnh', 'Lot', 'DD max %'], d.daily.map(r => [r.date, r.net, r.balance, r.deposit, r.withdraw, r.trades, r.lots, r.dd]))}>⬇ CSV theo ngày</button>
          {d.config && <button className="btn sm" onClick={() => csv('lionbot_' + a.account_no + '_cai_dat', ['Thông số', 'Giá trị', 'Chuẩn'], Object.keys(settings).sort().map(k => [k, settings[k], std[k]]))}>⬇ CSV cài đặt</button>}
        </div>
        <div className="kpis">
          <div className="kpi"><span className="label">Balance</span><span className="num-xl">{fmt(s.balance)}</span><span className="sub">Equity {fmt(s.equity)}{s.credit ? ' · credit ' + fmt(s.credit) : ''}</span></div>
          <div className="kpi"><span className="label">Lãi/lỗ đang mở</span><span className={'num-xl ' + (Number(s.floating) < 0 ? 'neg' : Number(s.floating) > 0 ? 'pos' : '')}>{fmt(s.floating)}</span><span className="sub">{s.orders ?? s.positions ?? 0} lệnh · lot {fmt(s.lots_buy)} mua / {fmt(s.lots_sell)} bán</span></div>
          <div className="kpi"><span className="label">DD hiện tại</span><span className={'num-xl ' + ddCls(s.dd_pct, s.maxdd_pct)}>{s.dd_pct == null ? '—' : fmt(s.dd_pct) + '%'}</span><span className="sub">Max DD cài đặt {s.maxdd_pct == null ? '—' : fmt(s.maxdd_pct, 0) + '%'}</span></div>
          <div className="kpi"><span className="label">Trạng thái bot</span><span className="num-xl" style={{ fontSize: 22 }}>{STATE[s.bot_state] || s.bot_state || '—'}</span><span className="sub">{s.basket_mode ? 'Rổ ' + s.basket_mode + ' · ' : ''}{s.basket_pnl != null ? 'lãi rổ ' + fmt(s.basket_pnl) : ''}{s.gong ? ' · đang gồng' : ''}</span></div>
        </div>
        {activeTerms.length >= 2 && <div className="pill bad" style={{ justifySelf: 'start' }}>⚠️ {activeTerms.length} máy đang chạy bot cùng lúc trên tài khoản này</div>}
      </section>

      {openAl.length > 0 && <section className="card">
        <div className="row"><div className="title grow">Cảnh báo chưa xử lý ({openAl.length})</div>{openAl.length > 1 && <button className="btn sm" onClick={() => handle(openAl.map(x => x.id))}>Đã xử lý tất cả</button>}</div>
        <AlertTable rows={openAl.map(x => ({ ...x, account_no: a.account_no, customer: a.customer }))} onHandle={x => handle([x])} />
      </section>}

      <section className="card">
        <div className="row"><div className="title grow">Balance / Equity</div>
          <div className="seg">{RANGES.map(([h, l]) => <button key={h} className={hours === h ? 'on' : ''} onClick={() => setHours(h)}>{l}</button>)}</div></div>
        {series.length > 1 ? <EqChart data={series} hours={hours} /> : <div className="empty">Chưa đủ dữ liệu trong khoảng này</div>}
      </section>

      <section className="card">
        <div className="seg" style={{ justifySelf: 'start', flexWrap: 'wrap' }}>{[['events', `Sự kiện (${d.events.length})`], ['config', `Cài đặt (${Object.keys(settings).length})`], ['daily', `Theo ngày (${d.daily.length})`], ['terminals', `Máy (${d.terminals.length})`], ['notes', `Ghi chú (${d.notes.length})`], ['history', 'Lịch sử cảnh báo']].map(([k, l]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>

        {tab === 'events' && <>
          <div className="seg" style={{ justifySelf: 'start' }}>{[['all', 'Tất cả'], ['red', '🔴 Đỏ'], ['orange', '🟠 Cam'], ['info', '⚪ Thông tin']].map(([k, l]) => <button key={k} className={evLv === k ? 'on' : ''} onClick={() => setEvLv(k)}>{l}</button>)}</div>
          {evs.length ? <div className="tbl" style={{ maxHeight: '60vh', overflowY: 'auto' }}><table><thead><tr><th>Nhận lúc (giờ VN)</th><th>Giờ sàn</th><th>Sự kiện</th><th>Nội dung</th><th className="r">DD</th><th className="r">Balance</th><th className="r">Equity</th><th className="r">Lãi/lỗ</th></tr></thead><tbody>
            {evs.map(e => <tr key={e.id}>
              <td className="small" style={{ whiteSpace: 'nowrap' }}>{vn(e.at, true)}</td><td className="small muted" style={{ whiteSpace: 'nowrap' }}>{e.time_server || ''}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{LV[e.level]} {e.label}</td>
              <td className="small" style={{ maxWidth: 460 }}>{e.message}{(() => { const x = Object.entries(e.extra || {}).filter(([k]) => !['bot', 'bot_version', 'company', 'currency', 'terminal_id'].includes(k)); return x.length > 0 && <div className="muted key" style={{ marginTop: 4 }}>{x.map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' · ')}</div>; })()}</td>
              <td className="r num">{e.dd_pct == null ? '' : fmt(e.dd_pct) + '%'}</td><td className="r num">{e.balance == null ? '' : fmt(e.balance)}</td><td className="r num">{e.equity == null ? '' : fmt(e.equity)}</td>
              <td className={'r num ' + (Number(e.pnl) < 0 ? 'neg' : Number(e.pnl) > 0 ? 'pos' : '')}>{e.pnl == null ? '' : fmt(e.pnl)}</td>
            </tr>)}</tbody></table></div> : <div className="empty">Chưa có sự kiện</div>}
        </>}

        {tab === 'config' && <>
          {d.config ? <>
            <div className="row"><label className="field" style={{ width: 'min(260px,100%)' }}><input id="bm-cq" type="search" placeholder="Tìm tên thông số…" value={cq} onChange={e => setCq(e.target.value)} /></label>
              <span className="small muted">Cập nhật {vn(d.config.updated_at)} · ô vàng là thông số đã đổi gần đây · ô đỏ là lệch cài đặt chuẩn</span></div>
            <div className="tbl" style={{ maxHeight: '55vh', overflowY: 'auto' }}><table><thead><tr><th>Thông số</th><th>Giá trị</th><th>Chuẩn{d.check?.preset ? ' (' + d.check.preset + ')' : ''}</th><th>Đổi lần cuối</th></tr></thead><tbody>
              {keys.map(k => <tr key={k} style={diff[k] ? { background: 'var(--loss-soft)' } : changed[k] ? { background: 'var(--brand-soft)' } : null}><td className="num small">{k}</td><td className={'num small' + (diff[k] ? ' neg' : '')}>{String(settings[k])}</td>
                <td className="num small">{k in std ? <>{String(std[k])} {diff[k] ? '⚠️' : '✓'}</> : ''}</td><td className="small muted">{changed[k] ? vn(changed[k]) : ''}</td></tr>)}
            </tbody></table></div>
            <div className="label">Lịch sử thay đổi</div>
            {d.config_hist.length ? <div className="tbl" style={{ maxHeight: 360, overflowY: 'auto' }}><table><tbody>{d.config_hist.map(h => <tr key={h.id}>
              <td className="small" style={{ whiteSpace: 'nowrap' }}>{vn(h.at)}</td>
              <td className="small">{h.changes ? Object.entries(h.changes).map(([k, [o, n]]) => <div key={k}><span className="num">{k}</span>: <span className="muted">{o == null ? '(chưa có)' : String(o)}</span> → <b>{n == null ? '(bỏ)' : String(n)}</b></div>) : <span className="muted">Lần đầu nhận cài đặt</span>}</td></tr>)}
            </tbody></table></div> : <div className="small muted">Chưa có.</div>}
          </> : <div className="empty">Bot chưa gửi cài đặt</div>}
        </>}

        {tab === 'daily' && (d.daily.length ? <div className="tbl"><table><thead><tr><th>Ngày</th><th className="r">Lãi/lỗ ròng</th><th className="r">Balance</th><th className="r">Nạp</th><th className="r">Rút</th><th className="r">Lệnh</th><th className="r">Lot</th><th className="r">DD max</th></tr></thead><tbody>
          {d.daily.map(r => <tr key={r.date}><td>{vnDate(r.date)}</td><td className={'r num ' + (Number(r.net) < 0 ? 'neg' : Number(r.net) > 0 ? 'pos' : '')}>{fmt(r.net)}</td><td className="r num">{fmt(r.balance)}</td>
            <td className="r num">{r.deposit ? fmt(r.deposit) : ''}</td><td className="r num">{r.withdraw ? fmt(r.withdraw) : ''}</td><td className="r num">{r.trades ?? ''}</td><td className="r num">{r.lots == null ? '' : fmt(r.lots)}</td><td className="r num">{r.dd == null ? '' : fmt(r.dd) + '%'}</td></tr>)}
        </tbody></table></div> : <div className="empty">Chưa có chốt ngày</div>)}

        {tab === 'terminals' && (d.terminals.length ? <div className="tbl"><table><thead><tr><th>Mã máy</th><th>Lần đầu</th><th>Lần cuối</th><th></th></tr></thead><tbody>
          {d.terminals.map(t => <tr key={t.terminal_id}><td className="num">{t.terminal_id}</td><td className="small">{vn(t.first_seen)}</td><td className="small">{vn(t.last_seen)} <span className="muted">({ago(mins(t.last_seen))})</span></td>
            <td>{mins(t.last_seen) < 30 ? <span className="pill ok">Đang chạy</span> : <span className="pill mut">Không còn gửi</span>}</td></tr>)}
        </tbody></table></div> : <div className="empty">Bot chưa gửi mã máy</div>)}

        {tab === 'notes' && <>
          <form className="row" onSubmit={addNote} style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: '1 1 400px' }}>Ghi chú kỹ thuật (đổi VPS, chỉnh thông số, đã gọi khách…)<textarea id="bm-note" rows={2} value={note} onChange={e => setNote(e.target.value)} /></label>
            <button className="btn pri" disabled={!note.trim()}>Lưu ghi chú</button></form>
          {d.notes.length ? <div className="tbl"><table><tbody>{d.notes.map(n => <tr key={n.id}><td className="small" style={{ whiteSpace: 'nowrap' }}>{vn(n.at)}<div className="muted">{n.author}</div></td>
            <td style={{ whiteSpace: 'pre-wrap' }}>{n.body}</td><td className="r"><button className="btn sm" onClick={() => delNote(n)}>Xóa</button></td></tr>)}</tbody></table></div> : <div className="small muted">Chưa có ghi chú.</div>}
        </>}

        {tab === 'history' && (d.alerts.length ? <AlertTable rows={d.alerts.filter(x => x.handled_at).map(x => ({ ...x, account_no: a.account_no, customer: a.customer }))} /> : <div className="empty">Chưa có cảnh báo</div>)}
      </section>
    </>
  );
}

const axis = { stroke: 'var(--line)', tick: { fill: 'var(--ink-muted)', fontSize: 12 }, tickLine: false };
function EqChart({ data, hours }) {
  const f = t => { const o = hours > 48 ? { day: '2-digit', month: '2-digit', hour: '2-digit' } : { hour: '2-digit', minute: '2-digit' }; return new Date(t).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', ...o }); };
  return (
    <div style={{ width: '100%', height: 320 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeOpacity={0.6} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} {...axis} tickFormatter={f} minTickGap={40} />
          <YAxis yAxisId="v" {...axis} width={72} domain={[m => { const x = Math.max(0, m - Math.abs(m) * 0.01); return Math.floor(x); }, M => Math.ceil(M + Math.abs(M) * 0.005)]} tickFormatter={v => fmt(v, 0)} />
          <YAxis yAxisId="dd" orientation="right" {...axis} width={44} domain={[0, m => Math.max(5, Math.ceil(m * 3))]} tickFormatter={v => fmt(v, 0) + '%'} />
          <Tooltip contentStyle={{ background: 'var(--surface-200)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)' }} labelStyle={{ color: 'var(--ink-muted)' }}
            labelFormatter={t => vn(t, true)} formatter={(v, n) => [n === 'DD %' ? fmt(v) + '%' : fmt(v), n]} />
          <Legend wrapperStyle={{ fontSize: 13 }} />
          <Area yAxisId="dd" type="monotone" dataKey="dd" name="DD %" stroke="var(--loss)" strokeWidth={1} strokeOpacity={0.7} fill="var(--loss)" fillOpacity={0.08} dot={false} isAnimationActive={false} />
          <Line yAxisId="v" type="stepAfter" dataKey="balance" name="Balance" stroke="var(--info)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line yAxisId="v" type="monotone" dataKey="equity" name="Equity" stroke="var(--brand)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------ cài đặt chuẩn theo mức vốn + phiên bản bot
function Presets({ say }) {
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null); const [saving, setSaving] = useState(false);
  const [nk, setNk] = useState(''); const [nv, setNv] = useState(''); const [src, setSrc] = useState(''); const [build, setBuild] = useState('');
  const load = useCallback(() => rpc('ops_presets').then(x => { setD(x); setBuild(x.latest_build || ''); }).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="card neg">{err}</div>;
  if (!d) return <div className="empty">Đang tải…</div>;
  const parse = v => { const t = String(v).trim(); if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t); if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true'; return t; };
  const save = async () => {
    setSaving(true);
    try { await rpc('ops_preset_save', { p: edit }); setEdit(null); load(); say('Đã lưu bộ cài đặt chuẩn, đã kiểm lại mọi tài khoản'); } catch (x) { say(x.message); } finally { setSaving(false); }
  };
  const del = async p => { if (!confirm('Xóa bộ "' + p.name + '"?')) return; try { await rpc('ops_preset_delete', { p_id: p.id }); load(); say('Đã xóa'); } catch (x) { say(x.message); } };
  const setLatest = async b => { try { await rpc('ops_set_latest_build', { p_build: b }); load(); say(b ? 'Đã đặt bản mới nhất: ' + b : 'Đã bỏ kiểm phiên bản'); } catch (x) { say(x.message); } };
  const setKey = (k, v) => setEdit({ ...edit, settings: { ...edit.settings, [k]: v } });
  const delKey = k => { const s = { ...edit.settings }; delete s[k]; setEdit({ ...edit, settings: s }); };
  const fromAcc = () => { const x = d.sources.find(s => s.id === src); if (!x) return; if (Object.keys(edit.settings).length && !confirm('Thay toàn bộ thông số bằng cài đặt của TK ' + x.label + '?')) return; setEdit({ ...edit, settings: { ...x.settings } }); say('Đã chép ' + Object.keys(x.settings).length + ' thông số. Bỏ bớt những ô không cần kiểm (Magic, hiển thị…).'); };
  const mism = d.checks.filter(c => c.diff);
  const money = v => (v == null || v === '' ? '∞' : '$' + fmt(v, 0));
  return (
    <>
      <section className="card">
        <div className="row"><a href="#/admin/botmon" className="btn sm">← Giám sát bot</a><div className="title grow">Cài đặt chuẩn theo mức vốn</div>
          <button className="btn pri" onClick={() => { setSrc(''); setEdit({ name: '', cap_min: '', cap_max: '', note: '', enabled: true, settings: {} }); }}>+ Thêm bộ chuẩn</button></div>
        <p className="small muted" style={{ margin: 0 }}>Mỗi bộ áp cho tài khoản có vốn (balance, TK cent đã đổi ra USD) trong khoảng <b>từ ≤ vốn &lt; đến</b>. Web so cài đặt bot gửi lên với bộ chuẩn: lệch thì cảnh báo trên Giám sát bot và báo nhóm Telegram nội bộ. Chỉ đưa vào bộ chuẩn các thông số cần giữ đúng (Max DD, lot, lọc tin…). Số so theo giá trị (60 = 60.0), chữ không phân biệt hoa thường.</p>
        {d.presets.length ? <div className="tbl"><table><thead><tr><th>Bộ chuẩn</th><th>Vốn (USD)</th><th className="r">Số thông số</th><th className="r">TK áp dụng</th><th className="r">TK lệch</th><th>Cập nhật</th><th></th></tr></thead><tbody>
          {d.presets.map(p => <tr key={p.id}><td><b>{p.name}</b>{!p.enabled && <> <span className="pill mut">Tắt</span></>}{p.note && <div className="small muted">{p.note}</div>}</td>
            <td className="num">{money(p.cap_min)} – {money(p.cap_max)}</td><td className="r num">{Object.keys(p.settings || {}).length}</td><td className="r num">{p.accounts}</td>
            <td className={'r num ' + (p.mismatch ? 'neg' : '')}>{p.mismatch}</td><td className="small muted">{vn(p.updated_at)}{p.updated_by && <div>{p.updated_by}</div>}</td>
            <td className="r"><span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}><button className="btn sm" onClick={() => { setSrc(''); setEdit({ ...p, settings: { ...p.settings } }); }}>Sửa</button><button className="btn sm" onClick={() => del(p)}>Xóa</button></span></td></tr>)}
        </tbody></table></div> : <div className="empty">Chưa có bộ chuẩn nào. Bấm <b>+ Thêm bộ chuẩn</b>, chọn "Chép từ tài khoản" một TK đang chạy đúng rồi bỏ bớt thông số không cần kiểm.</div>}
      </section>

      <section className="card">
        <div className="title">Tài khoản lệch cài đặt chuẩn ({mism.length})</div>
        {mism.length ? <div className="tbl"><table><thead><tr><th>Tài khoản</th><th>Vốn (USD)</th><th>Bộ chuẩn</th><th>Thông số lệch (thực tế → chuẩn)</th></tr></thead><tbody>
          {mism.map(c => <tr key={c.account_id}><td><a href={'#/admin/botmon/' + c.account_id} className="num">{c.account_no}</a><div className="small muted">{c.customer || 'chưa gắn khách'}</div></td>
            <td className="num">{c.cap_usd == null ? '—' : '$' + fmt(c.cap_usd)}</td><td>{c.preset}</td>
            <td className="small">{Object.entries(c.diff).map(([k, [o, n]]) => <div key={k}><span className="num">{k}</span>: <span className="neg">{o == null ? '(không có)' : String(o)}</span> → <b>{String(n)}</b></div>)}</td></tr>)}
        </tbody></table></div> : <div className="empty">✅ {d.presets.length ? 'Mọi tài khoản đều đúng cài đặt chuẩn' : 'Chưa có bộ chuẩn để so'}</div>}
      </section>

      <section className="card">
        <div className="title">Phiên bản bot</div>
        <p className="small muted" style={{ margin: 0 }}>Đặt bản mới nhất: tài khoản chạy bản thấp hơn được đánh dấu <span className="pill warn">Bản cũ</span> và đưa vào bản tin kỹ thuật 8:00 sáng. So theo ngày giờ trong tên bản (vd 2026.11.10 13:03).</p>
        <form className="row" onSubmit={e => { e.preventDefault(); setLatest(build); }}>
          <label className="field" style={{ width: 'min(280px,100%)' }}><input id="bm-build" placeholder="Bản mới nhất, vd 2026.11.10 13:03" value={build} onChange={e => setBuild(e.target.value)} /></label>
          <button className="btn pri">Lưu</button>{d.latest_build && <button type="button" className="btn" onClick={() => setLatest('')}>Bỏ kiểm phiên bản</button>}</form>
        {d.builds.length ? <div className="tbl"><table><thead><tr><th>Bản đang chạy</th><th className="r">Số TK</th><th></th><th></th></tr></thead><tbody>
          {d.builds.map(b => <tr key={b.build}><td className="num">{b.build}</td><td className="r num">{b.n}</td><td>{b.build === d.latest_build ? <span className="pill ok">Mới nhất</span> : b.old ? <span className="pill warn">Bản cũ</span> : ''}</td>
            <td className="r">{b.build !== d.latest_build && <button className="btn sm" onClick={() => setLatest(b.build)}>Đặt làm bản mới nhất</button>}</td></tr>)}
        </tbody></table></div> : <div className="small muted">Chưa có bot nào báo phiên bản.</div>}
      </section>

      {edit && <Modal title={edit.id ? 'Sửa bộ cài đặt chuẩn' : 'Thêm bộ cài đặt chuẩn'} onClose={() => setEdit(null)} onSave={save} saving={saving}>
        <div className="form">
          <F label="Tên bộ"><input id="ps-name" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="Vốn 1.000 – 5.000 USD" /></F>
          <F label="Vốn từ (USD)"><input id="ps-min" type="number" min="0" step="any" value={edit.cap_min ?? ''} onChange={e => setEdit({ ...edit, cap_min: e.target.value })} /></F>
          <F label="Đến dưới (USD, trống = không giới hạn)"><input id="ps-max" type="number" min="0" step="any" value={edit.cap_max ?? ''} onChange={e => setEdit({ ...edit, cap_max: e.target.value })} /></F>
          <F label="Trạng thái"><label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: 18, height: 18 }} checked={edit.enabled !== false} onChange={e => setEdit({ ...edit, enabled: e.target.checked })} />Đang dùng</label></F>
          <F label="Ghi chú" wide><input id="ps-note" value={edit.note || ''} onChange={e => setEdit({ ...edit, note: e.target.value })} /></F>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '1 1 260px' }}>Chép thông số từ tài khoản đang chạy<select id="ps-src" value={src} onChange={e => setSrc(e.target.value)}><option value="">— chọn tài khoản —</option>{d.sources.map(s => <option key={s.id} value={s.id}>{s.label}{s.cap_usd != null ? ' · $' + fmt(s.cap_usd, 0) : ''}</option>)}</select></label>
          <button type="button" className="btn" disabled={!src} onClick={fromAcc}>Chép</button></div>
        <div className="label">Thông số cần kiểm ({Object.keys(edit.settings).length})</div>
        <div className="tbl" style={{ maxHeight: 340, overflowY: 'auto' }}><table><tbody>
          {Object.keys(edit.settings).sort().map(k => <tr key={k}><td className="num small">{k}</td>
            <td><label className="field"><input aria-label={k} value={String(edit.settings[k])} onChange={e => setKey(k, parse(e.target.value))} /></label></td>
            <td className="r"><button type="button" className="btn sm" onClick={() => delKey(k)}>Bỏ</button></td></tr>)}
          {!Object.keys(edit.settings).length && <tr><td className="small muted">Chưa có thông số.</td></tr>}
        </tbody></table></div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '1 1 200px' }}>Thêm thông số<input id="ps-k" list="ps-keys" value={nk} onChange={e => setNk(e.target.value)} placeholder="vd MaxDD_Pct" /></label>
          <datalist id="ps-keys">{d.keys.map(k => <option key={k} value={k} />)}</datalist>
          <label className="field" style={{ flex: '1 1 140px' }}>Giá trị<input id="ps-v" value={nv} onChange={e => setNv(e.target.value)} /></label>
          <button type="button" className="btn" disabled={!nk.trim()} onClick={() => { setKey(nk.trim(), parse(nv)); setNk(''); setNv(''); }}>+ Thêm</button></div>
      </Modal>}
    </>
  );
}
