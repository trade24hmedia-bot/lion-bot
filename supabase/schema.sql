-- =====================================================================
-- LION BOT · cơ sở dữ liệu (Supabase / PostgreSQL)
-- Phiên bản schema: 1.0.0 (04/11/2026)
--
-- Cách chạy: Supabase → SQL Editor → New query → dán toàn bộ file → Run.
-- Chạy lại nhiều lần vẫn an toàn (create if not exists / or replace).
--
-- Nguyên tắc bảo mật:
--  * Khách hàng KHÔNG đọc thẳng bảng nào. Khách chỉ gọi các hàm portal_*,
--    hàm tự lọc tài khoản của khách + tuyến dưới và che số tài khoản.
--  * Team (admin / tech / core) đọc bảng qua phân quyền dòng (RLS).
--  * EA gửi dữ liệu qua ingest_daily / ingest_status bằng mã khóa riêng
--    của từng tài khoản (accounts.ingest_key). Sai mã = bị từ chối.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- bảng
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text unique,
  phone       text,
  system_id   uuid,
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists public.systems (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  parent_id           uuid references public.systems(id) on delete restrict,
  leader_customer_id  uuid references public.customers(id) on delete set null,
  note                text,
  created_at          timestamptz not null default now()
);

do $$ begin
  alter table public.customers add constraint customers_system_fk
    foreign key (system_id) references public.systems(id) on delete restrict;
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text unique,
  full_name    text,
  role         text not null default 'customer' check (role in ('admin','tech','core','customer')),
  customer_id  uuid references public.customers(id) on delete set null,
  lang         text not null default 'vi',
  created_at   timestamptz not null default now()
);

create table if not exists public.accounts (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id) on delete restrict,
  account_no    text not null,
  broker        text,
  server        text,
  platform      text not null default 'MT5',
  currency      text not null default 'USD' check (currency in ('USD','USC')),
  share_pct     numeric not null default 30 check (share_pct between 0 and 100),
  bot_name      text,
  package       text,
  bot_start     date,
  bot_end       date,
  status        text not null default 'active' check (status in ('active','stopped')),
  open_balance  numeric,
  open_date     date,
  note          text,
  ingest_key    text not null unique default encode(gen_random_bytes(18), 'hex'),
  created_at    timestamptz not null default now()
);
create unique index if not exists accounts_no_server_uq on public.accounts (account_no, coalesce(server, ''));

-- Kết quả theo ngày (giờ sàn). Mỗi tài khoản mỗi ngày 1 dòng, gửi lại thì ghi đè.
create table if not exists public.daily_results (
  account_id   uuid not null references public.accounts(id) on delete cascade,
  date         date not null,
  profit       numeric not null default 0,
  swap         numeric not null default 0,
  fee          numeric not null default 0,
  net          numeric not null default 0,
  balance      numeric,
  lots         numeric,
  deposit      numeric,
  withdraw     numeric,
  other        numeric,
  trades       integer,
  dd_max_pct   numeric,
  received_at  timestamptz not null default now(),
  primary key (account_id, date)
);

-- Từng giao dịch nạp / rút / bonus / credit (khóa = mã deal MT5, gửi lại không trùng)
create table if not exists public.transfers (
  id          bigserial primary key,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  ticket      text not null,
  date        date not null,
  type        text not null check (type in ('deposit','withdraw','bonus','credit','other')),
  amount      numeric not null,
  time_text   text,
  comment     text,
  source      text not null default 'ea',
  created_at  timestamptz not null default now(),
  unique (account_id, ticket)
);

-- Trạng thái lúc này (PNL chưa chốt). Mỗi tài khoản 1 dòng, ghi đè.
create table if not exists public.account_status (
  account_id   uuid primary key references public.accounts(id) on delete cascade,
  balance      numeric,
  equity       numeric,
  floating     numeric,
  positions    integer,
  dd_pct       numeric,
  received_at  timestamptz not null default now()
);

