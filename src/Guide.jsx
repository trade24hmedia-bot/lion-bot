import { useEffect, useState, useCallback } from 'react';
import { sb, tr, getLang } from './lib.js';
import { Modal, F } from './ui.jsx';

// Hướng dẫn mở tài khoản & copy bot theo sàn.
// Khách: #/guide (danh sách sàn) → #/guide/<sàn> (các bước có ảnh / video). Không cần đăng nhập.
// Quản trị: tab Hướng dẫn (Quản lý + Kỹ thuật) thêm sàn, bước, tải ảnh / video.

export const SECTIONS = [
  ['register', 'Đăng ký tài khoản', 'Open an account'],
  ['verify', 'Xác minh danh tính', 'Verify your identity'],
  ['deposit', 'Nạp tiền', 'Deposit'],
  ['copy', 'Cài đặt copy bot', 'Set up bot copying'],
  ['other', 'Lưu ý khác', 'Other notes']
];
const secName = k => { const s = SECTIONS.find(x => x[0] === k) || SECTIONS[4]; return getLang() === 'en' ? s[2] : s[1]; };
const pick = (vi, en) => (getLang() === 'en' && en ? en : vi);

// link video → khung xem
function videoEmbed(u) {
  if (!u) return null;
  let m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{6,})/);
  if (m) return { kind: 'iframe', src: 'https://www.youtube-nocookie.com/embed/' + m[1] + '?rel=0' };
  m = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (m) return { kind: 'iframe', src: 'https://drive.google.com/file/d/' + m[1] + '/preview' };
  if (/\.(mp4|webm|mov)(\?|$)/i.test(u) || u.includes('/storage/v1/object/public/guides/')) return { kind: 'video', src: u };
  return { kind: 'link', src: u };
}
function Video({ url }) {
  const v = videoEmbed(url); if (!v) return null;
  if (v.kind === 'link') return <a className="btn" href={v.src} target="_blank" rel="noopener noreferrer">▶ {tr('Xem video hướng dẫn', 'Watch the video')}</a>;
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 760, aspectRatio: '16 / 9', background: '#000', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      {v.kind === 'iframe'
        ? <iframe src={v.src} title="video" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
        : <video src={v.src} controls playsInline preload="metadata" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />}
    </div>
  );
}
function Logo({ b, size = 56 }) {
  return b.logo_url
    ? <img src={b.logo_url} alt={b.name} width={size} height={size} style={{ width: size, height: size, objectFit: 'contain', borderRadius: 12, background: '#fff', padding: 4, flex: 'none' }} />
    : <span style={{ width: size, height: size, borderRadius: 12, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: size * 0.42, flex: 'none' }}>{b.name.slice(0, 1)}</span>;
}

// ------------------------------------------------------------ trang khách
export default function Guide({ slug }) {
  const [brokers, setBrokers] = useState(null); const [steps, setSteps] = useState([]); const [err, setErr] = useState('');
  useEffect(() => {
    Promise.all([sb.from('guide_brokers').select('*').eq('published', true).order('sort').order('name'), sb.from('guide_steps').select('id,broker_id,section,sort,title,title_en,body,body_en,images,video_url').order('sort')])
      .then(([a, b]) => { if (a.error) throw a.error; setBrokers(a.data); setSteps(b.data || []); }).catch(e => setErr(e.message));
  }, []);
  if (err) return <main className="wrap"><div className="card neg">{err}</div></main>;
  if (!brokers) return <main className="wrap"><div className="empty">{tr('Đang tải…', 'Loading…')}</div></main>;
  const b = slug && brokers.find(x => x.slug === slug);
  if (slug && !b) return <main className="wrap"><div className="card empty"><b>{tr('Không tìm thấy sàn này', 'Broker not found')}</b><a className="btn" href="#/guide">← {tr('Danh sách sàn', 'All brokers')}</a></div></main>;
  if (b) return <BrokerGuide b={b} steps={steps.filter(s => s.broker_id === b.id)} />;
  return (
    <main className="wrap">
      <section className="hero">
        <span className="small muted" style={{ letterSpacing: '.08em' }}>{tr('HƯỚNG DẪN', 'GUIDES')}</span>
        <h1 className="h-display" style={{ margin: 0 }}>{tr('Mở tài khoản & copy bot', 'Open an account & copy the bot')}</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 680 }}>{tr('Chọn sàn bạn dùng để xem hướng dẫn từng bước bằng hình ảnh và video: đăng ký, xác minh, nạp tiền và cài đặt copy bot Lion Bot.', 'Pick your broker to see step-by-step guides with screenshots and video: sign up, verify, deposit and set up Lion Bot copying.')}</p>
      </section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,260px),1fr))', gap: 'var(--space-4)' }}>
        {brokers.map(x => { const n = steps.filter(s => s.broker_id === x.id).length; return (
          <a key={x.id} href={'#/guide/' + x.slug} className="card" style={{ color: 'var(--ink)', textDecoration: 'none', border: '1px solid var(--line)', alignContent: 'start' }}>
            <div className="row" style={{ flexWrap: 'nowrap' }}><Logo b={x} /><div style={{ minWidth: 0 }}><div className="title">{x.name}</div><div className="small muted">{n ? n + tr(' bước hướng dẫn', ' steps') : tr('Đang cập nhật', 'Coming soon')}</div></div></div>
            {pick(x.intro, x.intro_en) && <p className="small muted" style={{ margin: 0 }}>{pick(x.intro, x.intro_en)}</p>}
            <span className="btn pri" style={{ justifySelf: 'start' }}>{tr('Xem hướng dẫn →', 'Open guide →')}</span>
          </a>); })}
      </div>
      {!brokers.length && <div className="empty">{tr('Chưa có hướng dẫn', 'No guides yet')}</div>}
    </main>
  );
}

