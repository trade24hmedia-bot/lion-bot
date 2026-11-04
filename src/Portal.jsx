import { useEffect, useState } from 'react';
import { rpc, t, usd, signedUsd, signed, fmt, cls, vnDate, monthLabel, minsAgo } from './lib.js';
import { LineArea } from './Charts.jsx';

function useRpc(name, args, deps) {
  const [data, setData] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { let on = true; setErr(''); rpc(name, args).then(d => on && setData(d)).catch(e => on && setErr(e.message)); return () => { on = false; }; }, deps); // eslint-disable-line
  return [data, err];
}

const pctTxt = v => (v == null ? '—' : (v > 0 ? '+' : '') + fmt(v) + '%');

function AccTable({ rows, showCustomer }) {
  return (
    <div className="tbl"><table>
      <thead><tr><th>{t('accounts')}</th>{showCustomer && <th>{t('customer')}</th>}<th className="r">{t('capitalCol')}</th><th className="r">{t('profitMonth')}</th><th className="r">%</th><th className="r">{t('profitAll')}</th></tr></thead>
      <tbody>{rows.map(a => (
        <tr key={a.id} className="click" onClick={() => { location.hash = '/app/a/' + a.id; }}>
          <td><span className="num">{a.account_mask}</span><div className="small muted">{a.broker || ''} · {a.currency}{a.status === 'stopped' ? ' · ⏸' : ''}</div></td>
          {showCustomer && <td>{a.customer_name}<div className="small muted">{a.system_name || ''}</div></td>}
          <td className="r num">{usd(a.capital_usd)}<div className="small muted">{fmt(a.capital)} {a.currency}</div></td>
          <td className={'r num ' + cls(a.profit_month_usd)}>{signedUsd(a.profit_month_usd)}</td>
          <td className={'r num ' + cls(a.growth_month_pct)}>{pctTxt(a.growth_month_pct)}</td>
          <td className={'r num ' + cls(a.profit_total_usd)}>{signedUsd(a.profit_total_usd)}</td>
        </tr>))}
      </tbody></table></div>
  );
}

export function Overview({ me }) {
  const [accs, err] = useRpc('portal_accounts', {}, []);
  const [series] = useRpc('portal_series', { p_scope: 'mine' }, []);
  if (err) return <main className="wrap"><div className="card neg">{err}</div></main>;
  if (!accs) return <main className="wrap"><div className="empty">{t('loading')}</div></main>;
  const mine = accs.filter(a => a.is_mine);
  if (!mine.length) return (
    <main className="wrap"><div className="card empty"><b>{t('noAccount')}</b><span>{t('noAccountHint')}</span><span className="small">{me?.email}</span></div></main>
  );
  const sum = k => mine.reduce((s, a) => s + (Number(a[k]) || 0), 0);
  const cap = sum('capital_usd'), pm = sum('profit_month_usd');
  const start = cap - pm;
  return (
    <main className="wrap">
      <h1 className="h-lg">{me?.customer?.name || me?.email}</h1>
      <section className="kpis">
        <div className="kpi"><span className="label">{t('myCapital')}</span><span className="num-xl">{usd(cap)}</span><span className="sub">{mine.length} {t('accounts').toLowerCase()}</span></div>
        <div className="kpi"><span className="label">{t('profitMonth')}</span><span className={'num-xl ' + cls(pm)}>{signedUsd(pm)}</span></div>
        <div className="kpi"><span className="label">{t('profitAll')}</span><span className={'num-xl ' + cls(sum('profit_total_usd'))}>{signedUsd(sum('profit_total_usd'))}</span></div>
        <div className="kpi"><span className="label">{t('growth')}</span><span className={'num-xl ' + cls(pm)}>{start > 0 ? pctTxt(Math.round(pm / start * 10000) / 100) : '—'}</span></div>
      </section>
      <section className="card"><div className="title">{t('cumProfit')}</div>
        {series?.length ? <LineArea data={series} x="date" y="cum_profit_usd" prefix="$" /> : <div className="empty">{t('none')}</div>}
      </section>
      <section className="card"><div className="row"><div className="title grow">{t('myAccounts')}</div></div><AccTable rows={mine} /></section>
      <p className="disclaimer">{t('disclaimer')}</p>
    </main>
  );
}