-- Equity theo giờ để vẽ biểu đồ.
create table if not exists public.equity_hourly (
  account_id  uuid not null references public.accounts(id) on delete cascade,
  ts          timestamptz not null,
  equity      numeric,
  balance     numeric,
  primary key (account_id, ts)
);

create index if not exists daily_results_date_idx on public.daily_results (date);
create index if not exists transfers_acc_date_idx on public.transfers (account_id, date);
create index if not exists customers_system_idx on public.customers (system_id);
create index if not exists accounts_customer_idx on public.accounts (customer_id);

-- ---------------------------------------------------------------- tiện ích
create or replace function public.to_usd(v numeric, cur text) returns numeric
language sql immutable as $$ select case when cur = 'USC' then v / 100 else v end $$;

create or replace function public.jnum(j jsonb) returns numeric
language sql immutable as $$
  select case
    when j is null then null
    when jsonb_typeof(j) = 'number' then (j #>> '{}')::numeric
    when jsonb_typeof(j) = 'string' and (j #>> '{}') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then trim(j #>> '{}')::numeric
    else null end $$;

-- ---------------------------------------------------------------- vai trò
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin','tech','core'), false) $$;

create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin','tech'), false) $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false) $$;

create or replace function public.my_customer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select customer_id from public.profiles where id = auth.uid() $$;

-- Các nhánh khách đang làm leader (gồm mọi nhánh con, không giới hạn tầng)
create or replace function public.my_led_systems() returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive led as (
    select s.id from public.systems s
     where s.leader_customer_id is not null and s.leader_customer_id = public.my_customer_id()
    union
    select s.id from public.systems s join led on s.parent_id = led.id
  ) select id from led $$;

-- Khách hàng người đang đăng nhập được xem: chính mình + mọi khách trong nhánh mình làm leader.
-- Team (admin / tech / core): tất cả.
create or replace function public.visible_customer_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.customers c where public.is_staff()
  union
  select public.my_customer_id() where public.my_customer_id() is not null
  union
  select c.id from public.customers c where c.system_id in (select public.my_led_systems()) $$;

create or replace function public.can_see_account(p_account uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.accounts a
                  where a.id = p_account and a.customer_id in (select public.visible_customer_ids())) $$;

-- ---------------------------------------------------------------- tài khoản đăng nhập
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, customer_id)
  values (new.id, lower(new.email),
          (select c.id from public.customers c where lower(c.email) = lower(new.email) limit 1))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Thêm / sửa email khách → tự gắn với tài khoản đăng nhập cùng email
create or replace function public.link_customer_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null then
    new.email := lower(trim(new.email));
    update public.profiles set customer_id = new.id
     where lower(email) = new.email and (customer_id is null or customer_id = new.id);
  end if;
  return new;
end $$;

drop trigger if exists customers_link_email on public.customers;
create trigger customers_link_email before insert or update of email on public.customers
  for each row execute function public.link_customer_email();

-- ---------------------------------------------------------------- phân quyền dòng
alter table public.customers      enable row level security;
alter table public.systems        enable row level security;
alter table public.profiles       enable row level security;
alter table public.accounts       enable row level security;
alter table public.daily_results  enable row level security;
alter table public.transfers      enable row level security;
alter table public.account_status enable row level security;
alter table public.equity_hourly  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['customers','systems','accounts','daily_results','transfers','account_status','equity_hourly'] loop
    execute format('drop policy if exists staff_read on public.%I', t);
    execute format('drop policy if exists editor_write on public.%I', t);
    execute format('create policy staff_read on public.%I for select to authenticated using (public.is_staff())', t);
    execute format('create policy editor_write on public.%I for all to authenticated using (public.is_editor()) with check (public.is_editor())', t);
  end loop;
end $$;

drop policy if exists profile_self_read on public.profiles;
drop policy if exists profile_admin_write on public.profiles;
create policy profile_self_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profile_admin_write on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- nhận dữ liệu từ EA
-- POST https://<project>.supabase.co/rest/v1/rpc/ingest_daily
-- headers: apikey: <anon key>, Authorization: Bearer <anon key>, Content-Type: application/json
-- body: {"p": {"key":"<ingest_key>","date":"2026-11-02","profit":..,"swap":..,"fee":..,"net":..,
--              "balance":..,"lots":..,"trades":..,"ddMaxPct":..,
--              "transfers":[{"type":"deposit|withdraw|bonusIn|bonusOut|creditIn|creditOut",
--                            "ticket":"597775518","amount":30000,"time":"2026.11.03 15:26:04","comment":"…"}]}}
create or replace function public.ingest_daily(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.accounts;
  d date;
  t jsonb;
  ty text;
  amt numeric;
  n_tr int := 0;
begin
  select * into a from public.accounts where ingest_key = p->>'key';
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid key'); end if;
  begin d := (p->>'date')::date;
  exception when others then return jsonb_build_object('ok', false, 'error', 'invalid date'); end;
  if d is null or d > current_date + 1 or d < date '2020-01-01' then
    return jsonb_build_object('ok', false, 'error', 'invalid date');
  end if;

  insert into public.daily_results as r (account_id, date, profit, swap, fee, net, balance, lots,
         deposit, withdraw, other, trades, dd_max_pct, received_at)
  values (a.id, d,
          coalesce(public.jnum(p->'profit'), 0), coalesce(public.jnum(p->'swap'), 0), coalesce(public.jnum(p->'fee'), 0),
          coalesce(public.jnum(p->'net'),
                   coalesce(public.jnum(p->'profit'),0) + coalesce(public.jnum(p->'swap'),0) + coalesce(public.jnum(p->'fee'),0)),
          nullif(public.jnum(p->'balance'), 0), public.jnum(p->'lots'),
          public.jnum(p->'deposit'), abs(public.jnum(p->'withdraw')), public.jnum(p->'other'),
          public.jnum(p->'trades')::int, public.jnum(p->'ddMaxPct'), now())
  on conflict (account_id, date) do update set
    profit = excluded.profit, swap = excluded.swap, fee = excluded.fee, net = excluded.net,
    balance = coalesce(excluded.balance, r.balance), lots = excluded.lots,
    deposit = excluded.deposit, withdraw = excluded.withdraw, other = excluded.other,
    trades = excluded.trades, dd_max_pct = excluded.dd_max_pct, received_at = now();

  if jsonb_typeof(p->'transfers') = 'array' then
    for t in select * from jsonb_array_elements(p->'transfers') limit 200 loop
      ty := case t->>'type'
              when 'deposit' then 'deposit' when 'withdraw' then 'withdraw'
              when 'bonusIn' then 'bonus' when 'bonusOut' then 'bonus'
              when 'creditIn' then 'credit' when 'creditOut' then 'credit'
              else 'other' end;
      amt := public.jnum(t->'amount');
      continue when amt is null or coalesce(t->>'ticket', '') = '';
      if ty in ('deposit','withdraw') then amt := abs(amt); end if;
      insert into public.transfers (account_id, ticket, date, type, amount, time_text, comment)
      values (a.id, left(t->>'ticket', 40), d, ty, amt, left(t->>'time', 30), left(t->>'comment', 200))
      on conflict (account_id, ticket) do update set
        type = excluded.type, amount = excluded.amount, time_text = excluded.time_text, comment = excluded.comment;
      n_tr := n_tr + 1;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'account', a.account_no, 'date', d, 'transfers', n_tr);
end $$;

-- POST …/rest/v1/rpc/ingest_status  body: {"p":{"key":"…","balance":..,"equity":..,"floating":..,"positions":..,"ddPct":..}}
create or replace function public.ingest_status(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a_id uuid;
begin
  select id into a_id from public.accounts where ingest_key = p->>'key';
  if a_id is null then return jsonb_build_object('ok', false, 'error', 'invalid key'); end if;
  insert into public.account_status as s (account_id, balance, equity, floating, positions, dd_pct, received_at)
  values (a_id, public.jnum(p->'balance'), public.jnum(p->'equity'), public.jnum(p->'floating'),
          public.jnum(p->'positions')::int, public.jnum(p->'ddPct'), now())
  on conflict (account_id) do update set balance = excluded.balance, equity = excluded.equity,
    floating = excluded.floating, positions = excluded.positions, dd_pct = excluded.dd_pct, received_at = now();
  if public.jnum(p->'equity') is not null then
    insert into public.equity_hourly as e (account_id, ts, equity, balance)
    values (a_id, date_trunc('hour', now()), public.jnum(p->'equity'), public.jnum(p->'balance'))
    on conflict (account_id, ts) do update set equity = excluded.equity, balance = excluded.balance;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- số liệu tài khoản
-- Số dư mới nhất do EA báo (hoặc số dư ban đầu nhập tay nếu chưa có)
create or replace function public.acc_capital(p_account uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select balance from public.daily_results where account_id = p_account and balance is not null order by date desc limit 1),
    (select open_balance from public.accounts where id = p_account)) $$;

-- Vốn đầu kỳ tại ngày p_from (số dư cuối ngày gần nhất trước đó; chưa có thì lùi từ ngày đầu tiên có số dư)
create or replace function public.acc_start_balance(p_account uuid, p_from date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select balance from public.daily_results
      where account_id = p_account and date < p_from and balance is not null order by date desc limit 1),
    (select f.balance - f.net
            - coalesce((select sum(case when t.type = 'withdraw' then -t.amount when t.type = 'credit' then 0 else t.amount end)
                          from public.transfers t where t.account_id = p_account and t.date = f.date), 0)
       from public.daily_results f
      where f.account_id = p_account and f.date >= p_from and f.balance is not null
      order by f.date limit 1),
    (select open_balance from public.accounts where id = p_account)) $$;

