import Guide from './Guide.jsx';
import { useEffect, useState, useCallback } from 'react';
import { sb, rpc, t, getLang, setLang, VERSION, authReady, authError } from './lib.js';
import Public from './Public.jsx';
import Branch from './Branch.jsx';
import { News, AlertBanner, useMarketStatus } from './News.jsx';
import { Overview, Accounts, AccountDetail, Tree } from './Portal.jsx';
import Admin from './Admin.jsx';

function useHash() {
  const [h, setH] = useState(() => location.hash.replace(/^#/, '') || '/');
  useEffect(() => { const f = () => setH(location.hash.replace(/^#/, '') || '/'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
}

function PwInput({ id, value, onChange, auto, label }) {
  const [show, setShow] = useState(false);
  return (
    <label className="field">{label}
      <span style={{ position: 'relative', display: 'block' }}>
        <input id={id} type={show ? 'text' : 'password'} required minLength={8} value={value} onChange={e => onChange(e.target.value)} autoComplete={auto} style={{ paddingRight: 64, width: '100%' }} />
        <button type="button" className="btn sm" onClick={() => setShow(!show)} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)' }}>{show ? t('hidePw') : t('showPw')}</button>
      </span>
    </label>
  );
}

function Login() {
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('lb.loginMode') || 'password'; } catch { return 'password'; } });
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('lb.email') || ''; } catch { return ''; } });
  const [pw, setPw] = useState(''); const [state, setState] = useState(''); const [info, setInfo] = useState('');
  const [err, setErr] = useState(() => (authError ? (getLang() === 'en' ? 'Sign-in link failed or expired: ' : 'Link đăng nhập lỗi hoặc đã hết hạn, vui lòng gửi lại: ') + authError : ''));
  const pick = m => { setMode(m); setErr(''); setInfo(''); setState(''); try { localStorage.setItem('lb.loginMode', m); } catch {} };
  const remember = () => { try { localStorage.setItem('lb.email', email.trim().toLowerCase()); } catch {} };
  const submit = async e => {
    e.preventDefault(); setErr(''); setInfo(''); remember();
    if (mode === 'password') {
      setState('sending');
      const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pw });
      if (error) { setErr(/invalid/i.test(error.message) ? t('badLogin') : error.message); setState(''); }
      else location.hash = '/app';
      return;
    }
    setState('sending');
    const { error } = await sb.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { emailRedirectTo: location.origin + '/', shouldCreateUser: true } });
    if (error) { setErr(error.message); setState(''); } else setState('sent');
  };
  const forgot = async () => {
    setErr(''); setInfo('');
    if (!email.includes('@')) return setErr(t('needEmail'));
    remember();
    const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: location.origin + '/' });
    if (error) setErr(error.message); else setInfo(t('resetSent'));
  };
  return (
    <div className="login wrap"><form className="card" onSubmit={submit}>
      <h1 className="h-lg">{t('login')}</h1>
      <div className="seg" style={{ alignSelf: 'start' }}>{[['password', t('tabPassword')], ['link', t('tabLink')]].map(([k, l]) => <button key={k} type="button" className={mode === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>)}</div>
      <p className="muted small" style={{ margin: 0 }}>{mode === 'password' ? t('loginHint') : t('linkHint')}</p>
      <label className="field">{t('emailLabel')}<input id="login-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
      {mode === 'password' && <PwInput id="login-pw" value={pw} onChange={setPw} auto="current-password" label={t('password')} />}
      {err && <div className="neg small">{err}</div>}
      {info && <div className="pill ok" style={{ whiteSpace: 'normal', padding: '10px 12px', borderRadius: 10 }}>{info}</div>}
      {mode === 'link' && state === 'sent' ? <div className="pill ok" style={{ whiteSpace: 'normal', padding: '10px 12px', borderRadius: 10 }}>{t('sent')}</div>
        : <button className="btn pri" disabled={state === 'sending'}>{state === 'sending' ? (mode === 'password' ? t('signingIn') : t('loading')) : mode === 'password' ? t('login') : t('sendLink')}</button>}
      {mode === 'password' && <button type="button" className="btn sm" style={{ justifySelf: 'start', width: 'fit-content' }} onClick={forgot}>{t('forgot')}</button>}
    </form></div>
  );
}

// Đặt / đổi mật khẩu (sau khi vào bằng link email, hoặc từ link "Quên mật khẩu")
function SetPassword({ session }) {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState(''); const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false);
  const had = !!session?.user?.user_metadata?.has_password;
  const save = async e => {
    e.preventDefault(); setErr('');
    if (pw.length < 8) return setErr(t('pwShort'));
    if (pw !== pw2) return setErr(t('pwMismatch'));
    setBusy(true);
    const { error } = await sb.auth.updateUser({ password: pw, data: { has_password: true } });
    setBusy(false);
    if (error) return setErr(/reauth|recent/i.test(error.message) ? (getLang() === 'en' ? 'For security, sign out and sign in again with an email link, then change your password.' : 'Vì bảo mật, hãy thoát rồi đăng nhập lại bằng link email, sau đó đổi mật khẩu.') : error.message);
    try { localStorage.setItem('lb.loginMode', 'password'); if (session?.user?.email) localStorage.setItem('lb.email', session.user.email); } catch {}
    setOk(true); setTimeout(() => { location.hash = '/app'; }, 1500);
  };
  return (
    <div className="login wrap"><form className="card" onSubmit={save}>
      <h1 className="h-lg">{had ? t('changePwTitle') : t('setPwTitle')}</h1>
      <p className="muted small" style={{ margin: 0 }}>{session?.user?.email} · {t('setPwHint')}</p>
      <input type="email" value={session?.user?.email || ''} autoComplete="username" readOnly hidden />
      <PwInput id="new-pw" value={pw} onChange={setPw} auto="new-password" label={t('password')} />
      <PwInput id="new-pw2" value={pw2} onChange={setPw2} auto="new-password" label={t('password2')} />
      {err && <div className="neg small">{err}</div>}
      {ok ? <div className="pill ok" style={{ whiteSpace: 'normal', padding: '10px 12px', borderRadius: 10 }}>{t('pwSaved')}</div>
        : <button className="btn pri" disabled={busy}>{busy ? t('loading') : t('savePw')}</button>}
    </form></div>
  );
}

