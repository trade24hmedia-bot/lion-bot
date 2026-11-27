import { useEffect, useState } from 'react';
import { LogIn } from 'lucide-react';
import { rpc, t, tr, usd, signedUsd, fmt, cls, monthLabel, vnDate } from './lib.js';
import { LineArea, MonthBars } from './Charts.jsx';
import { Stamp, stampTime } from './ui.jsx';

// Trang chủ (chưa đăng nhập): tiêu đề + biểu đồ lãi lũy kế là điểm nhấn, 3 ô số bên dưới
export default function Public({ session }) {
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { rpc('public_summary').then(setD).catch(e => setErr(e.message)); }, []);
  const months = d?.months || [];
  const cur = months[months.length - 1];
  const series = d?.series || [];
  const pct = v => (v == null ? '—' : (v > 0 ? '+' : '') + fmt(v) + '%');
  return (
    <main className="wrap">
      <section className="split" style={{ paddingBlock: 'var(--space-6) var(--space-4)' }}>
        <div style={{ display: 'grid', gap: 20, alignContent: 'center' }}>
          {d?.updated_at && <Stamp>{tr('Chốt số liệu', 'Data as of')} {stampTime(d.updated_at)}</Stamp>}
          <h1 className="h-display">{t('heroTitle')}</h1>
          <p className="sec" style={{ margin: 0, fontSize: 17, lineHeight: '28px', maxWidth: '32rem' }}>{t('heroSub')}</p>
          <div className="row" style={{ marginTop: 4 }}>
            {session ? <a className="btn pri lg" href="#/app">{t('overview')}</a>
              : <a className="btn pri lg" href="#/login"><LogIn size={16} strokeWidth={1.5} />{t('login')}</a>}
            <a className="btn lg" href="#/news">{tr('Tin thị trường vàng', 'Gold market news')}</a>
          </div>
        </div>
        <div className="card" style={{ padding: 28, gap: 8 }}>
          <div className="row" style={{ alignItems: 'baseline' }}>
            <span className="label grow">{t('cumProfit')}</span>
            {series.length > 1 && <span className="small muted num">{vnDate(series[0].date).slice(0, 5)} – {vnDate(series[series.length - 1].date).slice(0, 5)}</span>}
          </div>
          <span className={'num ' + cls(d?.profit_total_usd)} style={{ fontSize: 'clamp(28px,3.4vw,40px)', lineHeight: 1.2 }}>{d ? signedUsd(d.profit_total_usd) : '—'}</span>
          {series.length ? <LineArea data={series} x="date" y="cum" prefix="$" signed height={260} /> : <div className="empty">{d ? t('none') : t('loading')}</div>}
        </div>
      </section>
      {err && <div className="card neg">{err}</div>}
      <section className="kpis">
        <div className="kpi"><span className="label">{t('capital')}</span><span className="num-xl">{d ? usd(d.capital_usd) : '—'}</span><span className="sub">{tr('Tổng vốn các tài khoản đang chạy bot', 'Total capital of accounts running the bot')}</span></div>
        <div className="kpi"><span className="label">{t('growthMonth')}</span><span className={'num-xl ' + cls(cur?.pct)}>{cur?.pct != null ? pct(cur.pct) : '—'}</span>
          <span className="sub">{cur ? (cur.net_usd != null ? signedUsd(cur.net_usd) + ' · ' : '') + tr('tháng ', 'month ') + monthLabel(cur.month) : tr('Chưa đủ dữ liệu', 'Not enough data yet')}</span></div>
        <div className="kpi"><span className="label">{t('accountsCount')}</span><span className="num-xl">{d ? d.accounts : '—'}</span><span className="sub">{tr('Đang chạy Lion Bot', 'Running Lion Bot')}</span></div>
      </section>
      {months.length > 0 && <section className="card">
        <div className="title">{t('monthly')}</div>
        <MonthBars data={months} />
        <div className="tbl"><table><thead><tr><th>{t('month')}</th><th className="r">{t('profit')}</th><th className="r">%</th></tr></thead><tbody>
          {[...months].reverse().map(m => <tr key={m.month}><td className="num">{monthLabel(m.month)}</td><td className={'r num ' + cls(m.net_usd)}>{signedUsd(m.net_usd)}</td><td className={'r num ' + cls(m.pct)}>{pct(m.pct)}</td></tr>)}
        </tbody></table></div>
      </section>}
      <p className="disclaimer">{t('disclaimer')}</p>
    </main>
  );
}