-- ---------------------------------------------------------------- cổng khách hàng
create or replace function public.portal_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'email', p.email, 'role', p.role, 'lang', p.lang,
    'customer', (select jsonb_build_object('id', c.id, 'name', c.name) from public.customers c where c.id = p.customer_id),
    'is_leader', exists (select 1 from public.my_led_systems()))
  from public.profiles p where p.id = auth.uid() $$;

create or replace function public.mask_no(no text) returns text
language sql stable security definer set search_path = public as $$
  select case when public.is_staff() then no else '•••• ' || right(no, 4) end $$;

create or replace function public.portal_accounts()
returns table (id uuid, account_mask text, broker text, currency text, customer_name text, system_id uuid, system_name text,
               is_mine boolean, status text, share_pct numeric,
               capital numeric, capital_usd numeric, profit_total numeric, profit_total_usd numeric,
               profit_month numeric, profit_month_usd numeric, growth_month_pct numeric, last_seen timestamptz)
language sql stable security definer set search_path = public as $$
  with acc as (
    select a.*, c.name as cname, c.system_id as sys, s.name as sname,
           public.acc_capital(a.id) as cap,
           (select coalesce(sum(net), 0) from public.daily_results r where r.account_id = a.id) as pt,
           (select coalesce(sum(net), 0) from public.daily_results r
             where r.account_id = a.id and r.date >= date_trunc('month', current_date)::date) as pm,
           public.acc_start_balance(a.id, date_trunc('month', current_date)::date) as sb,
           greatest((select max(received_at) from public.daily_results r where r.account_id = a.id),
                    (select received_at from public.account_status st where st.account_id = a.id)) as seen
      from public.accounts a
      join public.customers c on c.id = a.customer_id
      left join public.systems s on s.id = c.system_id
     where a.customer_id in (select public.visible_customer_ids())
  )
  select id, public.mask_no(account_no), broker, currency, cname, sys, sname,
         coalesce(customer_id = public.my_customer_id(), false) or (public.is_staff() and public.my_customer_id() is null) as mine,
         status, share_pct,
         cap, round(public.to_usd(cap, currency), 2), pt, round(public.to_usd(pt, currency), 2), pm, round(public.to_usd(pm, currency), 2),
         case when sb > 0 then round(pm / sb * 100, 2) end, seen
    from acc order by mine desc, cname, account_no $$;

