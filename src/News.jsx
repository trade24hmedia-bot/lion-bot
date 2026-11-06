import { useEffect, useState, useCallback } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { rpc, fmt, t } from './lib.js';

// Tin tức vàng + lịch kinh tế + cảnh báo biến động. Ai cũng xem được (không cần đăng nhập).
// Dữ liệu do Supabase tự lấy mỗi phút (giá), 5 phút (tin), 60 phút (lịch) — xem supabase/006_news.sql.

export const LV = {
  red:    { c: 'var(--loss)', bg: 'var(--loss-soft)', vi: 'ĐỎ', en: 'RED', name: 'Rủi ro rất cao', icon: '🔴' },
  orange: { c: '#FF8A3D', bg: 'rgba(255,138,61,.15)', vi: 'CAM', en: 'ORANGE', name: 'Thận trọng', icon: '🟠' },
  yellow: { c: '#E9C23A', bg: 'rgba(233,194,58,.15)', vi: 'VÀNG', en: 'YELLOW', name: 'Chú ý', icon: '🟡' },
  green:  { c: 'var(--profit)', bg: 'var(--profit-soft)', vi: 'XANH', en: 'GREEN', name: 'Bình thường', icon: '🟢' },
  info:   { c: 'var(--ink-muted)', bg: 'var(--surface-200)', vi: 'THƯỜNG', en: 'INFO', name: 'Tin thường', icon: '⚪' }
};
const Dot = ({ lv }) => <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 99, background: LV[lv]?.c, flex: 'none' }} />;
const Badge = ({ lv, children }) => <span className="pill" style={{ background: LV[lv]?.bg, color: LV[lv]?.c }}>{children || LV[lv]?.vi}</span>;
const vnTime = (ts, opt) => new Date(ts).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', ...(opt || { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) });
const ago = ts => { const m = Math.round((Date.now() - new Date(ts)) / 60000); return m < 1 ? 'vừa xong' : m < 60 ? m + ' phút trước' : m < 1440 ? Math.floor(m / 60) + ' giờ trước' : Math.floor(m / 1440) + ' ngày trước'; };
const until = ts => { const m = Math.round((new Date(ts) - Date.now()) / 60000); if (m <= 0) return 'đang diễn ra'; return m < 60 ? 'còn ' + m + ' phút' : m < 1440 ? 'còn ' + Math.floor(m / 60) + ' giờ ' + (m % 60) + ' phút' : 'còn ' + Math.floor(m / 1440) + ' ngày'; };
const sgn = v => (v == null ? '—' : (Number(v) >= 0 ? '+$' : '−$') + fmt(Math.abs(v)));

// Cảnh báo dùng chung: banner đầu trang
export function useMarketStatus(ms = 60000) {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let on = true;
    const load = () => rpc('market_status').then(d => on && setSt(d)).catch(() => {});
    load(); const id = setInterval(load, ms);
    return () => { on = false; clearInterval(id); };
  }, [ms]);
  return st;
}
export function AlertBanner({ st }) {
  if (!st || !['red', 'orange'].includes(st.level)) return null;
  const L = LV[st.level], r = (st.reasons || []).find(x => x.level === st.level) || st.reasons?.[0];
  return (
    <div style={{ background: L.bg, borderBottom: '1px solid ' + L.c }}>
      <div className="wrap row" style={{ gap: 10, paddingBlock: 10 }}>
        <b style={{ color: L.c, whiteSpace: 'nowrap' }}>{L.icon} CẢNH BÁO {L.vi}</b>
        <span className="grow small" style={{ minWidth: 200 }}><b>{st.advice}</b>{r && <> · {r.text}</>}</span>
        <a className="btn sm" href="#/news">Xem tin →</a>
      </div>
    </div>
  );
}

