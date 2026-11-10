-- =====================================================================
-- LION BOT · bổ sung 1.9.0 (10/11/2026): NHẬN DỮ LIỆU EA THEO SỐ TÀI KHOẢN MT5 + CHỮ KÝ HMAC
--  (theo "YEU_CAU_WEB_LION_BOT_nhan_theo_so_TK" của bên bot, đợt 1)
--  4 hàm mới, gọi bằng khóa anon như cũ, body {"p": {...}}:
--    ingest_status_acc · ingest_daily_acc · ingest_event_acc · ingest_config_acc
--  Xác thực: sig = HMAC-SHA256(BOT_SECRET, "loai|login|server|ts[|thêm]") hex chữ thường; |giờ − ts| ≤ 900 giây.
--  Nhận diện tài khoản bằng (login, server). TK lạ → tự tạo "Chờ duyệt" (chưa tính vào số liệu khách / chia lợi nhuận / công khai).
--  Hai hàm cũ ingest_status / ingest_daily (mã riêng từng TK) GIỮ NGUYÊN.
-- Chạy SAU 009. Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tài khoản: chờ duyệt / chặn / thông tin bot báo
alter table public.accounts alter column customer_id drop not null;
alter table public.accounts add column if not exists approved      boolean not null default true;
alter table public.accounts add column if not exists blocked       boolean not null default false;
alter table public.accounts add column if not exists company       text;
alter table public.accounts add column if not exists source        text not null default 'key';   -- key = mã riêng, acc = theo số TK
alter table public.accounts add column if not exists first_seen    timestamptz;
alter table public.accounts add column if not exists last_seen     timestamptz;
alter table public.accounts add column if not exists bot_reported  text;
alter table public.accounts add column if not exists bot_build     text;   -- bot_version bên bot gửi (vd 2026-11-10)
do $$ begin
  alter table public.accounts add constraint accounts_approved_customer_chk check (not approved or customer_id is not null);
exception when duplicate_object then null; end $$;
create index if not exists accounts_login_idx on public.accounts (account_no);

-- trạng thái: thêm các trường bot gửi
alter table public.account_status add column if not exists credit      numeric;
alter table public.account_status add column if not exists bot_state   text;
alter table public.account_status add column if not exists lots_buy    numeric;
alter table public.account_status add column if not exists lots_sell   numeric;
alter table public.account_status add column if not exists orders      int;
alter table public.account_status add column if not exists basket_pnl  numeric;
alter table public.account_status add column if not exists basket_mode text;
alter table public.account_status add column if not exists gong        boolean;
alter table public.account_status add column if not exists maxdd_pct   numeric;
alter table public.account_status add column if not exists terminal_id text;

-- lịch sử trạng thái (mỗi lần gửi 1 dòng) để vẽ biểu đồ
create table if not exists public.acc_status_hist (
  account_id uuid not null references public.accounts(id) on delete cascade,
  ts         timestamptz not null,
  balance    numeric, equity numeric, floating numeric, dd_pct numeric, credit numeric,
  lots_buy   numeric, lots_sell numeric, orders int, positions int,
  primary key (account_id, ts)
);

-- sự kiện bot (dòng thời gian)
create table if not exists public.acc_events (
  id          bigserial primary key,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  event_id    text not null,
  type        text not null,
  level       text not null,                -- red / orange / info
  time_server text,                         -- giờ sàn "YYYY.MM.DD HH:MM:SS" như bot gửi
  at_server   timestamp,                    -- giờ sàn đã đọc
  received_at timestamptz not null default now(),
  message     text,
  dd_pct numeric, balance numeric, equity numeric, pnl numeric,
  extra       jsonb,
  handled_by  text, handled_at timestamptz,
  unique (account_id, event_id)
);
create index if not exists acc_events_recv_idx on public.acc_events (received_at desc);

-- cài đặt bot đang chạy + lịch sử thay đổi
create table if not exists public.acc_config (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  settings   jsonb not null,
  hash       text,
  updated_at timestamptz not null default now()
);
create table if not exists public.acc_config_hist (
  id         bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  at         timestamptz not null default now(),
  changes    jsonb,                          -- {"tên ô": [cũ, mới]} ; null = lần đầu
  hash       text
);

