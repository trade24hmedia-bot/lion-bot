import { useEffect, useState } from 'react';
import { rpc, t, usd, signedUsd, fmt, cls, monthLabel, vnDate } from './lib.js';
import { LineArea, MonthBars } from './Charts.jsx';

export default function Public() {
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { rpc('public_summary').then(setD).catch(e => setErr(e.message)); }, []);
  const months = d?.months || [];
  const cur = months[months.length - 1];
  return (
    <main className="wrap">
      <section className="hero">
        <h1 className="h-display">{t('heroTitle')}</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 640 }}>{t('heroSub')}</p>
      </section>
      {err && <div className="card neg">{err}</div>}
      <section className="kpis">
        <div className="kpi"><span className="label">{t('capital')}</span><span className="num-xl">{d ? usd(d.capital_usd) : '—'}</span></div>
        <div className="kpi"><span className="label">{t('profitTotal')}</span><span className={'num-xl ' + cls(d?.profit_total_usd)}>{d ? signedUsd(d.profit_total_usd) : '—'}</span></div>
        <div className="kpi"><span className="label">{t('accountsCount')}</span><span className="num-xl">{d ? d.accounts : '—'}</span></div>
        <div className="kpi"><span className="label">{t('growthMonth')}</span><span className={'num-xl ' + cls(cur?.pct)}>{cur?.pct != null ? (cur.pct > 0 ? '+' : '') + fmt(cur.pct) + '%' : '—'}</span>{cur && <span className="sub">{monthLabel(cur.month)}</span>}</div>
      </section>
      <div className="grid2">
        <section className="card"><div className="title">{t('cumProfit')}</div>
          {d?.series?.length ? <LineArea data={d.series} x="date" y="cum" prefix="$" /> : <div className="empty">{d ? t('none') : t('loading')}</div>}
        </section>
        <section className="card"><div className="title">{t('monthly')}</div>
          {months.length ? <><MonthBars data={months} />
            <div className="tbl"><table><thead><tr><th>{t('month')}</th><th className="r">{t('profit')}</th><th className="r">%</th></tr></thead><tbody>
              {[...months].reverse().map(m => <tr key={m.month}><td className="num">{monthLabel(m.month)}</td><td className={'r num ' + cls(m.net_usd)}>{signedUsd(m.net_usd)}</td><td className={'r num ' + cls(m.pct)}>{m.pct != null ? (m.pct > 0 ? '+' : '') + fmt(m.pct) + '%' : '—'}</td></tr>)}
            </tbody></table></div></> : <div className="empty">{d ? t('none') : t('loading')}</div>}
        </section>
      </div>
      <p className="disclaimer">{t('disclaimer')}{d?.updated_at ? ' · ' + t('updated') + ' ' + vnDate(d.updated_at) : ''}</p>
    </main>
  );
}
