import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const VERSION = '1.2.0';
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'implicit' }
});

// Link đăng nhập trả mã về sau dấu # (vd: /#access_token=... hoặc /#/app#access_token=...).
// Web dùng # để chuyển trang, nên đọc mã TRƯỚC khi router chạy, rồi đưa về #/app.
export let authError = '';
export const authReady = (() => {
  const h = location.hash || '';
  const i = h.search(/(access_token|error_description|error)=/);
  if (i < 0) return Promise.resolve();
  const p = new URLSearchParams(h.slice(i));
  const at = p.get('access_token'), rt = p.get('refresh_token');
  if (at && rt) {
    history.replaceState(null, '', location.pathname + '#/app');
    return sb.auth.setSession({ access_token: at, refresh_token: rt })
      .then(({ error }) => { if (error) authError = error.message; })
      .catch(e => { authError = String(e && e.message || e); });
  }
  authError = p.get('error_description') || p.get('error') || 'Link không hợp lệ';
  history.replaceState(null, '', location.pathname + '#/login');
  return Promise.resolve();
})();

const DICT = {
  vi: {
    login: 'Đăng nhập', logout: 'Thoát', overview: 'Tổng quan', accounts: 'Tài khoản', tree: 'Hệ thống', admin: 'Quản trị',
    heroTitle: 'Bot vàng chạy minh bạch, số liệu cập nhật mỗi ngày',
    heroSub: 'Số tổng của toàn bộ tài khoản đang chạy Lion Bot. Đăng nhập để xem chi tiết tài khoản của bạn.',
    capital: 'Tổng vốn đang chạy', profitTotal: 'Tổng lợi nhuận', accountsCount: 'Số tài khoản', growthMonth: 'Tăng trưởng tháng này',
    cumProfit: 'Lợi nhuận lũy kế (USD)', monthly: 'Tăng trưởng theo tháng', month: 'Tháng', profit: 'Lãi/lỗ', pct: '%',
    disclaimer: 'Kết quả quá khứ không đảm bảo kết quả tương lai. Giao dịch vàng có rủi ro mất vốn.',
    emailLabel: 'Email đã đăng ký với Lion Bot', sendLink: 'Gửi link đăng nhập', sent: 'Đã gửi link đăng nhập tới email của bạn. Mở email trên thiết bị này và bấm vào link.',
    loginHint: 'Không cần mật khẩu. Hệ thống gửi một link đăng nhập vào email của bạn.',
    myCapital: 'Vốn của tôi', profitMonth: 'Lãi tháng này', profitAll: 'Lãi từ đầu', growth: 'Tăng trưởng tháng',
    myAccounts: 'Tài khoản của tôi', downline: 'Tài khoản tuyến dưới', broker: 'Sàn', customer: 'Khách hàng',
    noAccount: 'Chưa có tài khoản nào gắn với email này', noAccountHint: 'Liên hệ Lion Bot để được gắn tài khoản giao dịch vào email của bạn.',
    back: '← Quay lại', balanceChart: 'Số dư theo ngày', months: 'Kết quả theo tháng', transfers: 'Nạp / rút gần đây',
    deposit: 'Nạp', withdraw: 'Rút', startBal: 'Vốn đầu tháng', none: 'Chưa có dữ liệu',
    treeTitle: 'Hệ thống của tôi', wholeBranch: 'Cả nhánh', ownAcc: 'TK trực tiếp', allAcc: 'TK cả nhánh', leader: 'Trưởng nhánh',
    updated: 'Cập nhật', minutesAgo: 'phút trước', unit: 'Đơn vị', loading: 'Đang tải…', theme: 'Giao diện',
    noLinked: 'Email này chưa được gắn với khách hàng nào.', capitalCol: 'Vốn', search: 'Tìm tên, số TK, sàn…'
  },
  en: {
    login: 'Sign in', logout: 'Sign out', overview: 'Overview', accounts: 'Accounts', tree: 'Network', admin: 'Admin',
    heroTitle: 'A gold trading bot with transparent, daily results',
    heroSub: 'Totals across every account running Lion Bot. Sign in to see your own accounts in detail.',
    capital: 'Capital running', profitTotal: 'Total profit', accountsCount: 'Accounts', growthMonth: 'Growth this month',
    cumProfit: 'Cumulative profit (USD)', monthly: 'Monthly growth', month: 'Month', profit: 'P/L', pct: '%',
    disclaimer: 'Past results do not guarantee future results. Gold trading carries a risk of loss.',
    emailLabel: 'Email registered with Lion Bot', sendLink: 'Send sign-in link', sent: 'We sent a sign-in link to your email. Open it on this device and tap the link.',
    loginHint: 'No password needed. We email you a sign-in link.',
    myCapital: 'My capital', profitMonth: 'Profit this month', profitAll: 'Profit to date', growth: 'Monthly growth',
    myAccounts: 'My accounts', downline: 'Downline accounts', broker: 'Broker', customer: 'Customer',
    noAccount: 'No account is linked to this email yet', noAccountHint: 'Contact Lion Bot to link your trading account to your email.',
    back: '← Back', balanceChart: 'Daily balance', months: 'Monthly results', transfers: 'Recent deposits / withdrawals',
    deposit: 'Deposit', withdraw: 'Withdrawal', startBal: 'Start of month', none: 'No data yet',
    treeTitle: 'My network', wholeBranch: 'Whole branch', ownAcc: 'Direct accounts', allAcc: 'Branch accounts', leader: 'Leader',
    updated: 'Updated', minutesAgo: 'min ago', unit: 'Unit', loading: 'Loading…', theme: 'Theme',
    noLinked: 'This email is not linked to a customer yet.', capitalCol: 'Capital', search: 'Search name, account, broker…'
  }
};
let lang = (() => { try { return localStorage.getItem('lb.lang') || 'vi'; } catch { return 'vi'; } })();
export const getLang = () => lang;
export const setLang = l => { lang = l; try { localStorage.setItem('lb.lang', l); } catch {} };
export const t = k => (DICT[lang] && DICT[lang][k]) || DICT.vi[k] || k;

const loc = () => (lang === 'en' ? 'en-US' : 'vi-VN');
export const fmt = (v, d = 2) => (v == null || v === '' || isNaN(Number(v)) ? '—' : Number(v).toLocaleString(loc(), { minimumFractionDigits: d, maximumFractionDigits: d }));
export const usd = v => (v == null || isNaN(Number(v)) ? '—' : (Number(v) < 0 ? '−$' : '$') + fmt(Math.abs(v)));
export const signed = (v, d = 2) => (v == null || isNaN(Number(v)) ? '—' : (Number(v) > 0 ? '+' : Number(v) < 0 ? '−' : '') + fmt(Math.abs(v), d));
export const signedUsd = v => (v == null || isNaN(Number(v)) ? '—' : (Number(v) > 0 ? '+' : Number(v) < 0 ? '−' : '') + '$' + fmt(Math.abs(v)));
export const cls = v => (Number(v) > 0 ? 'pos' : Number(v) < 0 ? 'neg' : '');
export const vnDate = s => { if (!s) return '—'; const [y, m, d] = String(s).slice(0, 10).split('-'); return lang === 'en' ? `${m}/${d}/${y}` : `${d}/${m}/${y}`; };
export const monthLabel = s => { const [y, m] = String(s).split('-'); return `${m}/${y}`; };
export const minsAgo = ts => (ts ? Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000)) : null);

export async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args || {});
  if (error) throw error;
  return data;
}