-- máy đang chạy bot (terminal_id) — phát hiện 1 TK chạy 2 máy
create table if not exists public.acc_terminals (
  account_id  uuid not null references public.accounts(id) on delete cascade,
  terminal_id text not null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (account_id, terminal_id)
);

-- chống gửi trùng + giới hạn tần suất + nhật ký nhận (để dò lỗi với bên bot)
create table if not exists public.ingest_seen (
  key   text primary key,
  ident text not null,
  at    timestamptz not null default now()
);
create index if not exists ingest_seen_ident_idx on public.ingest_seen (ident, at);
create table if not exists public.ingest_log (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  fn     text, login text, server text, ok boolean, error text
);

alter table public.acc_status_hist enable row level security;
alter table public.acc_events      enable row level security;
alter table public.acc_config      enable row level security;
alter table public.acc_config_hist enable row level security;
alter table public.acc_terminals   enable row level security;
alter table public.ingest_seen     enable row level security;
alter table public.ingest_log      enable row level security;
do $$
declare t text;
begin
  foreach t in array array['acc_status_hist','acc_events','acc_config','acc_config_hist','acc_terminals','ingest_log'] loop
    execute format('drop policy if exists editor_read on public.%I', t);
    execute format('create policy editor_read on public.%I for select to authenticated using (public.is_editor())', t);
  end loop;
end $$;
drop policy if exists editor_update on public.acc_events;
create policy editor_update on public.acc_events for update to authenticated using (public.is_editor()) with check (public.is_editor());
grant select on public.acc_status_hist, public.acc_events, public.acc_config, public.acc_config_hist, public.acc_terminals, public.ingest_log to authenticated;
grant update (handled_by, handled_at) on public.acc_events to authenticated;

-- Tài khoản chờ duyệt không vào số tổng công khai
create or replace function public.public_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  with acc as (select a.id, a.currency from public.accounts a where a.status = 'active' and a.approved and a.customer_id is not null),
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

-- ---------------------------------------------------------------- tiện ích
create or replace function public.jnum_safe(j jsonb, p_allow_neg boolean default true) returns numeric
language sql immutable as $$
  select case when x is null or abs(x) > 1e10 or (not p_allow_neg and x < 0) then null else x end
    from (select public.jnum(j) as x) z $$;