-- Lãi lũy kế theo ngày (USD) của các tài khoản được xem; p_account null = tất cả của mình
create or replace function public.portal_series(p_account uuid default null, p_scope text default 'mine', p_from date default null)
returns table (date date, net_usd numeric, cum_profit_usd numeric, balance numeric)
language sql stable security definer set search_path = public as $$
  with acc as (
    select a.id, a.currency from public.accounts a
     where a.customer_id in (select public.visible_customer_ids())
       and (p_account is null or a.id = p_account)
       and (p_account is not null or p_scope = 'all'
            or a.customer_id = public.my_customer_id()
            or (public.is_staff() and public.my_customer_id() is null))
  ), d as (
    select r.date, sum(public.to_usd(r.net, acc.currency)) as net_usd,
           case when p_account is not null then max(r.balance) end as bal
      from public.daily_results r join acc on acc.id = r.account_id
     group by r.date
  )
  select date, round(net_usd, 2), round(sum(net_usd) over (order by date), 2), bal
    from d where p_from is null or date >= p_from order by date $$;

-- Kết quả theo tháng của một tài khoản
create or replace function public.portal_months(p_account uuid)
returns table (month date, net numeric, net_usd numeric, deposit numeric, withdraw numeric, start_balance numeric, pct numeric)
language sql stable security definer set search_path = public as $$
  with a as (select id, currency from public.accounts where id = p_account and public.can_see_account(p_account)),
  m as (
    select date_trunc('month', r.date)::date as month, sum(r.net) as net
      from public.daily_results r join a on a.id = r.account_id group by 1
  )
  select m.month, round(m.net, 2), round(public.to_usd(m.net, a.currency), 2),
         (select coalesce(sum(amount), 0) from public.transfers t
           where t.account_id = a.id and t.type = 'deposit' and date_trunc('month', t.date) = m.month),
         (select coalesce(sum(amount), 0) from public.transfers t
           where t.account_id = a.id and t.type = 'withdraw' and date_trunc('month', t.date) = m.month),
         public.acc_start_balance(a.id, m.month) as sb,
         case when public.acc_start_balance(a.id, m.month) > 0
              then round(m.net / public.acc_start_balance(a.id, m.month) * 100, 2) end
    from m cross join a order by m.month desc $$;