export function Accounts({ me }) {
  const [accs, err] = useRpc('portal_accounts', {}, []);
  const [q, setQ] = useState('');
  if (err) return <main className="wrap"><div className="card neg">{err}</div></main>;
  if (!accs) return <main className="wrap"><div className="empty">{t('loading')}</div></main>;
  const f = s => !q || (s.account_mask + ' ' + s.customer_name + ' ' + (s.broker || '') + ' ' + (s.system_name || '')).toLowerCase().includes(q.toLowerCase());
  const mine = accs.filter(a => a.is_mine && f(a)), down = accs.filter(a => !a.is_mine && f(a));
  return (
    <main className="wrap">
      <div className="row"><h1 className="h-lg grow">{t('accounts')}</h1><label className="field" style={{ width: 'min(280px,100%)' }}><input id="acc-search" type="search" placeholder={t('search')} value={q} onChange={e => setQ(e.target.value)} /></label></div>
      {mine.length > 0 && <section className="card"><div className="title">{t('myAccounts')}</div><AccTable rows={mine} /></section>}
      {down.length > 0 && <section className="card"><div className="title">{t('downline')} ({down.length})</div><AccTable rows={down} showCustomer /></section>}
      {!mine.length && !down.length && <div className="card empty"><b>{t('noAccount')}</b></div>}
    </main>
  );
}

export function AccountDetail({ id }) {
  const [accs] = useRpc('portal_accounts', {}, [id]);
  const [series] = useRpc('portal_series', { p_account: id }, [id]);
  const [months] = useRpc('portal_months', { p_account: id }, [id]);
  const [trs] = useRpc('portal_transfers', { p_account: id }, [id]);
  const a = accs?.find(x => x.id === id);
  if (accs && !a) return <main className="wrap"><div className="card empty"><b>404</b></div></main>;
  const bal = (series || []).filter(r => r.balance != null);
  const ago = minsAgo(a?.last_seen);
  return (
    <main className="wrap">
      <a href="#/app/accounts" className="small">{t('back')}</a>
      <div className="row"><h1 className="h-lg grow num">{a?.account_mask || '…'}</h1>{a && <span className="pill mut">{a.broker} · {a.currency}</span>}{a && !a.is_mine && <span className="pill brand">{a.customer_name}</span>}</div>
      {a && <section className="kpis">
        <div className="kpi"><span className="label">{t('myCapital')}</span><span className="num-xl">{usd(a.capital_usd)}</span><span className="sub">{fmt(a.capital)} {a.currency}</span></div>
        <div className="kpi"><span className="label">{t('profitMonth')}</span><span className={'num-xl ' + cls(a.profit_month_usd)}>{signedUsd(a.profit_month_usd)}</span><span className="sub">{signed(a.profit_month)} {a.currency}</span></div>
        <div className="kpi"><span className="label">{t('growth')}</span><span className={'num-xl ' + cls(a.growth_month_pct)}>{pctTxt(a.growth_month_pct)}</span></div>
        <div className="kpi"><span className="label">{t('profitAll')}</span><span className={'num-xl ' + cls(a.profit_total_usd)}>{signedUsd(a.profit_total_usd)}</span>{ago != null && <span className="sub">{t('updated')} {ago < 60 ? ago + ' ' + t('minutesAgo') : vnDate(a.last_seen)}</span>}</div>
      </section>}
      <section className="card"><div className="title">{t('balanceChart')} ({a?.currency || ''})</div>
        {bal.length > 1 ? <LineArea data={bal} x="date" y="balance" /> : <div className="empty">{t('none')}</div>}
      </section>
      <div className="grid2">
        <section className="card"><div className="title">{t('months')}</div>
          {months?.length ? <div className="tbl"><table><thead><tr><th>{t('month')}</th><th className="r">{t('startBal')}</th><th className="r">{t('profit')}</th><th className="r">USD</th><th className="r">%</th></tr></thead><tbody>
            {months.map(m => <tr key={m.month}><td className="num">{monthLabel(m.month.slice(0, 7))}</td><td className="r num">{fmt(m.start_balance)}</td><td className={'r num ' + cls(m.net)}>{signed(m.net)}</td><td className={'r num ' + cls(m.net_usd)}>{signedUsd(m.net_usd)}</td><td className={'r num ' + cls(m.pct)}>{pctTxt(m.pct)}</td></tr>)}
          </tbody></table></div> : <div className="empty">{t('none')}</div>}
        </section>
        <section className="card"><div className="title">{t('transfers')}</div>
          {trs?.length ? <div className="tbl"><table><tbody>
            {trs.map((r, i) => <tr key={i}><td className="num">{vnDate(r.date)}</td><td><span className={'pill ' + (r.type === 'deposit' ? 'ok' : 'bad')}>{r.type === 'deposit' ? t('deposit') : t('withdraw')}</span></td><td className="r num">{fmt(r.amount)} {a?.currency}<div className="small muted">{usd(r.amount_usd)}</div></td></tr>)}
          </tbody></table></div> : <div className="empty">{t('none')}</div>}
        </section>
      </div>
      <p className="disclaimer">{t('disclaimer')}</p>
    </main>
  );
}

