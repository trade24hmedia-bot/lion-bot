import { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { rpc, fmt, usd, signedUsd, cls, vnDate, t, tr, locale } from './lib.js';
import { usePeriod } from './ui.jsx';
import { MonthBars } from './Charts.jsx';

// Trang chia sẻ của 1 nhánh: https://lion-bot.pages.dev/#/b/<mã>  — không cần đăng nhập.
// Hiện hiệu quả TÀI KHOẢN MASTER của nhánh. Số tài khoản che 4 số đầu.

const pct = v => (v == null ? '—' : (Number(v) > 0 ? '+' : Number(v) < 0 ? '−' : '') + fmt(Math.abs(v)) + '%');
const contactHref = c => {
  if (!c) return null; const s = c.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^@?[a-z0-9_]{4,}$/i.test(s) && !/^\d+$/.test(s)) return 'https://t.me/' + s.replace(/^@/, '');
  const d = s.replace(/[^\d]/g, ''); if (d.length >= 9) return 'https://zalo.me/' + (d.startsWith('84') ? '0' + d.slice(2) : d);
  return null;
};

function GrowthChart({ data }) {
  if (!data?.length) return <div className="empty">{t('none')}</div>;
  const rows = [{ date: data[0].date, growth: 0, start: true }, ...data];
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs><linearGradient id="lbG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--brand)" stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeOpacity={0.6} />
          <XAxis dataKey="date" stroke="var(--line)" tick={{ fill: 'var(--ink-muted)', fontSize: 12 }} tickLine={false} minTickGap={28} tickFormatter={v => vnDate(v).slice(0, 5)} />
          <YAxis stroke="var(--line)" tick={{ fill: 'var(--ink-muted)', fontSize: 12 }} tickLine={false} width={56} tickFormatter={v => fmt(v, 0) + '%'} />
          <ReferenceLine y={0} stroke="var(--line-strong)" />
          <Tooltip contentStyle={{ background: 'var(--surface-200)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)' }} labelFormatter={vnDate} formatter={v => [pct(v), tr('Tăng trưởng', 'Growth')]} />
          <Area type="monotone" dataKey="growth" stroke="var(--brand)" strokeWidth={2} fill="url(#lbG)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Branch({ token }) {
  const [range, picker] = usePeriod();
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => {
    let on = true;
    rpc('public_branch', { p_token: token, p_from: range.from, p_to: range.to }).then(x => on && setD(x)).catch(e => on && setErr(e.message));
    return () => { on = false; };
  }, [token, range.from, range.to]);
  if (err) return <main className="wrap"><div className="card neg">{err}</div></main>;
  if (!d) return <main className="wrap"><div className="empty">{t('loading')}</div></main>;
  if (!d.ok) return <main className="wrap"><div className="card empty"><b>{tr('Link không tồn tại hoặc đã tắt', 'This link does not exist or has been turned off')}</b><span>{tr('Vui lòng liên hệ người gửi link để lấy link mới.', 'Please ask the person who sent it for a new link.')}</span><a className="btn pri" href="#/">{tr('Về trang chủ', 'Go to home page')}</a></div></main>;
  const b = d.branch, a = d.account, k = d.kpi || {};
  const href = contactHref(b.contact);
  const contact = b.contact && (href ? <a className="btn pri" href={href} target="_blank" rel="noopener noreferrer">{tr('Liên hệ ' + (b.leader || 'trưởng nhánh') + ' để copy theo', 'Contact ' + (b.leader || 'the branch leader') + ' to copy this account')}</a> : <span className="pill brand">{tr('Liên hệ', 'Contact')}: {b.contact}</span>);
  return (
    <main className="wrap">
      <section className="hero" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'center' }}>
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <span className="small muted" style={{ letterSpacing: '.08em' }}>{tr('HỆ THỐNG LION BOT · NHÁNH', 'LION BOT NETWORK · BRANCH')}</span>
          <h1 className="h-display" style={{ margin: 0 }}>{b.name}</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 640 }}>{b.intro || tr(<>Kết quả thật của <b>tài khoản master</b>{b.leader ? <> do <b>{b.leader}</b> quản lý</> : ''}, cập nhật tự động mỗi ngày từ MT5. Khách hàng có thể xem để copy theo.</>, <>Real results of the <b>master account</b>{b.leader ? <> managed by <b>{b.leader}</b></> : ''}, updated automatically every day from MT5. Customers can follow it to copy.</>)}</p>
          {contact && <div className="row">{contact}</div>}
        </div>
        <img className="hero-logo" src="/logo-256.png" alt="Lion Trading Bot" width="180" height="180" />
      </section>

      {!a ? <div className="card empty"><b>{tr('Nhánh chưa chọn tài khoản master', 'This branch has no master account yet')}</b><span>{tr('Vui lòng quay lại sau.', 'Please check back later.')}</span></div> : <>
        <section className="card">
          <div className="row" style={{ gap: 12 }}>
            <div className="grow" style={{ display: 'grid', gap: 4 }}>
              <span className="small muted">{tr('TÀI KHOẢN MASTER', 'MASTER ACCOUNT')}</span>
              <span className="row" style={{ gap: 8 }}><b className="num" style={{ fontSize: 20 }}>{a.mask}</b>
                {a.running ? <span className="pill ok">● {tr('Bot đang chạy', 'Bot running')}</span> : a.status === 'stopped' ? <span className="pill mut">{tr('Đã dừng', 'Stopped')}</span> : <span className="pill mut">{tr('Chưa có dữ liệu mới', 'No recent data')}</span>}</span>
              <span className="small muted">{[a.broker, a.platform, a.currency === 'USC' ? tr('tài khoản cent (USC)', 'cent account (USC)') : 'USD', a.bot, a.start && tr('chạy từ ', 'running since ') + vnDate(a.start)].filter(Boolean).join(' · ')}</span>
            </div>
            {a.positions != null && <div style={{ display: 'grid', gap: 2, textAlign: 'right' }}>
              <span className="small muted">{tr('ĐANG MỞ', 'OPEN P/L')}</span>
              <span className={'num ' + cls(a.floating_usd)} style={{ fontSize: 18, fontWeight: 700 }}>{signedUsd(a.floating_usd)}</span>
              <span className="small muted">{a.positions} {tr('lệnh', 'positions')}{a.last_seen ? ' · ' + new Date(a.last_seen).toLocaleString(locale(), { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : ''}</span>
            </div>}
          </div>
        </section>

        <div className="row"><h2 className="title grow" style={{ margin: 0 }}>{tr('Hiệu quả', 'Performance')} · {range.label}</h2>{picker}</div>
        <section className="kpis">
          <div className="kpi"><span className="label">{t('growthPeriod')}</span><span className={'num-xl ' + cls(k.growth_pct)}>{pct(k.growth_pct)}</span><span className="sub">{k.days || 0} {tr('ngày giao dịch', 'trading days')}</span></div>
          <div className="kpi"><span className="label">{t('profitPeriod')}</span><span className={'num-xl ' + cls(k.profit_usd)}>{signedUsd(k.profit_usd)}</span><span className="sub">{tr(`Thắng ${k.win_days || 0} · thua ${k.loss_days || 0} ngày`, `${k.win_days || 0} winning · ${k.loss_days || 0} losing days`)}</span></div>
          <div className="kpi"><span className="label">{tr('Tăng trưởng từ đầu', 'Growth since start')}</span><span className={'num-xl ' + cls(k.growth_all_pct)}>{pct(k.growth_all_pct)}</span><span className="sub">{k.first_date ? tr('từ ', 'since ') + vnDate(k.first_date) : ''} · {tr('lãi', 'profit')} {signedUsd(k.profit_all_usd)}</span></div>
          <div className="kpi"><span className="label">{tr('Sụt giảm lớn nhất', 'Max drawdown')}</span><span className={'num-xl ' + (Number(k.max_dd_pct) > 0 ? 'neg' : '')}>{k.max_dd_pct == null ? '—' : Number(k.max_dd_pct) > 0 ? '−' + fmt(k.max_dd_pct) + '%' : '0%'}</span><span className="sub">{tr('DD trong ngày cao nhất', 'Highest intraday DD')} {k.dd_day_max_all != null ? fmt(k.dd_day_max_all) + '%' : '—'}</span></div>
        </section>

        <section className="card"><div className="title">{tr('Tăng trưởng lũy kế (%)', 'Cumulative growth (%)')}</div><GrowthChart data={d.series} />
          <p className="small muted" style={{ margin: 0 }}>{tr('Tính theo tỷ suất từng ngày trên vốn đầu ngày rồi cộng dồn (kiểu quỹ), nên nạp/rút tiền không làm sai lệch %. Vốn hiện tại', 'Daily return on start-of-day capital, compounded (fund style), so deposits and withdrawals do not distort the %. Current capital')} {usd(a.capital_usd)}.</p></section>

        <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', alignItems: 'start' }}>
          <section className="card"><div className="title">{t('monthly')}</div>
            {d.months?.length ? <MonthBars data={d.months} /> : <div className="empty">{t('none')}</div>}
            {d.months?.length > 0 && <div className="tbl"><table><thead><tr><th>{t('month')}</th><th className="r">%</th><th className="r">{t('profit')}</th><th className="r">{tr('Ngày', 'Days')}</th></tr></thead><tbody>
              {[...d.months].reverse().map(m => <tr key={m.month}><td>{m.month.slice(5)}/{m.month.slice(0, 4)}</td><td className={'r num ' + cls(m.pct)}>{pct(m.pct)}</td><td className={'r num ' + cls(m.net_usd)}>{signedUsd(m.net_usd)}</td><td className="r num">{m.days}</td></tr>)}
            </tbody></table></div>}
          </section>
          <section className="card"><div className="title">{tr('Kết quả từng ngày', 'Daily results')} · {range.label}</div>
            {d.days?.length ? <div className="tbl" style={{ maxHeight: 460, overflowY: 'auto' }}><table><thead><tr><th>{tr('Ngày', 'Date')}</th><th className="r">%</th><th className="r">{t('profit')}</th><th className="r">{tr('DD ngày', 'Daily DD')}</th></tr></thead><tbody>
              {d.days.map(x => <tr key={x.date}><td>{vnDate(x.date)}</td><td className={'r num ' + cls(x.ret)}>{pct(x.ret)}</td><td className={'r num ' + cls(x.net_usd)}>{signedUsd(x.net_usd)}</td><td className="r num">{x.dd != null ? fmt(x.dd) + '%' : '—'}</td></tr>)}
            </tbody></table></div> : <div className="empty">{tr('Chưa có kết quả trong kỳ này', 'No results in this period')}</div>}
          </section>
        </div>
      </>}

      <section className="card row" style={{ gap: 12 }}>
        <span className="grow small muted">{tr('Muốn xem tài khoản của chính bạn? Đăng nhập bằng email đã đăng ký với Lion Bot.', 'Want to see your own account? Sign in with the email you registered with Lion Bot.')}</span>
        {contact}<a className="btn" href="#/login">{t('login')}</a><a className="btn" href="#/news">{tr('Tin tức vàng', 'Gold news')}</a>
      </section>
      <p className="disclaimer">{t('disclaimer')}</p>
    </main>
  );
}
