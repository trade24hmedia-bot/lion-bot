import { useEffect, useState, useCallback } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { rpc, fmt, t, tr, locale, getLang } from './lib.js';

// Tin tức vàng + lịch kinh tế + cảnh báo biến động. Ai cũng xem được (không cần đăng nhập).
// Dữ liệu do Supabase tự lấy mỗi phút (giá), 5 phút (tin), 60 phút (lịch) — xem supabase/006_news.sql.

export const LV = {
  red:    { c: 'var(--loss)', bg: 'var(--loss-soft)', vi: 'ĐỎ', en: 'RED', name: 'Rủi ro rất cao', name_en: 'Very high risk', icon: '🔴' },
  orange: { c: '#FF8A3D', bg: 'rgba(255,138,61,.15)', vi: 'CAM', en: 'ORANGE', name: 'Thận trọng', name_en: 'Caution', icon: '🟠' },
  yellow: { c: '#E9C23A', bg: 'rgba(233,194,58,.15)', vi: 'VÀNG', en: 'YELLOW', name: 'Chú ý', name_en: 'Watch', icon: '🟡' },
  green:  { c: 'var(--profit)', bg: 'var(--profit-soft)', vi: 'XANH', en: 'GREEN', name: 'Bình thường', name_en: 'Normal', icon: '🟢' },
  info:   { c: 'var(--ink-muted)', bg: 'var(--surface-200)', vi: 'THƯỜNG', en: 'INFO', name: 'Tin thường', name_en: 'Regular news', icon: '⚪' }
};
const Dot = ({ lv }) => <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 99, background: LV[lv]?.c, flex: 'none' }} />;
const Badge = ({ lv, children }) => <span className="pill" style={{ background: LV[lv]?.bg, color: LV[lv]?.c }}>{children || lvName(lv)}</span>;
const lvName = lv => (getLang() === 'en' ? LV[lv]?.en : LV[lv]?.vi);
const lvDesc = lv => (getLang() === 'en' ? LV[lv]?.name_en : LV[lv]?.name);
const vnTime = (ts, opt) => new Date(ts).toLocaleString(locale(), { timeZone: 'Asia/Ho_Chi_Minh', ...(opt || { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) });
const ago = ts => { const m = Math.round((Date.now() - new Date(ts)) / 60000); return m < 1 ? tr('vừa xong', 'just now') : m < 60 ? m + tr(' phút trước', ' min ago') : m < 1440 ? Math.floor(m / 60) + tr(' giờ trước', ' h ago') : Math.floor(m / 1440) + tr(' ngày trước', ' d ago'); };
const until = ts => { const m = Math.round((new Date(ts) - Date.now()) / 60000); if (m <= 0) return tr('đang diễn ra', 'now'); return m < 60 ? tr('còn ' + m + ' phút', 'in ' + m + ' min') : m < 1440 ? tr('còn ' + Math.floor(m / 60) + ' giờ ' + (m % 60) + ' phút', 'in ' + Math.floor(m / 60) + 'h ' + (m % 60) + 'm') : tr('còn ' + Math.floor(m / 1440) + ' ngày', 'in ' + Math.floor(m / 1440) + ' days'); };
// Chữ máy chủ gửi (tiếng Việt) → tiếng Anh
const ADV_EN = { 3: 'Very high risk: TURN OFF THE BOT or CUT VOLUME sharply, no new trades until the alert clears.', 2: 'Caution: reduce volume and watch daily drawdown closely.', 1: 'News to watch, the bot runs as normal.', 0: 'Market is normal.' };
export const advice = st => (getLang() === 'en' ? ADV_EN[st?.level_num ?? 0] : st?.advice);
export const reasonText = r => {
  if (getLang() !== 'en' || !r) return r?.text;
  let m;
  if (r.kind === 'price' && (m = String(r.text).match(/([+−-])\$([\d.,]+).*?\$([\d.,]+)/))) return `Gold is moving fast: ${m[1]}$${m[2]} in 15 min, 60-min range $${m[3]}`;
  if (r.kind === 'event' && (m = String(r.text).match(/^(Sắp ra|Vừa ra) tin (.+) \(([^)]+)\) lúc (\d\d:\d\d)$/))) return `${m[1] === 'Sắp ra' ? 'Upcoming' : 'Just released'}: ${m[2]} (${m[3]}) at ${m[4]}`;
  return r.text;
};
const TAG_EN = { 'Chiến sự': 'War', 'Địa chính trị': 'Geopolitics', 'Fed / lãi suất': 'Fed / rates', 'Dữ liệu Mỹ': 'US data', 'Chính trị Mỹ': 'US politics', 'Thuế quan / trừng phạt': 'Tariffs / sanctions', 'Giá chạy mạnh': 'Big move', 'Dòng tiền trú ẩn': 'Safe-haven flows', 'USD / lợi suất': 'USD / yields' };
const tagName = g => (getLang() === 'en' ? TAG_EN[g] || g : g);
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
        <b style={{ color: L.c, whiteSpace: 'nowrap' }}>{L.icon} {tr('CẢNH BÁO ' + L.vi, L.en + ' ALERT')}</b>
        <span className="grow small" style={{ minWidth: 200 }}><b>{advice(st)}</b>{r && <> · {reasonText(r)}</>}</span>
        <a className="btn sm" href="#/news">{tr('Xem tin →', 'View news →')}</a>
      </div>
    </div>
  );
}