function PriceChart({ ticks }) {
  if (!ticks?.length) return <div className="empty">Đang thu thập giá…</div>;
  const data = ticks.map(x => ({ t: x.t, p: Number(x.p) }));
  const lo = Math.min(...data.map(d => d.p)), hi = Math.max(...data.map(d => d.p)), pad = Math.max((hi - lo) * 0.15, 2);
  return (
    <div style={{ width: '100%', height: 200 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
          <defs><linearGradient id="lbGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--brand)" stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeOpacity={0.6} />
          <XAxis dataKey="t" stroke="var(--line)" tick={{ fill: 'var(--ink-muted)', fontSize: 11 }} tickLine={false} minTickGap={40} tickFormatter={v => vnTime(v, { hour: '2-digit', minute: '2-digit' })} />
          <YAxis domain={[lo - pad, hi + pad]} stroke="var(--line)" tick={{ fill: 'var(--ink-muted)', fontSize: 11 }} tickLine={false} width={58} tickFormatter={v => fmt(v, 0)} />
          <Tooltip contentStyle={{ background: 'var(--surface-200)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)' }} formatter={v => ['$' + fmt(v), 'XAU']} labelFormatter={v => vnTime(v)} />
          <Area type="monotone" dataKey="p" stroke="var(--brand)" strokeWidth={2} fill="url(#lbGold)" dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function News() {
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  const [lvF, setLvF] = useState('hot'); const [lang, setLang] = useState(''); const [evF, setEvF] = useState('hot');
  const load = useCallback(() => rpc('market_feed', { p_hours: 48 }).then(x => { setD(x); setErr(''); }).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  if (err && !d) return <main className="wrap"><div className="card neg">{err}</div></main>;
  if (!d) return <main className="wrap"><div className="empty">{t('loading')}</div></main>;
  const st = d.status || {}, L = LV[st.level] || LV.green;
  const news = (d.news || []).filter(n => (lvF === 'all' || (lvF === 'hot' ? n.level !== 'info' : n.level === lvF)) && (!lang || n.lang === lang));
  const events = (d.events || []).filter(e => evF === 'all' || e.level !== 'yellow');
  const byDay = events.reduce((m, e) => { const k = vnTime(e.at, { weekday: 'long', day: '2-digit', month: '2-digit' }); (m[k] = m[k] || []).push(e); return m; }, {});
  const cnt = lv => (d.news || []).filter(n => n.level === lv && new Date(n.published) > Date.now() - 864e5).length;
  return (
    <main className="wrap">
      <div className="row"><h1 className="h-lg grow">Tin tức & cảnh báo vàng</h1><span className="small muted">Tự cập nhật mỗi phút · {st.updated_at ? vnTime(st.updated_at, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}</span></div>

      <section className="card" style={{ borderColor: L.c, background: `linear-gradient(0deg, ${L.bg}, ${L.bg}), var(--surface-100)` }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div style={{ display: 'grid', gap: 6, flex: '1 1 320px' }}>
            <span className="small muted">MỨC CẢNH BÁO HIỆN TẠI</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30, color: L.c }}>{L.icon} {L.vi} · {L.name}</span>
            <b style={{ fontSize: 16 }}>{st.advice}</b>
            {(st.reasons || []).length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
              {st.reasons.map((r, i) => <li key={i}><Badge lv={r.level} /> {r.link ? <a href={r.link} target="_blank" rel="noopener noreferrer">{r.text}</a> : r.text}</li>)}
            </ul>}
            {st.next_red && <span className="small">Tin đỏ tiếp theo: <b>{st.next_red.title}</b> ({st.next_red.country}) · {vnTime(st.next_red.at)} · <b style={{ color: 'var(--loss)' }}>{until(st.next_red.at)}</b></span>}
          </div>
          <div style={{ display: 'grid', gap: 4, minWidth: 210 }}>
            <span className="small muted">GIÁ VÀNG XAU/USD</span>
            <span className="num-xl">{st.price ? '$' + fmt(st.price) : '—'}</span>
            <span className="small num"><span className={Number(st.chg15) >= 0 ? 'pos' : 'neg'}>{sgn(st.chg15)}</span> <span className="muted">15 phút</span> · <span className={Number(st.chg60) >= 0 ? 'pos' : 'neg'}>{sgn(st.chg60)}</span> <span className="muted">60 phút</span></span>
            <span className="small muted">Biên độ 15p ${fmt(st.range15)} · 60p ${fmt(st.range60)}</span>
          </div>
        </div>
      </section>

      <section className="card"><div className="title">Giá vàng 24 giờ (giờ Việt Nam)</div><PriceChart ticks={d.ticks} /></section>

      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,440px),1fr))', alignItems: 'start' }}>
        <section className="card">
          <div className="row"><div className="title grow">Lịch tin kinh tế (giống lịch MT5)</div>
            <div className="seg">{[['hot', 'Đỏ + Cam'], ['all', 'Tất cả']].map(([k, l]) => <button key={k} type="button" className={evF === k ? 'on' : ''} onClick={() => setEvF(k)}>{l}</button>)}</div></div>
          <p className="small muted" style={{ margin: 0 }}>Giờ Việt Nam. 🔴 tin mạnh của Mỹ (USD), 🟠 tin mạnh nước khác hoặc tin trung bình của Mỹ. Cảnh báo bật từ 30 phút trước đến 30 phút sau giờ ra tin.</p>
          {Object.keys(byDay).length ? Object.entries(byDay).map(([day, list]) => (
            <div key={day} style={{ display: 'grid', gap: 6 }}>
              <b className="small" style={{ textTransform: 'capitalize', color: 'var(--ink-muted)' }}>{day}</b>
              {list.map(e => { const past = new Date(e.at) < Date.now() - 30 * 60000; return (
                <div key={e.title + e.at} className="row" style={{ gap: 10, opacity: past ? 0.5 : 1, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <span className="num small" style={{ width: 44, flex: 'none' }}>{vnTime(e.at, { hour: '2-digit', minute: '2-digit' })}</span>
                  <Dot lv={e.level} />
                  <span className="grow" style={{ minWidth: 0 }}><b>{e.country}</b> · {e.title}
                    {(e.forecast || e.previous) && <span className="small muted"> · Dự báo {e.forecast || '—'} · Trước {e.previous || '—'}</span>}</span>
                  {!past && e.level === 'red' && <span className="small" style={{ color: 'var(--loss)', whiteSpace: 'nowrap' }}>{until(e.at)}</span>}
                </div>); })}
            </div>)) : <div className="empty">Chưa có lịch tin</div>}
        </section>

        <section className="card">
          <div className="row"><div className="title grow">Tin tức ảnh hưởng giá vàng</div>
            <div className="seg">{[['hot', 'Đáng chú ý'], ['red', '🔴 ' + cnt('red')], ['orange', '🟠 ' + cnt('orange')], ['all', 'Tất cả']].map(([k, l]) => <button key={k} type="button" className={lvF === k ? 'on' : ''} onClick={() => setLvF(k)}>{l}</button>)}</div>
            <select id="news-lang" className="btn sm" value={lang} onChange={e => setLang(e.target.value)}><option value="">EN + VI</option><option value="en">English</option><option value="vi">Tiếng Việt</option></select></div>
          <p className="small muted" style={{ margin: 0 }}>Điểm 0–100 chấm theo mức ảnh hưởng tới giá vàng: chiến sự, Fed / lãi suất, dữ liệu Mỹ, bầu cử, thuế quan, giá chạy mạnh… <b style={{ color: LV.red.c }}>≥70 Đỏ</b> · <b style={{ color: LV.orange.c }}>45–69 Cam</b> · <b style={{ color: LV.yellow.c }}>25–44 Vàng</b>.</p>
          <div style={{ display: 'grid', gap: 2, maxHeight: '75vh', overflowY: 'auto' }}>
            {news.map(n => (
              <a key={n.id} href={n.link} target="_blank" rel="noopener noreferrer" className="row" style={{ gap: 12, padding: '10px 4px', borderBottom: '1px solid var(--line)', color: 'var(--ink)', textDecoration: 'none', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <span className="num" style={{ flex: 'none', width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', fontWeight: 700, background: LV[n.level].bg, color: LV[n.level].c }}>{n.score}</span>
                <span style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, lineHeight: 1.35 }}>{n.title}</span>
                  <span className="small muted">{n.source || ''} · {ago(n.published)} · {n.lang === 'vi' ? 'VI' : 'EN'}{n.tags?.length ? ' · ' : ''}{(n.tags || []).join(' · ')}</span>
                </span>
              </a>))}
            {!news.length && <div className="empty">Chưa có tin phù hợp</div>}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="title">Gợi ý xử lý bot theo mức cảnh báo</div>
        <div className="tbl"><table><tbody>
          <tr><td><Badge lv="red" /></td><td><b>Tắt bot hoặc giảm vol mạnh</b>, không mở lệnh mới. Đóng bớt lệnh đang âm sâu nếu DD ngày đã cao. Bật lại khi về Cam / Vàng.</td></tr>
          <tr><td><Badge lv="orange" /></td><td><b>Giảm vol</b> (ví dụ còn 50%), theo dõi DD trong ngày, tránh nhồi lệnh.</td></tr>
          <tr><td><Badge lv="yellow" /></td><td>Có tin cần chú ý, bot chạy bình thường.</td></tr>
          <tr><td><Badge lv="green" /></td><td>Thị trường bình thường.</td></tr>
        </tbody></table></div>
        <p className="small muted" style={{ margin: 0 }}>Cảnh báo ĐỎ bật khi: giá vàng chạy ≥ 0,35% trong 15 phút (khoảng $14 ở giá $4.000) hoặc ≥ 0,7% trong 60 phút; hoặc trong ±30 phút quanh tin đỏ của Mỹ; hoặc có tin ≥ 70 điểm trong 90 phút qua. Đây là công cụ hỗ trợ, không phải khuyến nghị đầu tư.</p>
      </section>
    </main>
  );
}
