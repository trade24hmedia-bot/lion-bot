-- =====================================================================
-- LION BOT · bổ sung 1.2.0 (04/11/2026): tài chính, CHỈ QUẢN LÝ (admin)
--  * Số dư & nạp rút: đối chiếu đầu kỳ + nạp − rút + điều chỉnh + lãi/lỗ = cuối kỳ, so với số dư EA báo
--  * Chia lợi nhuận theo tháng: phải thu / đã thu / còn nợ, ghi các lần thu
--  * Bot ngừng gửi dữ liệu (đếm ngày giao dịch, bỏ thứ 7, chủ nhật)
--  * Kết quả ngày, nạp rút, trạng thái: chỉ quản lý đọc thẳng; kỹ thuật chỉ thấy "lần cuối EA gửi"
-- Chạy SAU schema.sql và 002. Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================

-- Kỳ chia lợi nhuận sửa tay (để trống = tự tính từ kết quả ngày + tỷ lệ của tài khoản)
create table if not exists public.profit_periods (
  account_id           uuid not null references public.accounts(id) on delete cascade,
  period               date not null,          -- ngày 1 của tháng
  profit_override_usd  numeric,
  share_pct            numeric check (share_pct between 0 and 100),
  note                 text,
  updated_by           text,
  updated_at           timestamptz not null default now(),
  primary key (account_id, period)
);