create or replace function public.portal_transfers(p_account uuid, p_limit int default 30)
returns table (date date, type text, amount numeric, amount_usd numeric, time_text text)
language sql stable security definer set search_path = public as $$
  select t.date, t.type, t.amount, public.to_usd(t.amount, a.currency), t.time_text
    from public.transfers t join public.accounts a on a.id = t.account_id
   where t.account_id = p_account and public.can_see_account(p_account) and t.type in ('deposit','withdraw')
   order by t.date desc, t.id desc limit least(p_limit, 200) $$;

-- Cây hệ thống người đang đăng nhập được xem, kèm số tổng mỗi nhánh (gồm nhánh con)
create or replace function public.portal_tree()
returns table (id uuid, parent_id uuid, name text, leader_name text, own_accounts int, accounts int,
               capital_usd numeric, profit_month_usd numeric)
language sql stable security definer set search_path = public as $$
  with recursive vis as (
    select s.id from public.systems s where public.is_staff()
    union select x from public.my_led_systems() x
  ),
  sub(root, id) as (
    select v.id, v.id from vis v
    union all
    select sub.root, s.id from sub join public.systems s on s.parent_id = sub.id
  ),
  acc as (
    select a.id, c.system_id, public.to_usd(public.acc_capital(a.id), a.currency) as cap_usd,
           public.to_usd((select coalesce(sum(net), 0) from public.daily_results r
                           where r.account_id = a.id and r.date >= date_trunc('month', current_date)::date), a.currency) as pm_usd
      from public.accounts a join public.customers c on c.id = a.customer_id
  )
  select s.id, case when s.parent_id in (select id from vis) then s.parent_id end, s.name,
         (select c.name from public.customers c where c.id = s.leader_customer_id),
         (select count(*)::int from acc where acc.system_id = s.id),
         (select count(*)::int from acc where acc.system_id in (select sub.id from sub where sub.root = s.id)),
         (select round(coalesce(sum(cap_usd), 0), 2) from acc where acc.system_id in (select sub.id from sub where sub.root = s.id)),
         (select round(coalesce(sum(pm_usd), 0), 2) from acc where acc.system_id in (select sub.id from sub where sub.root = s.id))
    from public.systems s where s.id in (select id from vis) order by s.name $$;