create or replace function public.server_norm(s text) returns text language sql immutable as $$
  select lower(regexp_replace(coalesce(s, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- Ghi nhật ký nhận (giữ 3 ngày)
create or replace function public.ingest_note(p_fn text, p jsonb, p_ok boolean, p_err text) returns void
language sql security definer set search_path = public as $$
  insert into public.ingest_log (fn, login, server, ok, error)
  values (p_fn, left(p->>'login', 20), left(p->>'server', 64), p_ok, left(p_err, 200)) $$;

-- Xác thực + tìm / tạo tài khoản. Trả về: err (jsonb trả thẳng cho bot nếu khác null), acc_id, dup (gửi trùng)
create or replace function public.acc_auth(p_fn text, p_kind text, p jsonb, p_extra text,
                                           out err jsonb, out acc_id uuid, out dup boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_login text := trim(coalesce(p->>'login', ''));
  v_server text := trim(coalesce(p->>'server', ''));
  v_ts bigint; v_now bigint := floor(extract(epoch from now()))::bigint;
  v_sig text := lower(trim(coalesce(p->>'sig', '')));
  v_msg text; v_ok boolean := false; s text; a public.accounts; v_ident text; v_cnt int;
begin
  dup := false;
  if v_login !~ '^[0-9]{1,20}$' then err := jsonb_build_object('ok', false, 'error', 'invalid login'); end if;
  if err is null and (v_server = '' or length(v_server) > 64) then err := jsonb_build_object('ok', false, 'error', 'invalid server'); end if;
  if err is null then
    begin v_ts := (p->>'ts')::bigint; exception when others then v_ts := null; end;
    if v_ts is null then err := jsonb_build_object('ok', false, 'error', 'invalid ts'); end if;
  end if;
  if err is null and v_sig !~ '^[0-9a-f]{64}$' then err := jsonb_build_object('ok', false, 'error', 'bad signature'); end if;
  if err is null and abs(v_now - v_ts) > 900 then err := jsonb_build_object('ok', false, 'error', 'stale', 'now', v_now); end if;
  if err is null then
    v_msg := p_kind || '|' || (p->>'login') || '|' || (p->>'server') || '|' || (p->>'ts') || coalesce('|' || p_extra, '');  -- ký đúng chuỗi bot gửi
    for s in select value from bot_config where key in ('bot_secret', 'bot_secret_old') and coalesce(value, '') <> '' loop
      if digest(encode(hmac(convert_to(v_msg, 'UTF8'), convert_to(s, 'UTF8'), 'sha256'), 'hex'), 'sha256') = digest(v_sig, 'sha256') then
        v_ok := true;
      end if;
    end loop;
    if not v_ok then err := jsonb_build_object('ok', false, 'error',
      case when exists (select 1 from bot_config where key = 'bot_secret' and coalesce(value, '') <> '') then 'bad signature' else 'not configured' end); end if;
  end if;
  if err is null then
    v_ident := v_login || '|' || server_norm(v_server);
    -- chống gửi trùng (cùng loại + login + server + ts + phần thêm): bỏ qua nhưng vẫn trả ok
    insert into ingest_seen (key, ident) values (p_kind || '|' || v_ident || '|' || v_ts || '|' || coalesce(p_extra, '') || '|' || coalesce(p->>'event_id', ''), v_ident)
    on conflict (key) do nothing;
    if not found then dup := true; err := jsonb_build_object('ok', true, 'duplicate', true); end if;
  end if;
  if err is null then
    select count(*) into v_cnt from ingest_seen where ident = v_ident and at > now() - interval '60 seconds';
    if v_cnt > 20 then err := jsonb_build_object('ok', false, 'error', 'rate limit'); end if;
  end if;
  if err is null then
    -- tìm tài khoản: đúng (số TK, server) → cùng số TK + server giống (bỏ dấu, hoa thường) → cùng số TK chưa có server / duy nhất
    select * into a from accounts where account_no = v_login and server = v_server limit 1;
    if a.id is null then select * into a from accounts where account_no = v_login and server_norm(server) = server_norm(v_server) limit 1; end if;
    if a.id is null then
      select * into a from accounts where account_no = v_login and (server is null or server = '') limit 1;
      if a.id is null and (select count(*) from accounts where account_no = v_login) = 1 then
        select * into a from accounts where account_no = v_login;
      end if;
    end if;
    if a.id is not null then
      if a.blocked then err := jsonb_build_object('ok', false, 'error', 'blocked');
      else
        update accounts set server = case when not exists (select 1 from accounts x where x.id <> a.id and x.account_no = v_login and coalesce(x.server, '') = v_server)
                                          then v_server else server end,
               company = coalesce(nullif(left(p->>'company', 80), ''), company),
               bot_reported = coalesce(nullif(left(p->>'bot', 60), ''), bot_reported),
               bot_build = coalesce(nullif(left(p->>'bot_version', 40), ''), bot_build),
               first_seen = coalesce(first_seen, now()), last_seen = now()
         where id = a.id;
        acc_id := a.id;
      end if;
    else
      if (select count(*) from accounts where not approved) >= 300 then
        err := jsonb_build_object('ok', false, 'error', 'pending limit');
      else
        insert into accounts (customer_id, account_no, server, broker, company, currency, approved, source, bot_name, bot_reported, bot_build, first_seen, last_seen, status, share_pct)
        values (null, v_login, v_server, nullif(left(p->>'company', 80), ''), nullif(left(p->>'company', 80), ''),
                case when upper(coalesce(p->>'currency', '')) in ('USC', 'USX', 'CENT') then 'USC' else 'USD' end,
                false, 'acc', nullif(left(p->>'bot', 60), ''), nullif(left(p->>'bot', 60), ''), nullif(left(p->>'bot_version', 40), ''), now(), now(), 'active', 30)
        returning id into acc_id;
      end if;
    end if;
  end if;
  if acc_id is not null and coalesce(p->>'terminal_id', '') <> '' then
    insert into acc_terminals (account_id, terminal_id) values (acc_id, left(p->>'terminal_id', 64))
    on conflict (account_id, terminal_id) do update set last_seen = now();
  end if;
  perform ingest_note(p_fn, p, err is null or coalesce((err->>'ok')::boolean, false), case when dup then 'duplicate' else err->>'error' end);
end $$;
revoke all on function public.acc_auth(text, text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4 hàm nhận (khóa anon gọi được, chỉ trả ok / error)
create or replace function public.ingest_status_acc(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare au record;
begin
  if jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'error', 'invalid body'); end if;
  select * into au from acc_auth('status', 'status', p, null);
  if au.err is not null then return au.err; end if;
  insert into account_status as s (account_id, balance, equity, floating, positions, dd_pct, credit, bot_state, lots_buy, lots_sell,
                                   orders, basket_pnl, basket_mode, gong, maxdd_pct, terminal_id, received_at)
  values (au.acc_id, jnum_safe(p->'balance', false), jnum_safe(p->'equity'), jnum_safe(p->'floating'),
          jnum_safe(p->'positions', false)::int, jnum_safe(p->'ddPct'), jnum_safe(p->'credit', false),
          nullif(left(p->>'bot_state', 20), ''), jnum_safe(p->'lots_buy', false), jnum_safe(p->'lots_sell', false),
          jnum_safe(p->'orders', false)::int, jnum_safe(p->'basket_pnl'), nullif(left(p->>'basket_mode', 20), ''),
          case when p->>'gong' in ('1', 'true') then true when p->>'gong' in ('0', 'false') then false end,
          jnum_safe(p->'maxdd_pct', false), nullif(left(p->>'terminal_id', 64), ''), now())
  on conflict (account_id) do update set balance = excluded.balance, equity = excluded.equity, floating = excluded.floating,
    positions = excluded.positions, dd_pct = excluded.dd_pct, credit = excluded.credit, bot_state = excluded.bot_state,
    lots_buy = excluded.lots_buy, lots_sell = excluded.lots_sell, orders = excluded.orders, basket_pnl = excluded.basket_pnl,
    basket_mode = excluded.basket_mode, gong = excluded.gong, maxdd_pct = excluded.maxdd_pct, terminal_id = excluded.terminal_id,
    received_at = now();
  insert into acc_status_hist (account_id, ts, balance, equity, floating, dd_pct, credit, lots_buy, lots_sell, orders, positions)
  values (au.acc_id, now(), jnum_safe(p->'balance', false), jnum_safe(p->'equity'), jnum_safe(p->'floating'), jnum_safe(p->'ddPct'),
          jnum_safe(p->'credit', false), jnum_safe(p->'lots_buy', false), jnum_safe(p->'lots_sell', false),
          jnum_safe(p->'orders', false)::int, jnum_safe(p->'positions', false)::int)
  on conflict do nothing;
  if jnum_safe(p->'equity') is not null then
    insert into equity_hourly as e (account_id, ts, equity, balance)
    values (au.acc_id, date_trunc('hour', now()), jnum_safe(p->'equity'), jnum_safe(p->'balance', false))
    on conflict (account_id, ts) do update set equity = excluded.equity, balance = excluded.balance;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ingest_daily_acc(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare au record; r jsonb; v_key text;
begin
  if jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'error', 'invalid body'); end if;
  if coalesce(p->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    perform ingest_note('daily', p, false, 'invalid date'); return jsonb_build_object('ok', false, 'error', 'invalid date');
  end if;
  select * into au from acc_auth('daily', 'daily', p, p->>'date');
  if au.err is not null then return au.err; end if;
  select ingest_key into v_key from accounts where id = au.acc_id;
  r := ingest_daily((p - 'sig' - 'ts' - 'login' - 'server') || jsonb_build_object('key', v_key));
  if not coalesce((r->>'ok')::boolean, false) then perform ingest_note('daily', p, false, r->>'error'); end if;
  return jsonb_build_object('ok', coalesce((r->>'ok')::boolean, false)) || case when r ? 'error' then jsonb_build_object('error', r->>'error') else '{}'::jsonb end;
end $$;

create or replace function public.ingest_event_acc(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare au record; v_type text := lower(trim(coalesce(p->>'type', ''))); v_lvl text; v_at timestamp;
begin
  if jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'error', 'invalid body'); end if;
  if v_type !~ '^[a-z_]{2,40}$' then perform ingest_note('event', p, false, 'invalid type'); return jsonb_build_object('ok', false, 'error', 'invalid type'); end if;
  if coalesce(p->>'event_id', '') = '' or length(p->>'event_id') > 100 then
    perform ingest_note('event', p, false, 'invalid event_id'); return jsonb_build_object('ok', false, 'error', 'invalid event_id');
  end if;
  select * into au from acc_auth('event', 'event', p, v_type);
  if au.err is not null then return au.err; end if;
  v_lvl := case when v_type in ('maxdd_cut', 'maxdd_hit_stopped', 'error') then 'red'
                when v_type in ('auto_stop', 'manual_stop', 'manual_close', 'bot_stop', 'config_change') then 'orange'
                else 'info' end;
  begin v_at := to_timestamp(p->>'time', 'YYYY.MM.DD HH24:MI:SS')::timestamp; exception when others then v_at := null; end;
  insert into acc_events (account_id, event_id, type, level, time_server, at_server, message, dd_pct, balance, equity, pnl, extra)
  values (au.acc_id, left(p->>'event_id', 100), v_type, v_lvl, left(p->>'time', 30), v_at, left(p->>'message', 4000),
          jnum_safe(p->'dd_pct'), jnum_safe(p->'balance', false), jnum_safe(p->'equity'), jnum_safe(p->'pnl'),
          p - 'sig' - 'ts' - 'login' - 'server' - 'type' - 'event_id' - 'time' - 'message' - 'dd_pct' - 'balance' - 'equity' - 'pnl')
  on conflict (account_id, event_id) do nothing;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ingest_config_acc(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare au record; v_old public.acc_config; v_set jsonb := p->'settings'; v_hash text; v_chg jsonb;
begin
  if jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'error', 'invalid body'); end if;
  if jsonb_typeof(v_set) <> 'object' or (select count(*) from jsonb_object_keys(v_set)) > 300 or length(v_set::text) > 60000 then
    perform ingest_note('config', p, false, 'invalid settings'); return jsonb_build_object('ok', false, 'error', 'invalid settings');
  end if;
  select * into au from acc_auth('config', 'config', p, null);
  if au.err is not null then return au.err; end if;
  v_hash := coalesce(nullif(left(p->>'hash', 100), ''), md5(v_set::text));
  select * into v_old from acc_config where account_id = au.acc_id;
  if v_old.account_id is null then
    insert into acc_config (account_id, settings, hash) values (au.acc_id, v_set, v_hash);
    insert into acc_config_hist (account_id, changes, hash) values (au.acc_id, null, v_hash);
  elsif v_old.hash is distinct from v_hash or v_old.settings <> v_set then
    select jsonb_object_agg(k, jsonb_build_array(v_old.settings->k, v_set->k)) into v_chg
      from (select jsonb_object_keys(v_old.settings) k union select jsonb_object_keys(v_set)) ks
     where (v_old.settings->k) is distinct from (v_set->k);
    update acc_config set settings = v_set, hash = v_hash, updated_at = now() where account_id = au.acc_id;
    if v_chg is not null then insert into acc_config_hist (account_id, changes, hash) values (au.acc_id, v_chg, v_hash); end if;
  else
    update acc_config set updated_at = now() where account_id = au.acc_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.ingest_status_acc(jsonb), public.ingest_daily_acc(jsonb), public.ingest_event_acc(jsonb), public.ingest_config_acc(jsonb)
  to anon, authenticated;

-- ---------------------------------------------------------------- màn Kết nối bot (chỉ quản lý)
create or replace function public.bot_link_settings() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare v1 text; v2 text;
begin
  if not public.is_admin() then raise exception 'Chỉ quản lý'; end if;
  select value into v1 from bot_config where key = 'bot_secret';
  select value into v2 from bot_config where key = 'bot_secret_old';
  return jsonb_build_object(
    'has_secret', coalesce(v1, '') <> '', 'hint', case when coalesce(v1, '') <> '' then left(v1, 4) || '…' || right(v1, 4) || ' (' || length(v1) || ' ký tự)' end,
    'has_old', coalesce(v2, '') <> '', 'hint_old', case when coalesce(v2, '') <> '' then left(v2, 4) || '…' || right(v2, 4) end,
    'selftest', (select jsonb_agg(jsonb_build_object('msg', m, 'ok', encode(hmac(convert_to(m, 'UTF8'), convert_to('TEST_SECRET_123', 'UTF8'), 'sha256'), 'hex') = e))
                   from (values ('status|12345678|BrokerDemo-Server|1762750800', '419f866bef1526ada9ab67b73e1199062cc2ffbb68c4f70381d1efd658c8490c'),
                                ('daily|12345678|BrokerDemo-Server|1762750800|2026-11-09', 'a2d3f91fc026dc930770663ab31d34248e1f80f647947ef07aa732c332aa3209'),
                                ('event|12345678|BrokerDemo-Server|1762750800|maxdd_cut', '7dcf8e769ffc414ec463f12805ee9d123cd357c64c114351dea156932866b5b6'),
                                ('config|12345678|BrokerDemo-Server|1762750800', '87455b61338361da9ee978ca5c9a519e817dfa40b333fce8ad0949210a38c2f4')) v(m, e)),
    'now', floor(extract(epoch from now()))::bigint,
    'log', coalesce((select jsonb_agg(to_jsonb(l) order by l.id desc) from (select * from ingest_log order by id desc limit 60) l), '[]'::jsonb),
    'stats', (select jsonb_build_object('calls_24h', count(*), 'ok_24h', count(*) filter (where ok), 'accounts_24h', count(distinct login))
                from ingest_log where at > now() - interval '24 hours'));
end $$;

create or replace function public.bot_secret_set(p_secret text, p_keep_old boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cur text;
begin
  if not public.is_admin() then raise exception 'Chỉ quản lý'; end if;
  if length(coalesce(p_secret, '')) < 32 or p_secret ~ '\s' or p_secret ~ '\|' then raise exception 'Mã bí mật cần ≥ 32 ký tự, không có khoảng trắng hay dấu |'; end if;
  select value into v_cur from bot_config where key = 'bot_secret';
  if p_keep_old and coalesce(v_cur, '') <> '' and v_cur <> p_secret then
    insert into bot_config values ('bot_secret_old', v_cur) on conflict (key) do update set value = excluded.value;
  end if;
  insert into bot_config values ('bot_secret', p_secret) on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bot_secret_generate(p_keep_old boolean default true) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v text := encode(gen_random_bytes(32), 'hex');
begin
  perform public.bot_secret_set(v, p_keep_old);
  return v;
end $$;

create or replace function public.bot_secret_reveal() returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Chỉ quản lý'; end if;
  return (select value from bot_config where key = 'bot_secret');
end $$;

create or replace function public.bot_secret_drop_old() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Chỉ quản lý'; end if;
  delete from bot_config where key = 'bot_secret_old';
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.bot_link_settings(), public.bot_secret_set(text, boolean), public.bot_secret_generate(boolean),
  public.bot_secret_reveal(), public.bot_secret_drop_old() to authenticated;

-- ---------------------------------------------------------------- dọn dữ liệu (gọi trong news_tick mỗi giờ)
create or replace function public.ingest_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from public.ingest_seen where at < now() - interval '2 days';
  delete from public.ingest_log where at < now() - interval '3 days';
  -- lịch sử trạng thái: giữ chi tiết 90 ngày (đợt sau sẽ gộp 1 giờ/điểm cho dữ liệu cũ hơn)
  delete from public.acc_status_hist where ts < now() - interval '180 days';
$$;
revoke all on function public.ingest_cleanup() from public, anon, authenticated;
do $$ begin perform cron.schedule('lionbot-ingest-cleanup', '17 * * * *', 'select public.ingest_cleanup()'); exception when others then raise notice 'pg_cron chưa có: %', sqlerrm; end $$;