function BrokerGuide({ b, steps }) {
  const secs = SECTIONS.map(s => s[0]).filter(k => steps.some(x => x.section === k));
  const [sec, setSec] = useState(secs[0] || 'register'); const [zoom, setZoom] = useState(null); const [msg, setMsg] = useState('');
  useEffect(() => { const f = e => e.key === 'Escape' && setZoom(null); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, []);
  const list = steps.filter(x => x.section === sec).sort((x, y) => x.sort - y.sort);
  const copy = async v => { try { await navigator.clipboard.writeText(v); setMsg(tr('Đã chép', 'Copied')); } catch { setMsg(v); } setTimeout(() => setMsg(''), 2000); };
  const before = SECTIONS.map(s => s[0]).filter(k => secs.includes(k)).indexOf(sec);
  const offset = secs.slice(0, before).reduce((n, k) => n + steps.filter(x => x.section === k).length, 0);
  return (
    <main className="wrap">
      <a href="#/guide" className="btn sm" style={{ justifySelf: 'start' }}>← {tr('Tất cả sàn', 'All brokers')}</a>
      <section className="card">
        <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><Logo b={b} size={64} />
          <div style={{ display: 'grid', gap: 6, minWidth: 0 }}><h1 className="h-lg" style={{ margin: 0 }}>{b.name}</h1>
            {pick(b.intro, b.intro_en) && <p className="muted" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{pick(b.intro, b.intro_en)}</p>}</div></div>
        {(b.ref_link || b.ref_code) && <div className="row">
          {b.ref_link && <a className="btn pri" href={b.ref_link} target="_blank" rel="noopener noreferrer">{tr('Mở tài khoản ' + b.name + ' →', 'Open a ' + b.name + ' account →')}</a>}
          {b.ref_code && <span className="row" style={{ gap: 6 }}><span className="small muted">{tr('Mã giới thiệu', 'Referral code')}</span><span className="key" style={{ fontSize: 15 }}>{b.ref_code}</span><button className="btn sm" onClick={() => copy(b.ref_code)}>{tr('Chép', 'Copy')}</button></span>}
          {msg && <span className="pill ok">{msg}</span>}
        </div>}
      </section>

      {!steps.length ? <div className="card empty"><b>{tr('Hướng dẫn đang được cập nhật', 'This guide is being prepared')}</b><span>{tr('Vui lòng quay lại sau hoặc liên hệ người giới thiệu để được hỗ trợ.', 'Please check back later or contact the person who referred you.')}</span></div> : <>
        {secs.length > 1 && <div className="seg" style={{ justifySelf: 'start', flexWrap: 'wrap' }}>{secs.map((k, i) => <button key={k} className={sec === k ? 'on' : ''} onClick={() => { setSec(k); scrollTo({ top: 0, behavior: 'smooth' }); }}>{i + 1}. {secName(k)}</button>)}</div>}
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {list.map((s, i) => (
            <section key={s.id} className="card">
              <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <span className="num" style={{ flex: 'none', width: 36, height: 36, borderRadius: 99, background: 'var(--brand)', color: 'var(--on-brand)', display: 'grid', placeItems: 'center', fontWeight: 700 }}>{offset + i + 1}</span>
                <div style={{ display: 'grid', gap: 6, minWidth: 0 }}><div className="title">{pick(s.title, s.title_en)}</div>
                  {pick(s.body, s.body_en) && <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{linkify(pick(s.body, s.body_en))}</div>}</div>
              </div>
              {s.images?.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: s.images.length === 1 ? 'minmax(0,760px)' : 'repeat(auto-fill,minmax(min(100%,240px),1fr))', gap: 10 }}>
                {s.images.map((u, j) => <button key={u} type="button" onClick={() => setZoom(u)} style={{ padding: 0, border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--surface-200)', cursor: 'zoom-in' }}>
                  <img src={u} alt={pick(s.title, s.title_en) + ' ' + (j + 1)} loading="lazy" style={{ display: 'block', width: '100%', height: 'auto', maxHeight: s.images.length === 1 ? 640 : 420, objectFit: 'contain' }} /></button>)}
              </div>}
              {s.video_url && <Video url={s.video_url} />}
            </section>))}
        </div>
        {secs.indexOf(sec) < secs.length - 1 && <button className="btn pri" style={{ justifySelf: 'start' }} onClick={() => { setSec(secs[secs.indexOf(sec) + 1]); scrollTo({ top: 0, behavior: 'smooth' }); }}>{tr('Tiếp theo', 'Next')}: {secName(secs[secs.indexOf(sec) + 1])} →</button>}
      </>}
      {zoom && <div className="overlay" onClick={() => setZoom(null)} style={{ alignItems: 'center', cursor: 'zoom-out' }}><img src={zoom} alt="" style={{ maxWidth: '100%', maxHeight: '92vh', borderRadius: 8 }} /></div>}
    </main>
  );
}
const linkify = t => String(t).split(/(https?:\/\/[^\s]+)/g).map((p, i) => /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a> : p);