function PriceChart({ ticks }) {
  if (!ticks?.length) return <div className="empty">{tr('Đang thu thập giá…', 'Collecting prices…')}</div>;
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
  const [lvF, setLvF] = useState('hot'); const [lang, setLang] = useState(getLang() === 'en' ? 'en' : ''); const [evF, setEvF] = useState('hot');
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
      <div className="row"><h1 className="h-lg grow">{tr('Tin tức & cảnh báo vàng', 'Gold news & alerts')}</h1><span className="small muted">{tr('Tự cập nhật mỗi phút', 'Updates every minute')} · {st.updated_at ? vnTime(st.updated_at, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}</span></div>

      <section className="card" style={{ borderColor: L.c, background: `linear-gradient(0deg, ${L.bg}, ${L.bg}), var(--surface-100)` }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div style={{ display: 'grid', gap: 6, flex: '1 1 320px' }}>
            <span className="small muted">{tr('MỨC CẢNH BÁO HIỆN TẠI', 'CURRENT ALERT LEVEL')}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30, color: L.c }}>{L.icon} {lvName(st.level || 'green')} · {lvDesc(st.level || 'green')}</span>
            <b style={{ fontSize: 16 }}>{advice(st)}</b>
            {(st.reasons || []).length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
              {st.reasons.map((r, i) => <li key={i}><Badge lv={r.level} /> {r.link ? <a href={r.link} target="_blank" rel="noopener noreferrer">{reasonText(r)}</a> : reasonText(r)}</li>)}
            </ul>}
            {st.next_red && <span className="small">{tr('Tin đỏ tiếp theo', 'Next red event')}: <b>{st.next_red.title}</b> ({st.next_red.country}) · {vnTime(st.next_red.at)} · <b style={{ color: 'var(--loss)' }}>{until(st.next_red.at)}</b></span>}
          </div>
          <div style={{ display: 'grid', gap: 4, minWidth: 210 }}>
            <span className="small muted">{tr('GIÁ VÀNG XAU/USD', 'GOLD PRICE XAU/USD')}</span>
            <span className="num-xl">{st.price ? '$' + fmt(st.price) : '—'}</span>
            <span className="small num"><span className={Number(st.chg15) >= 0 ? 'pos' : 'neg'}>{sgn(st.chg15)}</span> <span className="muted">{tr('15 phút', '15 min')}</span> · <span className={Number(st.chg60) >= 0 ? 'pos' : 'neg'}>{sgn(st.chg60)}</span> <span className="muted">{tr('60 phút', '60 min')}</span></span>
            <span className="small muted">{tr('Biên độ', 'Range')} 15{tr('p', 'm')} ${fmt(st.range15)} · 60{tr('p', 'm')} ${fmt(st.range60)}</span>
          </div>
        </div>
      </section>

      <section className="card"><div className="title">{tr('Giá vàng 24 giờ (giờ Việt Nam)', 'Gold price, last 24 hours (Vietnam time, GMT+7)')}</div><PriceChart ticks={d.ticks} /></section>

      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,440px),1fr))', alignItems: 'start' }}>
        <section className="card">
          <div className="row"><div className="title grow">{tr('Lịch tin kinh tế (giống lịch MT5)', 'Economic calendar (as on MT5)')}</div>
            <div className="seg">{[['hot', tr('Đỏ + Cam', 'Red + Orange')], ['all', tr('Tất cả', 'All')]].map(([k, l]) => <button key={k} type="button" className={evF === k ? 'on' : ''} onClick={() => setEvF(k)}>{l}</button>)}</div></div>
          <p className="small muted" style={{ margin: 0 }}>{tr('Giờ Việt Nam. 🔴 tin mạnh của Mỹ (USD), 🟠 tin mạnh nước khác hoặc tin trung bình của Mỹ. Cảnh báo bật từ 30 phút trước đến 30 phút sau giờ ra tin.', 'Vietnam time (GMT+7). 🔴 high-impact US (USD) events, 🟠 high-impact events of other countries or medium-impact US events. The alert is on from 30 minutes before to 30 minutes after the release.')}</p>
          {Object.keys(byDay).length ? Object.entries(byDay).map(([day, list]) => (
            <div key={day} style={{ display: 'grid', gap: 6 }}>
              <b className="small" style={{ textTransform: 'capitalize', color: 'var(--ink-muted)' }}>{day}</b>
              {list.map(e => { const past = new Date(e.at) < Date.now() - 30 * 60000; return (
                <div key={e.title + e.at} className="row" style={{ gap: 10, opacity: past ? 0.5 : 1, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <span className="num small" style={{ width: 44, flex: 'none' }}>{vnTime(e.at, { hour: '2-digit', minute: '2-digit' })}</span>
                  <Dot lv={e.level} />
                  <span className="grow" style={{ minWidth: 0 }}><b>{e.country}</b> · {e.title}
                    {(e.forecast || e.previous) && <span className="small muted"> · {tr('Dự báo', 'Forecast')} {e.forecast || '—'} · {tr('Trước', 'Previous')} {e.previous || '—'}</span>}</span>
                  {!past && e.level === 'red' && <span className="small" style={{ color: 'var(--loss)', whiteSpace: 'nowrap' }}>{until(e.at)}</span>}
                </div>); })}
            </div>)) : <div className="empty">{tr('Chưa có lịch tin', 'No events yet')}</div>}
        </section>

        <section className="card">
          <div className="row"><div className="title grow">{tr('Tin tức ảnh hưởng giá vàng', 'News moving gold')}</div>
            <div className="seg">{[['hot', tr('Đáng chú ý', 'Notable')], ['red', '🔴 ' + cnt('red')], ['orange', '🟠 ' + cnt('orange')], ['all', tr('Tất cả', 'All')]].map(([k, l]) => <button key={k} type="button" className={lvF === k ? 'on' : ''} onClick={() => setLvF(k)}>{l}</button>)}</div>
            <select id="news-lang" className="btn sm" value={lang} onChange={e => setLang(e.target.value)}><option value="">EN + VI</option><option value="en">English</option><option value="vi">{tr('Tiếng Việt', 'Vietnamese')}</option></select></div>
          <p className="small muted" style={{ margin: 0 }}>{tr('Điểm 0–100 chấm theo mức ảnh hưởng tới giá vàng: chiến sự, Fed / lãi suất, dữ liệu Mỹ, bầu cử, thuế quan, giá chạy mạnh…', 'Score 0–100 by expected impact on gold: war, Fed / rates, US data, elections, tariffs, big price moves…')} <b style={{ color: LV.red.c }}>≥70 {lvName('red')}</b> · <b style={{ color: LV.orange.c }}>45–69 {lvName('orange')}</b> · <b style={{ color: LV.yellow.c }}>25–44 {lvName('yellow')}</b>.</p>
          <div style={{ display: 'grid', gap: 2, maxHeight: '75vh', overflowY: 'auto' }}>
            {news.map(n => (
              <a key={n.id} href={n.link} target="_blank" rel="noopener noreferrer" className="row" style={{ gap: 12, padding: '10px 4px', borderBottom: '1px solid var(--line)', color: 'var(--ink)', textDecoration: 'none', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <span className="num" style={{ flex: 'none', width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', fontWeight: 700, background: LV[n.level].bg, color: LV[n.level].c }}>{n.score}</span>
                <span style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, lineHeight: 1.35 }}>{n.title}</span>
                  <span className="small muted">{n.source || ''} · {ago(n.published)} · {n.lang === 'vi' ? 'VI' : 'EN'}{n.tags?.length ? ' · ' : ''}{(n.tags || []).map(tagName).join(' · ')}</span>
                </span>
              </a>))}
            {!news.length && <div className="empty">{tr('Chưa có tin phù hợp', 'No matching news')}</div>}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="title">{tr('Gợi ý xử lý bot theo mức cảnh báo', 'What to do with the bot at each alert level')}</div>
        <div className="tbl"><table><tbody>
          <tr><td><Badge lv="red" /></td><td>{tr(<><b>Tắt bot hoặc giảm vol mạnh</b>, không mở lệnh mới. Đóng bớt lệnh đang âm sâu nếu DD ngày đã cao. Bật lại khi về Cam / Vàng.</>, <><b>Turn off the bot or cut volume sharply</b>, no new trades. Close some deep losing positions if daily drawdown is already high. Turn it back on at Orange / Yellow.</>)}</td></tr>
          <tr><td><Badge lv="orange" /></td><td>{tr(<><b>Giảm vol</b> (ví dụ còn 50%), theo dõi DD trong ngày, tránh nhồi lệnh.</>, <><b>Reduce volume</b> (e.g. to 50%), watch daily drawdown, avoid adding positions.</>)}</td></tr>
          <tr><td><Badge lv="yellow" /></td><td>{tr('Có tin cần chú ý, bot chạy bình thường.', 'News to watch, the bot runs as normal.')}</td></tr>
          <tr><td><Badge lv="green" /></td><td>{tr('Thị trường bình thường.', 'Market is normal.')}</td></tr>
        </tbody></table></div>
        <p className="small muted" style={{ margin: 0 }}>{tr('Cảnh báo ĐỎ bật khi: giá vàng chạy ≥ 0,35% trong 15 phút (khoảng $14 ở giá $4.000) hoặc ≥ 0,7% trong 60 phút; hoặc trong ±30 phút quanh tin đỏ của Mỹ; hoặc có tin ≥ 70 điểm trong 90 phút qua. Đây là công cụ hỗ trợ, không phải khuyến nghị đầu tư.', 'RED is on when: gold moves ≥ 0.35% in 15 minutes (about $14 at $4,000) or ≥ 0.7% in 60 minutes; or within ±30 minutes of a red US event; or a news item scored ≥ 70 in the last 90 minutes. This is a support tool, not investment advice.')}</p>
      </section>
    </main>
  );
}
