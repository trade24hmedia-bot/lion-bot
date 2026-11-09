import { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { rpc, fmt, usd, signedUsd, cls, vnDate, t } from './lib.js';
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
          <Tooltip contentStyle={{ background: 'var(--surface-200)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)' }} labelFormatter={vnDate} formatter={v => [pct(v), 'Tăng trưởng']} />
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
  if (!d.ok) return <main className="wrap"><div className="card empty"><b>Link không tồn tại hoặc đã tắt</b><span>Vui lòng liên hệ người gửi link để lấy link mới.</span><a className="btn pri" href="#/">Về trang chủ</a></div></main>;
  const b = d.branch, a = d.account, k = d.kpi || {};
  const href = contactHref(b.contact);
  const contact = b.contact && (href ? <a className="btn pri" href={href} target="_blank" rel="noopener noreferrer">Liên hệ {b.leader || 'trưởng nhánh'} để copy theo</a> : <span className="pill brand">Liên hệ: {b.contact}</span>);
  return (
    <main className="wrap">
      <section className="hero" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'center' }}>
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <span className="small muted" style={{ letterSpacing: '.08em' }}>HỆ THỐNG LION BOT · NHÁNH</span>
          <h1 className="h-display" style={{ margin: 0 }}>{b.name}</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 640 }}>{b.intro || <>Kết quả thật của <b>tài khoản master</b>{b.leader ? <> do <b>{b.leader}</b> quản lý</> : ''}, cập nhật tự động mỗi ngày từ MT5. Khách hàng có thể xem để copy theo.</>}</p>
          {contact && <div className="row">{contact}</div>}
        </div>
        <img className="hero-logo" src="/logo-256.png" alt="Lion Trading Bot" width="180" height="180" />
      </section>

      {!a ? <div className="card empty"><b>Nhánh chưa chọn tài khoản master</b><span>Vui lòng quay lại sau.</span></div> : <>
        <section className="card">
          <div className="row" style={{ gap: 12 }}>
            <div className="grow" style={{ display: 'grid', gap: 4 }}>
              <span className="small muted">TÀI KHOẢN MASTER</span>
              <span className="row" style={{ gap: 8 }}><b className="num" style={{ fontSize: 20 }}>{a.mask}</b>
                {a.running ? <span className="pill ok">● Bot đang chạy</span> : a.status === 'stopped' ? <span className="pill mut">Đã dừng</span> : <span className="pill mut">Chưa có dữ liệu mới</span>}</span>
              <span className="small muted">{[a.broker, a.platform, a.currency === 'USC' ? 'tài khoản cent (USC)' : 'USD', a.bot, a.start && 'chạy từ ' + vnDate(a.start)].filter(Boolean).join(' · ')}</span>
            </div>
            {a.positions != null && <div style={{ display: 'grid', gap: 2, textAlign: 'right' }}>
              <span className="small muted">ĐANG MỞ</span>
              <span className={'num ' + cls(a.floating_usd)} style={{ fontSize: 18, fontWeight: 700 }}>{signedUsd(a.floating_usd)}</span>
              <span className="small muted">{a.positions} lệnh{a.last_seen ? ' · ' + new Date(a.last_seen).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : ''}</span>
            </div>}
          </div>
        </section>

        <div className="row"><h2 className="title grow" style={{ margin: 0 }}>Hiệu quả · {range.label}</h2>{picker}</div>
        <section className="kpis">
          <div className="kpi"><span className="label">Tăng trưởng trong kỳ</span><span className={'num-xl ' + cls(k.growth_pct)}>{pct(k.growth_pct)}</span><span className="sub">{k.days || 0} ngày giao dịch</span></div>
          <div className="kpi"><span className="label">Lãi/lỗ trong kỳ</span><span className={'num-xl ' + cls(k.profit_usd)}>{signedUsd(k.profit_usd)}</span><span className="sub">Thắng {k.win_days || 0} · thua {k.loss_days || 0} ngày</span></div>
          <div className="kpi"><span className="label">Tăng trưởng từ đầu</span><span className={'num-xl ' + cls(k.growth_all_pct)}>{pct(k.growth_all_pct)}</span><span className="sub">{k.first_date ? 'từ ' + vnDate(k.first_date) : ''} · lãi {signedUsd(k.profit_all_usd)}</span></div>
          <div className="kpi"><span className="label">Sụt giảm lớn nhất</span><span className={'num-xl ' + (Number(k.max_dd_pct) > 0 ? 'neg' : '')}>{k.max_dd_pct == null ? '—' : Number(k.max_dd_pct) > 0 ? '−' + fmt(k.max_dd_pct) + '%' : '0%'}</span><span className="sub">DD trong ngày cao nhất {k.dd_day_max_all != null ? fmt(k.dd_day_max_all) + '%' : '—'}</span></div>
        </section>

        <section className="card"><div className="title">Tăng trưởng lũy kế (%)</div><GrowthChart data={d.series} />
          <p className="small muted" style={{ margin: 0 }}>Tính theo tỷ suất từng ngày trên vốn đầu ngày rồi cộng dồn (kiểu quỹ), nên nạp/rút tiền không làm sai lệch %. Vốn hiện tại {usd(a.capital_usd)}.</p></section>

        <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', alignItems: 'start' }}>
          <section className="card"><div className="title">Tăng trưởng theo tháng</div>
            {d.months?.length ? <MonthBars data={d.months} /> : <div className="empty">{t('none')}</div>}
            {d.months?.length > 0 && <div className="tbl"><table><thead><tr><th>Tháng</th><th className="r">%</th><th className="r">Lãi/lỗ</th><th className="r">Ngày</th></tr></thead><tbody>
              {[...d.months].reverse().map(m => <tr key={m.month}><td>{m.month.slice(5)}/{m.month.slice(0, 4)}</td><td className={'r num ' + cls(m.pct)}>{pct(m.pct)}</td><td className={'r num ' + cls(m.net_usd)}>{signedUsd(m.net_usd)}</td><td className="r num">{m.days}</td></tr>)}
            </tbody></table></div>}
          </section>
          <section className="card"><div className="title">Kết quả từng ngày · {range.label}</div>
            {d.days?.length ? <div className="tbl" style={{ maxHeight: 460, overflowY: 'auto' }}><table><thead><tr><th>Ngày</th><th className="r">%</th><th className="r">Lãi/lỗ</th><th className="r">DD ngày</th></tr></thead><tbody>
              {d.days.map(x => <tr key={x.date}><td>{vnDate(x.date)}</td><td className={'r num ' + cls(x.ret)}>{pct(x.ret)}</td><td className={'r num ' + cls(x.net_usd)}>{signedUsd(x.net_usd)}</td><td className="r num">{x.dd != null ? fmt(x.dd) + '%' : '—'}</td></tr>)}
            </tbody></table></div> : <div className="empty">Chưa có kết quả trong kỳ này</div>}
          </section>
        </div>
      </>}

      <section className="card row" style={{ gap: 12 }}>
        <span className="grow small muted">Muốn xem tài khoản của chính bạn? Đăng nhập bằng email đã đăng ký với Lion Bot.</span>
        {contact}<a className="btn" href="#/login">Đăng nhập</a><a className="btn" href="#/news">Tin tức vàng</a>
      </section>
      <p className="disclaimer">{t('disclaimer')}</p>
    </main>
  );
}