-- Các lần thu tiền chia lợi nhuận
create table if not exists public.profit_payments (
  id          bigserial primary key,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  period      date not null,
  amount_usd  numeric not null,
  paid_at     date not null default current_date,
  note        text,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists profit_payments_acc_idx on public.profit_payments (account_id, period);

alter table public.profit_periods  enable row level security;
alter table public.profit_payments enable row level security;

-- Số liệu tiền: chỉ quản lý đọc / ghi trực tiếp
do $$
declare t text;
begin
  foreach t in array array['daily_results','transfers','account_status','equity_hourly','profit_periods','profit_payments'] loop
    execute format('drop policy if exists staff_read on public.%I', t);
    execute format('drop policy if exists editor_write on public.%I', t);
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;
grant select, insert, update, delete on public.profit_periods, public.profit_payments to authenticated;
grant usage, select on sequence public.profit_payments_id_seq to authenticated;

-- ---------------------------------------------------------------- tiện ích
create or replace function public.vn_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

-- Số ngày giao dịch (thứ 2–6) sau d1 đến hết d2
create or replace function public.workdays_between(d1 date, d2 date) returns int
language sql immutable as $$
  select count(*)::int from generate_series(d1 + 1, d2, interval '1 day') g where extract(isodow from g) < 6 $$;

-- Lần cuối EA gửi (kết quả ngày hoặc trạng thái) của mỗi tài khoản. Cả team xem được (không có số tiền).
create or replace function public.staff_ea_seen()
returns table (account_id uuid, last_date date, last_seen timestamptz, stale_days int)
language sql stable security definer set search_path = public as $$
  select a.id,
         (select max(r.date) from public.daily_results r where r.account_id = a.id),
         s.seen,
         case when s.seen is not null then public.workdays_between((s.seen at time zone 'Asia/Ho_Chi_Minh')::date, public.vn_today()) end
    from public.accounts a
    cross join lateral (select greatest((select max(received_at) from public.daily_results r where r.account_id = a.id),
                                        (select received_at from public.account_status st where st.account_id = a.id)) as seen) s
   where public.is_staff() $$;

-- ---------------------------------------------------------------- đối chiếu một tài khoản trong khoảng ngày
-- Cuối kỳ (tính) = đầu kỳ + nạp − rút + điều chỉnh (bonus, khác) + lãi/lỗ ròng. Credit nằm ngoài số dư nên không tính.
-- Đầu kỳ: số dư EA ngày gần nhất trước kỳ (+ biến động đến đầu kỳ); chưa có thì lùi từ ngày đầu tiên trong kỳ có số dư;
--         chưa có nữa thì lấy số dư ban đầu nhập tay.
create or replace function public.acc_period(p_account uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a public.accounts;
  v_net numeric; v_days int; v_dep numeric; v_wd numeric; v_oth numeric; v_ea int;
  v_last numeric; v_last_d date;
  v_base numeric; v_from text := '';
  r record;
  v_close numeric;
begin
  if not public.is_admin() then return null; end if;
  select * into a from public.accounts where id = p_account;
  if not found then return null; end if;

  select coalesce(sum(net), 0), count(*) into v_net, v_days
    from public.daily_results where account_id = a.id and date between p_from and p_to;
  select balance, date into v_last, v_last_d from public.daily_results
   where account_id = a.id and date between p_from and p_to and balance > 0 order by date desc limit 1;
  select coalesce(sum(amount) filter (where type = 'deposit'), 0),
         coalesce(sum(amount) filter (where type = 'withdraw'), 0),
         coalesce(sum(amount) filter (where type in ('bonus','other')), 0),
         count(*) filter (where source = 'ea')
    into v_dep, v_wd, v_oth, v_ea
    from public.transfers where account_id = a.id and date between p_from and p_to;

  select date, balance into r from public.daily_results
   where account_id = a.id and date < p_from and balance > 0 order by date desc limit 1;
  if found then
    v_base := r.balance
      + coalesce((select sum(case when type = 'withdraw' then -amount else amount end) from public.transfers
                   where account_id = a.id and type <> 'credit' and date > r.date and date < p_from), 0)
      + coalesce((select sum(net) from public.daily_results where account_id = a.id and date > r.date and date < p_from), 0);
    v_from := 'EA';
  else
    select date, balance into r from public.daily_results
     where account_id = a.id and date >= p_from and balance > 0 order by date limit 1;
    if found then
      v_base := r.balance
        - coalesce((select sum(case when type = 'withdraw' then -amount else amount end) from public.transfers
                     where account_id = a.id and type <> 'credit' and date >= p_from and date <= r.date), 0)
        - coalesce((select sum(net) from public.daily_results where account_id = a.id and date >= p_from and date <= r.date), 0);
      v_from := 'EA';
    elsif a.open_balance is not null and a.open_date is not null then
      v_base := a.open_balance + case when a.open_date < p_from then
          coalesce((select sum(case when type = 'withdraw' then -amount else amount end) from public.transfers
                     where account_id = a.id and type <> 'credit' and date >= a.open_date and date < p_from), 0)
        + coalesce((select sum(net) from public.daily_results where account_id = a.id and date >= a.open_date and date < p_from), 0)
        else 0 end;
      v_from := 'tay';
    end if;
  end if;

  v_close := case when v_base is not null then round(v_base + v_dep - v_wd + v_oth + v_net, 2) end;
  return jsonb_build_object(
    'open', round(v_base, 2), 'open_from', v_from, 'dep', round(v_dep, 2), 'wd', round(v_wd, 2), 'other', round(v_oth, 2),
    'net', round(v_net, 2), 'days', v_days, 'ea_flows', v_ea, 'close', v_close,
    'ea_bal', round(v_last, 2), 'ea_bal_date', v_last_d,
    'diff', case when v_close is not null and v_last is not null then round(v_last - v_close, 2) end);
end $$;

-- ---------------------------------------------------------------- màn Số dư & nạp rút (quản lý)
create or replace function public.admin_balance(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Chỉ quản lý được xem'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'account_no', a.account_no, 'broker', a.broker, 'server', a.server, 'currency', a.currency, 'status', a.status,
      'customer', c.name, 'system', s.name, 'share_pct', a.share_pct,
      'p', public.acc_period(a.id, p_from, p_to),
      'st', (select jsonb_build_object('balance', st.balance, 'equity', st.equity, 'floating', st.floating,
                                       'positions', st.positions, 'dd_pct', st.dd_pct, 'at', st.received_at)
               from public.account_status st where st.account_id = a.id),
      'seen', e.last_seen, 'stale_days', e.stale_days)
      order by c.name, a.account_no)
      from public.accounts a
      join public.customers c on c.id = a.customer_id
      left join public.systems s on s.id = c.system_id
      left join public.staff_ea_seen() e on e.account_id = a.id), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- chia lợi nhuận
-- Mọi kỳ (tháng) của mọi tài khoản: kỳ có kết quả ngày, có sửa tay hoặc có thu tiền
create or replace function public.profit_rows()
returns table (account_id uuid, period date, days int, net numeric, net_usd numeric, profit_usd numeric,
               share_pct numeric, due numeric, paid numeric, outstanding numeric, status text, manual boolean, note text, last_paid date)