-- ---------------------------------------------------------------- trang công khai (không cần đăng nhập)
create or replace function public.public_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  with acc as (select a.id, a.currency from public.accounts a where a.status = 'active'),
  cap as (select coalesce(sum(public.to_usd(public.acc_capital(acc.id), acc.currency)), 0) v from acc),
  d as (
    select r.date, sum(public.to_usd(r.net, acc.currency)) as net_usd
      from public.daily_results r join acc on acc.id = r.account_id group by r.date
  ),
  mon as (
    select date_trunc('month', r.date)::date as month,
           sum(public.to_usd(r.net, acc.currency)) as net_usd,
           sum(public.to_usd(public.acc_start_balance(acc.id, date_trunc('month', r.date)::date), acc.currency))
             filter (where r.date = (select min(r2.date) from public.daily_results r2
                                       where r2.account_id = r.account_id
                                         and date_trunc('month', r2.date) = date_trunc('month', r.date))) as start_usd
      from public.daily_results r join acc on acc.id = r.account_id group by 1
  )
  select jsonb_build_object(
    'capital_usd', (select round(v, 2) from cap),
    'profit_total_usd', (select round(coalesce(sum(net_usd), 0), 2) from d),
    'accounts', (select count(*) from acc),
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', month, 'net_usd', round(net_usd, 2),
                         'pct', case when start_usd > 0 then round(net_usd / start_usd * 100, 2) end) order by month) from mon), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(jsonb_build_object('date', date, 'cum', round(c, 2)) order by date)
                        from (select date, sum(net_usd) over (order by date) c from d) z), '[]'::jsonb),
    'updated_at', now()) $$;

-- ---------------------------------------------------------------- quyền gọi hàm
revoke execute on all functions in schema public from public;
grant execute on function public.ingest_daily(jsonb), public.ingest_status(jsonb), public.public_summary() to anon, authenticated;
grant execute on function public.portal_me(), public.portal_accounts(), public.portal_series(uuid, text, date),
  public.portal_months(uuid), public.portal_transfers(uuid, int), public.portal_tree(),
  public.my_role(), public.is_staff(), public.is_editor(), public.is_admin(), public.my_customer_id(),
  public.my_led_systems(), public.visible_customer_ids(), public.can_see_account(uuid), public.mask_no(text),
  public.acc_capital(uuid), public.acc_start_balance(uuid, date), public.to_usd(numeric, text), public.jnum(jsonb)
  to authenticated;
grant execute on function public.to_usd(numeric, text), public.jnum(jsonb), public.acc_capital(uuid),
  public.acc_start_balance(uuid, date) to anon;

-- Đặt quản lý đầu tiên (chạy SAU khi người đó đăng nhập web lần đầu):
-- update public.profiles set role = 'admin' where email = 'email-cua-anh@gmail.com';
