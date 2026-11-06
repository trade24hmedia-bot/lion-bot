import { useEffect, useState, useCallback } from 'react';
import { sb, rpc, t, getLang, setLang, VERSION, authReady, authError } from './lib.js';
import Public from './Public.jsx';
import { News, AlertBanner, useMarketStatus } from './News.jsx';
import { Overview, Accounts, AccountDetail, Tree } from './Portal.jsx';
import Admin from './Admin.jsx';

function useHash() {
  const [h, setH] = useState(() => location.hash.replace(/^#/, '') || '/');
  useEffect(() => { const f = () => setH(location.hash.replace(/^#/, '') || '/'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
}

function Login() {
  const [email, setEmail] = useState(''); const [state, setState] = useState('');
  const [err, setErr] = useState(() => (authError ? (getLang() === 'en' ? 'Sign-in link failed or expired: ' : 'Link đăng nhập lỗi hoặc đã hết hạn, vui lòng gửi lại: ') + authError : ''));
  const submit = async e => {
    e.preventDefault(); setErr(''); setState('sending');
    const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: location.origin + '/' } });
    if (error) { setErr(error.message); setState(''); } else setState('sent');
  };
  return (
    <div className="login wrap"><form className="card" onSubmit={submit}>
      <h1 className="h-lg">{t('login')}</h1>
      <p className="muted small" style={{ margin: 0 }}>{t('loginHint')}</p>
      <label className="field">{t('emailLabel')}<input id="login-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
      {err && <div className="neg small">{err}</div>}
      {state === 'sent' ? <div className="pill ok" style={{ whiteSpace: 'normal', padding: '10px 12px', borderRadius: 10 }}>{t('sent')}</div>
        : <button className="btn pri" disabled={state === 'sending'}>{state === 'sending' ? t('loading') : t('sendLink')}</button>}
    </form></div>
  );
}

export default function App() {
  const hash = useHash();
  const [session, setSession] = useState(null);
  const [me, setMe] = useState(null);
  const [ready, setReady] = useState(false);
  const [, force] = useState(0);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('lb.theme') || 'dark'; } catch { return 'dark'; } });

  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.lang = getLang(); try { localStorage.setItem('lb.theme', theme); } catch {} }, [theme]);
  useEffect(() => {
    authReady.then(() => sb.auth.getSession()).then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  const loadMe = useCallback(async () => { if (!session) { setMe(null); return; } try { setMe(await rpc('portal_me')); } catch { setMe(null); } }, [session]);
  useEffect(() => { loadMe(); }, [loadMe]);

  const mst = useMarketStatus();
  const staff = me && ['admin', 'tech', 'core'].includes(me.role);
  const route = hash.split('/').filter(Boolean);
  const inApp = route[0] === 'app' || route[0] === 'admin';
  let page;
  if (!ready) page = <div className="wrap empty">{t('loading')}</div>;
  else if (route[0] === 'news') page = <News />;
  else if (route[0] === 'login') page = session ? <Redirect to="/app" /> : <Login />;
  else if (inApp && !session) page = <Login />;
  else if (route[0] === 'app' && route[1] === 'a' && route[2]) page = <AccountDetail id={route[2]} />;
  else if (route[0] === 'app' && route[1] === 'accounts') page = <Accounts me={me} />;
  else if (route[0] === 'app' && route[1] === 'tree') page = <Tree me={me} />;
  else if (route[0] === 'app') page = <Overview me={me} />;
  else if (route[0] === 'admin') page = staff ? <Admin me={me} sub={route[1] || (me?.role === 'admin' ? 'overview' : 'accounts')} /> : <div className="wrap empty"><b>403</b></div>;
  else page = <Public />;

  const tab = (href, label) => <a href={'#' + href} className={hash === href || (href !== '/app' && hash.startsWith(href)) ? 'on' : ''}>{label}</a>;
  return (
    <>
      <header className="top"><div className="wrap">
        <a className="logo" href="#/" title="Trang chủ"><img src="/logo-128.png" alt="Lion Bot" width="40" height="40" /><b>LION BOT</b></a>
        <nav className="tabs">
          {session && <>{tab('/app', t('overview'))}{tab('/app/accounts', t('accounts'))}</>}
          {tab('/news', t('news'))}
          {(me?.is_leader || staff) && tab('/app/tree', t('tree'))}
          {staff && tab('/admin', t('admin'))}
        </nav>
        <button className="btn sm" onClick={() => { setLang(getLang() === 'vi' ? 'en' : 'vi'); document.documentElement.lang = getLang(); force(x => x + 1); }} aria-label="Language">{getLang() === 'vi' ? 'EN' : 'VI'}</button>
        <button className="btn sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={t('theme')}>{theme === 'dark' ? '☀' : '☾'}</button>
        {session && me && <span className="pill brand" style={{ fontSize: 11 }} title={me.email}>{t('role_' + (me.role === 'customer' && me.is_leader ? 'leader' : me.role))}</span>}
        {session ? <button className="btn sm" onClick={() => sb.auth.signOut().then(() => { location.hash = '/'; })}>{t('logout')}</button>
          : <a className="btn sm pri" href="#/login">{t('login')}</a>}
      </div></header>
      {route[0] !== 'news' && <AlertBanner st={mst} />}
      {page}
      <footer className="wrap small muted" style={{ paddingBottom: 24 }}>Lion Bot · v{VERSION}</footer>
    </>
  );
}

function Redirect({ to }) { useEffect(() => { location.hash = to; }, [to]); return null; }