// Nhắc đặt mật khẩu cho người chưa có
function PwNudge({ session }) {
  const [hide, setHide] = useState(() => { try { return sessionStorage.getItem('lb.pwNudge') === '1'; } catch { return false; } });
  if (!session || hide || session.user?.user_metadata?.has_password) return null;
  return (
    <div style={{ background: 'var(--brand-soft)', borderBottom: '1px solid var(--line)' }}>
      <div className="wrap row" style={{ gap: 10, paddingBlock: 8 }}>
        <span className="grow small">🔑 {t('pwNudge')}</span>
        <a className="btn sm pri" href="#/set-password">{t('setPwTitle')}</a>
        <button className="btn sm" onClick={() => { setHide(true); try { sessionStorage.setItem('lb.pwNudge', '1'); } catch {} }}>{t('later')}</button>
      </div>
    </div>
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
  useEffect(() => { document.body.classList.toggle('wide', route[0] === 'admin'); }, [route[0]]);
  let page;
  if (!ready) page = <div className="wrap empty">{t('loading')}</div>;
  else if (route[0] === 'news') page = <News key={getLang()} />;
  else if (route[0] === 'guide') page = <Guide key={getLang()} slug={route[1]} />;
  else if (route[0] === 'b' && route[1]) page = <Branch token={route[1]} />;
  else if (route[0] === 'set-password') page = session ? <SetPassword session={session} /> : <Login />;
  else if (route[0] === 'login') page = session ? <Redirect to="/app" /> : <Login />;
  else if (inApp && !session) page = <Login />;
  else if (route[0] === 'app' && route[1] === 'a' && route[2]) page = <AccountDetail id={route[2]} />;
  else if (route[0] === 'app' && route[1] === 'accounts') page = <Accounts me={me} />;
  else if (route[0] === 'app' && route[1] === 'tree') page = <Tree me={me} />;
  else if (route[0] === 'app') page = <Overview me={me} />;
  else if (route[0] === 'admin') page = staff ? <Admin me={me} sub={route[1] || (me?.role === 'admin' ? 'overview' : me?.role === 'tech' ? 'botmon' : 'accounts')} arg={route[2]} /> : <div className="wrap empty"><b>403</b></div>;
  else page = <Public />;

  const tab = (href, label) => <a href={'#' + href} className={hash === href || (href !== '/app' && hash.startsWith(href)) ? 'on' : ''}>{label}</a>;
  return (
    <>
      <header className="top"><div className="wrap">
        <a className="logo" href="#/" title="Trang chủ"><img src="/logo-128.png" alt="Lion Bot" width="40" height="40" /><b>LION BOT</b></a>
        <nav className="tabs">
          {session && <>{tab('/app', t('overview'))}{tab('/app/accounts', t('accounts'))}</>}
          {tab('/news', t('news'))}
          {tab('/guide', t('guide'))}
          {(me?.is_leader || staff) && tab('/app/tree', t('tree'))}
          {staff && tab('/admin', t('admin'))}
        </nav>
        <button className="btn sm" onClick={() => { setLang(getLang() === 'vi' ? 'en' : 'vi'); document.documentElement.lang = getLang(); force(x => x + 1); }} aria-label="Language">{getLang() === 'vi' ? 'EN' : 'VI'}</button>
        <button className="btn sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={t('theme')}>{theme === 'dark' ? '☀' : '☾'}</button>
        {session && me && <a href="#/set-password" className="pill brand" style={{ fontSize: 11, textDecoration: 'none' }} title={me.email + ' · ' + t('changePwTitle')}>{t('role_' + (me.role === 'customer' && me.is_leader ? 'leader' : me.role))} 🔑</a>}
        {session ? <button className="btn sm" onClick={() => sb.auth.signOut().then(() => { location.hash = '/'; })}>{t('logout')}</button>
          : <a className="btn sm pri" href="#/login">{t('login')}</a>}
      </div></header>
      {route[0] !== 'set-password' && <PwNudge session={session} />}
      {route[0] !== 'news' && <AlertBanner st={mst} />}
      {page}
      <footer className="wrap small muted" style={{ paddingBottom: 24 }}>Lion Bot · v{VERSION}</footer>
    </>
  );
}

function Redirect({ to }) { useEffect(() => { location.hash = to; }, [to]); return null; }
