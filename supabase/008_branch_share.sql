-- =====================================================================
-- LION BOT · bổ sung 1.6.0 (09/11/2026): LINK CHIA SẺ THEO NHÁNH
--  Mỗi nhánh có 1 link riêng  https://lion-bot.pages.dev/#/b/<mã>
--  Ai có link (không cần đăng nhập) xem được hiệu quả TÀI KHOẢN MASTER của nhánh:
--  vốn, lãi theo tháng/quý/tùy chọn, tăng trưởng (tính theo kiểu quỹ, không bị méo vì nạp/rút),
--  DD lớn nhất, ngày thắng/thua, biểu đồ, kết quả từng ngày, trạng thái bot đang chạy.
--  Số tài khoản luôn che 4 số đầu. Không lộ khách khác trong nhánh.
--  share_scope = 'master' (mặc định). 'branch' (xem cả nhánh) để dành cho bản sau.
-- Chạy SAU 006. Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================

alter table public.systems add column if not exists master_account_id uuid references public.accounts(id) on delete set null;
alter table public.systems add column if not exists share_token  text unique;
alter table public.systems add column if not exists share_enabled boolean not null default false;
alter table public.systems add column if not exists share_scope  text not null default 'master';
alter table public.systems add column if not exists contact      text;      -- Zalo / Telegram / SĐT trưởng nhánh, hiện trên trang chia sẻ
alter table public.systems add column if not exists share_intro  text;      -- lời giới thiệu ngắn
do $$ begin
  alter table public.systems add constraint systems_share_scope_chk check (share_scope in ('master', 'branch'));
exception when duplicate_object then null; end $$;