// ------------------------------------------------------------ quản trị (Quản lý + Kỹ thuật)
const slugify = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// ảnh: thu nhỏ còn cạnh dài 1800px, nén JPEG cho nhẹ (ảnh chụp màn hình điện thoại thường 3–5MB → ~300KB)
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400 * 1024) return file;
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });
  const k = Math.min(1, 1800 / Math.max(img.width, img.height)); const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.85));
  return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
}
async function upload(file, folder) {
  const f = await shrink(file);
  if (f.size > 50 * 1024 * 1024) throw new Error(tr('File quá 50MB. Video dài nên đưa lên YouTube (chế độ Không công khai) rồi dán link.', 'File over 50MB'));
  const ext = (f.name.match(/\.(\w+)$/) || [, f.type.split('/')[1] || 'bin'])[1].toLowerCase();
  const path = `${folder || 'chung'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from('guides').upload(path, f, { contentType: f.type, upsert: false });
  if (error) throw error;
  return sb.storage.from('guides').getPublicUrl(path).data.publicUrl;
}
const pathOf = u => (u && u.includes('/storage/v1/object/public/guides/') ? decodeURIComponent(u.split('/storage/v1/object/public/guides/')[1]) : null);
const removeFiles = urls => { const p = urls.map(pathOf).filter(Boolean); if (p.length) sb.storage.from('guides').remove(p).catch(() => {}); };

export function GuideAdmin({ say }) {
  const [brokers, setBrokers] = useState(null); const [steps, setSteps] = useState([]); const [sel, setSel] = useState(null);
  const [eb, setEb] = useState(null); const [es, setEs] = useState(null); const [saving, setSaving] = useState(false); const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([sb.from('guide_brokers').select('*').order('sort').order('name'), sb.from('guide_steps').select('*').order('sort')]);
    if (a.error) return say(a.error.message);
    setBrokers(a.data); setSteps(b.data || []); setSel(s => s || a.data[0]?.id || null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  if (!brokers) return <div className="empty">Đang tải…</div>;
  const b = brokers.find(x => x.id === sel);
  const bs = steps.filter(s => s.broker_id === sel);

  const up = async (files, key, multi) => {
    if (!files?.length) return; setBusy(key);
    try {
      const urls = []; for (const f of files) urls.push(await upload(f, (eb || b)?.slug || 'chung'));
      if (key === 'logo') setEb(x => ({ ...x, logo_url: urls[0] }));
      else if (key === 'video') setEs(x => ({ ...x, video_url: urls[0] }));
      else setEs(x => ({ ...x, images: multi ? [...(x.images || []), ...urls] : urls }));
      say('Đã tải lên ' + urls.length + ' file');
    } catch (x) { say(x.message); } finally { setBusy(''); }
  };
  const saveBroker = async () => {
    if (!eb.name?.trim()) return say('Nhập tên sàn');
    setSaving(true);
    const body = { name: eb.name.trim(), slug: eb.slug?.trim() || slugify(eb.name), logo_url: eb.logo_url || null, intro: eb.intro || null, intro_en: eb.intro_en || null,
      ref_link: eb.ref_link?.trim() || null, ref_code: eb.ref_code?.trim() || null, sort: Number(eb.sort) || 0, published: eb.published !== false, updated_at: new Date().toISOString() };
    const r = eb.id ? await sb.from('guide_brokers').update(body).eq('id', eb.id).select('id').single() : await sb.from('guide_brokers').insert(body).select('id').single();
    setSaving(false);
    if (r.error) return say(/duplicate|unique/i.test(r.error.message) ? 'Mã đường dẫn đã có sàn khác dùng' : r.error.message);
    setEb(null); setSel(r.data.id); load(); say('Đã lưu sàn');
  };
  const delBroker = async () => {
    if (!confirm(`Xóa sàn "${eb.name}" cùng ${steps.filter(s => s.broker_id === eb.id).length} bước hướng dẫn?`)) return;
    const { error } = await sb.from('guide_brokers').delete().eq('id', eb.id); if (error) return say(error.message);
    removeFiles(steps.filter(s => s.broker_id === eb.id).flatMap(s => [...(s.images || []), s.video_url]).concat(eb.logo_url));
    setEb(null); setSel(null); load(); say('Đã xóa sàn');
  };
  const saveStep = async () => {
    if (!es.title?.trim()) return say('Nhập tiêu đề bước');
    setSaving(true);
    const same = steps.filter(s => s.broker_id === sel && s.section === es.section && s.id !== es.id);
    const body = { broker_id: sel, section: es.section, title: es.title.trim(), title_en: es.title_en?.trim() || null, body: es.body || null, body_en: es.body_en || null,
      images: es.images || [], video_url: es.video_url?.trim() || null, sort: es.id && es.section === es._section ? es.sort : (same.length ? Math.max(...same.map(s => s.sort)) + 10 : 10), updated_at: new Date().toISOString() };
    const r = es.id ? await sb.from('guide_steps').update(body).eq('id', es.id) : await sb.from('guide_steps').insert(body);
    setSaving(false);
    if (r.error) return say(r.error.message);
    if (es._removed?.length) removeFiles(es._removed);
    setEs(null); load(); say('Đã lưu bước');
  };
  const delStep = async () => {
    if (!confirm('Xóa bước "' + es.title + '"?')) return;
    const { error } = await sb.from('guide_steps').delete().eq('id', es.id); if (error) return say(error.message);
    removeFiles([...(es.images || []), es.video_url, ...(es._removed || [])]); setEs(null); load(); say('Đã xóa bước');
  };
  const move = async (s, dir) => {
    const list = bs.filter(x => x.section === s.section).sort((x, y) => x.sort - y.sort); const i = list.findIndex(x => x.id === s.id); const o = list[i + dir]; if (!o) return;
    await Promise.all([sb.from('guide_steps').update({ sort: o.sort }).eq('id', s.id), sb.from('guide_steps').update({ sort: s.sort === o.sort ? s.sort + dir : s.sort }).eq('id', o.id)]); load();
  };
  const dropImg = u => setEs(x => ({ ...x, images: x.images.filter(v => v !== u), _removed: [...(x._removed || []), u] }));
  const moveImg = (u, d) => setEs(x => { const a = [...x.images]; const i = a.indexOf(u); const j = i + d; if (j < 0 || j >= a.length) return x; [a[i], a[j]] = [a[j], a[i]]; return { ...x, images: a }; });

  return (
    <>
      <section className="card">
        <div className="row"><div className="title grow">Hướng dẫn mở tài khoản & copy bot</div>
          <a className="btn" href="#/guide" target="_blank" rel="noopener noreferrer">Xem trang khách ↗</a>
          <button className="btn pri" onClick={() => setEb({ name: '', slug: '', sort: (brokers.length + 1), published: true })}>+ Thêm sàn</button></div>
        <p className="small muted" style={{ margin: 0 }}>Khách xem ở <b>lion-bot.pages.dev/#/guide</b>, không cần đăng nhập. Mỗi sàn chia mục: Đăng ký → Xác minh → Nạp tiền → Cài copy bot. Ảnh chụp màn hình tự thu nhỏ khi tải lên. Video ngắn tải thẳng (≤ 50MB); video dài nên đưa lên YouTube để <b>Không công khai</b> rồi dán link (xem mượt hơn, không tốn dung lượng web).</p>
        <div className="seg" style={{ justifySelf: 'start', flexWrap: 'wrap' }}>{brokers.map(x => <button key={x.id} className={sel === x.id ? 'on' : ''} onClick={() => setSel(x.id)}>{x.name} <span className="muted small">({steps.filter(s => s.broker_id === x.id).length})</span>{!x.published && ' 🔒'}</button>)}</div>
      </section>

      {b && <section className="card">
        <div className="row"><Logo b={b} size={44} /><div className="grow"><div className="title">{b.name}{!b.published && <> <span className="pill mut">Đang ẩn</span></>}</div>
          <div className="small muted">#/guide/{b.slug}{b.ref_link ? ' · có link đăng ký' : ' · chưa có link đăng ký'}{b.ref_code ? ' · mã ' + b.ref_code : ''}</div></div>
          <a className="btn sm" href={'#/guide/' + b.slug} target="_blank" rel="noopener noreferrer">Xem ↗</a>
          <button className="btn sm" onClick={() => setEb({ ...b })}>Sửa thông tin sàn</button></div>
        {SECTIONS.map(([k, l]) => { const list = bs.filter(s => s.section === k).sort((x, y) => x.sort - y.sort); return (
          <div key={k} style={{ display: 'grid', gap: 8 }}>
            <div className="row"><b className="grow">{l} <span className="muted small">({list.length})</span></b>
              <button className="btn sm" onClick={() => setEs({ section: k, title: '', body: '', images: [], video_url: '' })}>+ Thêm bước</button></div>
            {list.map((s, i) => <div key={s.id} className="row" style={{ background: 'var(--surface-200)', borderRadius: 'var(--radius-md)', padding: '8px 12px', flexWrap: 'nowrap' }}>
              <span className="num muted" style={{ width: 22 }}>{i + 1}</span>
              {s.images?.[0] ? <img src={s.images[0]} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, flex: 'none' }} /> : <span style={{ width: 48, height: 48, flex: 'none' }} />}
              <span className="grow" style={{ minWidth: 0 }}><b>{s.title}</b><div className="small muted">{(s.images || []).length} ảnh{s.video_url ? ' · có video' : ''}{s.title_en ? ' · có tiếng Anh' : ''}</div></span>
              <button className="btn sm" disabled={!i} onClick={() => move(s, -1)} aria-label="Lên">↑</button>
              <button className="btn sm" disabled={i === list.length - 1} onClick={() => move(s, 1)} aria-label="Xuống">↓</button>
              <button className="btn sm" onClick={() => setEs({ ...s, _section: s.section })}>Sửa</button></div>)}
          </div>); })}
      </section>}

      {eb && <Modal title={eb.id ? 'Sửa sàn' : 'Thêm sàn'} onClose={() => setEb(null)} onSave={saveBroker} saving={saving}
        extra={eb.id && <button type="button" className="btn" onClick={delBroker}>Xóa sàn</button>}>
        <div className="form">
          <F label="Tên sàn"><input id="gb-name" value={eb.name} onChange={e => setEb({ ...eb, name: e.target.value, slug: eb.id ? eb.slug : slugify(e.target.value) })} placeholder="Vantage" /></F>
          <F label="Đường dẫn (#/guide/…)"><input id="gb-slug" value={eb.slug || ''} onChange={e => setEb({ ...eb, slug: slugify(e.target.value) })} /></F>
          <F label="Link đăng ký (link giới thiệu của Lion Bot)"><input id="gb-ref" type="url" value={eb.ref_link || ''} onChange={e => setEb({ ...eb, ref_link: e.target.value })} placeholder="https://…" /></F>
          <F label="Mã giới thiệu / IB (nếu có)"><input id="gb-code" value={eb.ref_code || ''} onChange={e => setEb({ ...eb, ref_code: e.target.value })} /></F>
          <F label="Thứ tự hiển thị"><input id="gb-sort" type="number" value={eb.sort ?? 0} onChange={e => setEb({ ...eb, sort: e.target.value })} /></F>
          <F label="Hiển thị cho khách"><label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: 18, height: 18 }} checked={eb.published !== false} onChange={e => setEb({ ...eb, published: e.target.checked })} />Đang hiện</label></F>
          <F label="Giới thiệu ngắn" wide><textarea id="gb-intro" rows={2} value={eb.intro || ''} onChange={e => setEb({ ...eb, intro: e.target.value })} /></F>
          <F label="Giới thiệu (tiếng Anh, cho khách nước ngoài)" wide><textarea id="gb-intro-en" rows={2} value={eb.intro_en || ''} onChange={e => setEb({ ...eb, intro_en: e.target.value })} /></F>
          <F label="Logo sàn" wide><span className="row">{eb.logo_url && <Logo b={eb} size={48} />}<input id="gb-logo" type="file" accept="image/*" onChange={e => up(e.target.files, 'logo')} />{busy === 'logo' && <span className="small muted">Đang tải…</span>}{eb.logo_url && <button type="button" className="btn sm" onClick={() => setEb({ ...eb, logo_url: null })}>Bỏ logo</button>}</span></F>
        </div>
      </Modal>}

      {es && <Modal title={es.id ? 'Sửa bước' : 'Thêm bước · ' + (b?.name || '')} onClose={() => setEs(null)} onSave={saveStep} saving={saving || !!busy}
        extra={es.id && <button type="button" className="btn" onClick={delStep}>Xóa bước</button>}>
        <div className="form">
          <F label="Mục"><select id="gs-sec" value={es.section} onChange={e => setEs({ ...es, section: e.target.value })}>{SECTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
          <F label="Tiêu đề bước"><input id="gs-title" value={es.title} onChange={e => setEs({ ...es, title: e.target.value })} placeholder="Bấm link đăng ký và điền email" /></F>
          <F label="Nội dung hướng dẫn" wide><textarea id="gs-body" rows={4} value={es.body || ''} onChange={e => setEs({ ...es, body: e.target.value })} placeholder={'Viết ngắn gọn từng thao tác, mỗi ý 1 dòng.\nCó thể dán link, khách bấm được.'} /></F>
          <F label="Ảnh chụp màn hình (chọn được nhiều ảnh)" wide>
            <span className="row"><input id="gs-img" type="file" accept="image/*" multiple onChange={e => { up([...e.target.files], 'img', true); e.target.value = ''; }} />{busy === 'img' && <span className="small muted">Đang tải ảnh…</span>}</span>
            {es.images?.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 8, marginTop: 6 }}>
              {es.images.map((u, i) => <div key={u} style={{ display: 'grid', gap: 4 }}><img src={u} alt="" style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} />
                <span className="row" style={{ gap: 4, justifyContent: 'center' }}><button type="button" className="btn sm" disabled={!i} onClick={() => moveImg(u, -1)}>←</button><button type="button" className="btn sm" disabled={i === es.images.length - 1} onClick={() => moveImg(u, 1)}>→</button><button type="button" className="btn sm" onClick={() => dropImg(u)}>Bỏ</button></span></div>)}
            </div>}
          </F>
          <F label="Video: dán link YouTube / Google Drive, hoặc tải file (≤ 50MB)" wide>
            <span className="row"><input id="gs-video" style={{ flex: '1 1 260px' }} value={es.video_url || ''} onChange={e => setEs({ ...es, video_url: e.target.value })} placeholder="https://youtu.be/…" />
              <input id="gs-vfile" type="file" accept="video/mp4,video/webm,video/quicktime" onChange={e => { up(e.target.files, 'video'); e.target.value = ''; }} />{busy === 'video' && <span className="small muted">Đang tải video…</span>}</span>
            {es.video_url && <div style={{ marginTop: 6 }}><Video url={es.video_url} /></div>}
          </F>
          <F label="Tiêu đề (tiếng Anh, không bắt buộc)" wide><input id="gs-title-en" value={es.title_en || ''} onChange={e => setEs({ ...es, title_en: e.target.value })} /></F>
          <F label="Nội dung (tiếng Anh, không bắt buộc)" wide><textarea id="gs-body-en" rows={3} value={es.body_en || ''} onChange={e => setEs({ ...es, body_en: e.target.value })} /></F>
        </div>
      </Modal>}
    </>
  );
}