export function Tree() {
  const [nodes, err] = useRpc('portal_tree', {}, []);
  const [accs] = useRpc('portal_accounts', {}, []);
  const [open, setOpen] = useState(null);
  if (err) return <main className="wrap"><div className="card neg">{err}</div></main>;
  if (!nodes) return <main className="wrap"><div className="empty">{t('loading')}</div></main>;
  const kids = pid => nodes.filter(n => (n.parent_id || null) === (pid || null));
  const walk = pid => { const k = kids(pid); if (!k.length) return null; return <ul>{k.map(n => (
    <li key={n.id}>
      <div className="node" role="button" tabIndex={0} onClick={() => setOpen(open === n.id ? null : n.id)} onKeyDown={e => e.key === 'Enter' && setOpen(open === n.id ? null : n.id)} style={{ cursor: 'pointer' }}>
        <span className="n">{n.name}{n.leader_name && <span className="small muted"> · {t('leader')} {n.leader_name}</span>}</span>
        <span className="s"><span>{t('allAcc')} <b>{n.accounts}</b></span><span>{t('capitalCol')} <b>{usd(n.capital_usd)}</b></span><span>{t('profitMonth')} <b className={cls(n.profit_month_usd)}>{signedUsd(n.profit_month_usd)}</b></span></span>
      </div>
      {open === n.id && accs && <div className="card" style={{ marginTop: 8 }}><AccTable rows={accs.filter(a => a.system_id === n.id)} showCustomer /></div>}
      {walk(n.id)}
    </li>))}</ul>; };
  const roots = nodes.filter(n => !n.parent_id);
  const tot = roots.reduce((s, n) => ({ a: s.a + n.accounts, c: s.c + Number(n.capital_usd), p: s.p + Number(n.profit_month_usd) }), { a: 0, c: 0, p: 0 });
  return (
    <main className="wrap">
      <h1 className="h-lg">{t('treeTitle')}</h1>
      <section className="kpis">
        <div className="kpi"><span className="label">{t('allAcc')}</span><span className="num-xl">{tot.a}</span></div>
        <div className="kpi"><span className="label">{t('capital')}</span><span className="num-xl">{usd(tot.c)}</span></div>
        <div className="kpi"><span className="label">{t('profitMonth')}</span><span className={'num-xl ' + cls(tot.p)}>{signedUsd(tot.p)}</span></div>
      </section>
      <section className="card tree">{nodes.length ? walk(null) : <div className="empty">{t('none')}</div>}</section>
    </main>
  );
}