-- Mã link ngẫu nhiên 10 ký tự (không đoán được)
create or replace function public.new_share_token() returns text language sql volatile as $$
  select string_agg(substr('abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 55)::int, 1), '')
    from generate_series(1, 10) $$;

create or replace function public.systems_share_token() returns trigger language plpgsql as $$
begin
  if new.share_token is null or new.share_token = '' then new.share_token := public.new_share_token(); end if;
  return new;
end $$;
drop trigger if exists systems_share_token on public.systems;
create trigger systems_share_token before insert or update on public.systems
  for each row execute function public.systems_share_token();
update public.systems set share_token = public.new_share_token() where share_token is null;

-- Lợi nhuận theo ngày của 1 tài khoản, kèm % ngày tính trên vốn đầu ngày (= số dư cuối ngày − lãi/lỗ ngày)
create or replace function public.acc_daily_returns(p_account uuid)
returns table (date date, net numeric, net_usd numeric, balance numeric, ret numeric, dd_max_pct numeric, trades int)
language sql stable security definer set search_path = public as $$
  select r.date, r.net, round(public.to_usd(r.net, a.currency), 2), r.balance,
         case when coalesce(r.balance, 0) - coalesce(r.net, 0) > 0 then r.net / (r.balance - r.net) end,
         r.dd_max_pct, r.trades
    from public.daily_results r join public.accounts a on a.id = r.account_id
   where r.account_id = p_account order by r.date $$;
revoke all on function public.acc_daily_returns(uuid) from public, anon, authenticated;

-- Trang chia sẻ công khai của nhánh
create or replace function public.public_branch(p_token text, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s public.systems; a public.accounts; v_leader text; st record;
  v_from date; v_to date; v_seen timestamptz;
  v_series jsonb; v_months jsonb; v_days jsonb; k jsonb;
begin
  select * into s from public.systems where share_token = p_token and share_enabled;
  if not found then return jsonb_build_object('ok', false); end if;
  select * into a from public.accounts where id = s.master_account_id;
  v_leader := coalesce((select name from public.customers where id = s.leader_customer_id), s.leader_name);
  if a.id is null then
    return jsonb_build_object('ok', true, 'branch', jsonb_build_object('name', s.name, 'leader', v_leader, 'contact', s.contact, 'intro', s.share_intro), 'account', null);
  end if;
  v_to := coalesce(p_to, public.vn_today());
  v_from := coalesce(p_from, date_trunc('month', v_to)::date);

  -- chuỗi chỉ số tăng trưởng (1 = 100%) toàn thời gian
  with d as (select * from public.acc_daily_returns(a.id)),
  idx as (select date, net, net_usd, balance, ret, dd_max_pct, trades,
                 exp(sum(ln(greatest(1 + coalesce(ret, 0), 0.0001))) over (order by date)) as ix from d)
  select jsonb_agg(jsonb_build_object('date', date, 'net_usd', net_usd, 'ret', round(coalesce(ret, 0) * 100, 3),
                                      'growth', round((ix - 1) * 100, 2), 'balance_usd', round(public.to_usd(balance, a.currency), 2)) order by date)
    into v_series from idx;

  -- theo tháng
  with d as (select * from public.acc_daily_returns(a.id))
  select jsonb_agg(jsonb_build_object('month', m, 'net_usd', nu, 'pct', round((g - 1) * 100, 2), 'days', n) order by m)
    into v_months
    from (select to_char(date, 'YYYY-MM') m, sum(net_usd) nu, exp(sum(ln(greatest(1 + coalesce(ret, 0), 0.0001)))) g, count(*) n
            from d group by 1) x;

  -- từng ngày trong kỳ (mới nhất trước, tối đa 62 ngày)
  select jsonb_agg(jsonb_build_object('date', date, 'net_usd', net_usd, 'ret', round(coalesce(ret, 0) * 100, 2), 'dd', dd_max_pct, 'trades', trades) order by date desc)
    into v_days
    from (select * from public.acc_daily_returns(a.id) where date between v_from and v_to order by date desc limit 62) x;

  -- chỉ số của kỳ chọn + toàn thời gian
  with d as (select * from public.acc_daily_returns(a.id)),
  p as (select * from d where date between v_from and v_to),
  ix as (select date, exp(sum(ln(greatest(1 + coalesce(ret, 0), 0.0001))) over (order by date)) v from d),
  dd as (select max(1 - v / pk) mdd from (select v, max(v) over (order by date) pk from ix) z)
  select jsonb_build_object(
      'profit_usd', (select round(coalesce(sum(net_usd), 0), 2) from p),
      'growth_pct', (select round((exp(coalesce(sum(ln(greatest(1 + coalesce(ret, 0), 0.0001))), 0)) - 1) * 100, 2) from p),
      'days', (select count(*) from p),
      'win_days', (select count(*) from p where net > 0),
      'loss_days', (select count(*) from p where net < 0),
      'best_day_usd', (select max(net_usd) from p), 'worst_day_usd', (select min(net_usd) from p),
      'dd_day_max', (select max(dd_max_pct) from p),
      'profit_all_usd', (select round(coalesce(sum(net_usd), 0), 2) from d),
      'growth_all_pct', (select round((exp(coalesce(sum(ln(greatest(1 + coalesce(ret, 0), 0.0001))), 0)) - 1) * 100, 2) from d),
      'max_dd_pct', (select round(coalesce(mdd, 0) * 100, 2) from dd),
      'dd_day_max_all', (select max(dd_max_pct) from d),
      'days_all', (select count(*) from d),
      'first_date', (select min(date) from d))
    into k;

  select * into st from public.account_status where account_id = a.id;
  v_seen := greatest((select max(received_at) from public.daily_results where account_id = a.id), st.received_at);

  return jsonb_build_object('ok', true,
    'branch', jsonb_build_object('name', s.name, 'leader', v_leader, 'contact', s.contact, 'intro', s.share_intro, 'scope', s.share_scope),
    'account', jsonb_build_object(
      'mask', case when length(a.account_no) <= 4 then '••••' else '••••' || substr(a.account_no, 5) end,
      'broker', a.broker, 'platform', a.platform, 'currency', a.currency, 'bot', nullif(trim(coalesce(a.bot_name, '') || ' ' || coalesce(a.bot_version, '')), ''),
      'status', a.status, 'start', coalesce(a.open_date, a.bot_start),
      'capital_usd', round(public.to_usd(coalesce((select balance from public.daily_results where account_id = a.id and balance > 0 order by date desc limit 1), a.open_balance), a.currency), 2),
      'equity_usd', round(public.to_usd(st.equity, a.currency), 2), 'floating_usd', round(public.to_usd(st.floating, a.currency), 2),
      'positions', st.positions, 'dd_now', st.dd_pct, 'last_seen', v_seen,
      'running', v_seen is not null and v_seen > now() - interval '1 day' and a.status = 'active'),
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'kpi', k, 'series', coalesce(v_series, '[]'::jsonb), 'months', coalesce(v_months, '[]'::jsonb), 'days', coalesce(v_days, '[]'::jsonb));
end $$;
grant execute on function public.public_branch(text, date, date) to anon, authenticated;

-- Link chia sẻ của các nhánh mình làm trưởng (để trưởng nhánh tự lấy link gửi khách)
create or replace function public.my_share_links()
returns table (system_id uuid, name text, token text, enabled boolean, has_master boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.share_token, s.share_enabled, s.master_account_id is not null
    from public.systems s
   where s.id in (select public.my_led_systems()) or public.is_admin()
   order by s.name $$;
grant execute on function public.my_share_links() to authenticated;