language sql stable security definer set search_path = public as $$
  with k as (
    select r.account_id, date_trunc('month', r.date)::date as period from public.daily_results r
    union select pp.account_id, pp.period from public.profit_periods pp
    union select py.account_id, py.period from public.profit_payments py
  ), x as (
    select k.account_id, k.period, a.currency,
           coalesce(m.days, 0) as days, coalesce(m.net, 0) as net,
           round(public.to_usd(coalesce(m.net, 0), a.currency), 2) as net_usd,
           pp.profit_override_usd, coalesce(pp.share_pct, a.share_pct) as pct, pp.note,
           coalesce(py.paid, 0) as paid, py.last_paid
      from k
      join public.accounts a on a.id = k.account_id
      left join lateral (select count(*)::int as days, sum(r.net) as net from public.daily_results r
                          where r.account_id = k.account_id and date_trunc('month', r.date) = k.period) m on true
      left join public.profit_periods pp on pp.account_id = k.account_id and pp.period = k.period
      left join lateral (select sum(amount_usd) as paid, max(paid_at) as last_paid from public.profit_payments p
                          where p.account_id = k.account_id and p.period = k.period) py on true
  ), y as (
    select *, coalesce(profit_override_usd, net_usd) as profit,
           case when coalesce(profit_override_usd, net_usd) > 0 then round(coalesce(profit_override_usd, net_usd) * pct / 100, 2) else 0 end as due_
      from x
  )
  select account_id, period, days, round(net, 2), net_usd, profit, pct, due_, round(paid, 2),
         greatest(0, round(due_ - paid, 2)),
         case when due_ = 0 then 'none' when due_ - paid <= 0 then 'paid' when paid > 0 then 'partial' else 'due' end,
         profit_override_usd is not null, note, last_paid
    from y $$;
revoke all on function public.profit_rows() from public, anon, authenticated;

create or replace function public.admin_profit(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Chỉ quản lý được xem'; end if;
  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'account_id', pr.account_id, 'period', pr.period, 'account_no', a.account_no, 'broker', a.broker, 'currency', a.currency,
        'customer', c.name, 'system', s.name, 'days', pr.days, 'net', pr.net, 'net_usd', pr.net_usd, 'profit_usd', pr.profit_usd,
        'share_pct', pr.share_pct, 'due', pr.due, 'paid', pr.paid, 'out', pr.outstanding, 'status', pr.status,
        'manual', pr.manual, 'note', pr.note, 'last_paid', pr.last_paid,
        'balance', public.acc_capital(a.id))
        order by c.name, a.account_no, pr.period)
        from public.profit_rows() pr
        join public.accounts a on a.id = pr.account_id
        join public.customers c on c.id = a.customer_id
        left join public.systems s on s.id = c.system_id
       where (p_month is null and pr.outstanding > 0) or pr.period = date_trunc('month', p_month)::date), '[]'::jsonb),
    'total_out', (select coalesce(sum(outstanding), 0) from public.profit_rows()),
    'months', (select coalesce(jsonb_agg(distinct period order by period desc), '[]'::jsonb) from public.profit_rows()));
end $$;

create or replace function public.admin_profit_pay(p_account uuid, p_period date, p_amount numeric, p_paid_at date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Chỉ quản lý được ghi'; end if;
  if p_amount is null or p_amount = 0 then raise exception 'Số tiền phải khác 0'; end if;
  insert into public.profit_payments (account_id, period, amount_usd, paid_at, note, created_by)
  values (p_account, date_trunc('month', p_period)::date, round(p_amount, 2), coalesce(p_paid_at, public.vn_today()), nullif(trim(p_note), ''),
          (select email from public.profiles where id = auth.uid()));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_profit_set(p_account uuid, p_period date, p_profit_usd numeric, p_share_pct numeric, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Chỉ quản lý được sửa'; end if;
  if p_profit_usd is null and p_share_pct is null and nullif(trim(p_note), '') is null then
    delete from public.profit_periods where account_id = p_account and period = date_trunc('month', p_period)::date;
  else
    insert into public.profit_periods as pp (account_id, period, profit_override_usd, share_pct, note, updated_by, updated_at)
    values (p_account, date_trunc('month', p_period)::date, p_profit_usd, p_share_pct, nullif(trim(p_note), ''),
            (select email from public.profiles where id = auth.uid()), now())
    on conflict (account_id, period) do update set profit_override_usd = excluded.profit_override_usd,
      share_pct = excluded.share_pct, note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.acc_period(uuid, date, date) from public, anon;
grant execute on function public.staff_ea_seen(), public.admin_balance(date, date), public.admin_profit(date),
  public.admin_profit_pay(uuid, date, numeric, date, text), public.admin_profit_set(uuid, date, numeric, numeric, text),
  public.acc_period(uuid, date, date), public.vn_today(), public.workdays_between(date, date) to authenticated;

-- Trang xem như khách (Tổng quan / Tài khoản / Hệ thống): trong team chỉ QUẢN LÝ xem được toàn bộ.
-- Kỹ thuật / core chỉ thấy tài khoản của chính họ (nếu họ cũng là khách) hoặc nhánh họ làm trưởng.
create or replace function public.visible_customer_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.customers c where public.is_admin()
  union
  select public.my_customer_id() where public.my_customer_id() is not null
  union
  select c.id from public.customers c where c.system_id in (select public.my_led_systems()) $$;
