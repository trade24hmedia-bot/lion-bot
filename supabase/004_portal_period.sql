-- =====================================================================
-- LION BOT · bổ sung 1.3.0 (04/11/2026)
--  * Che số tài khoản cho khách: ẩn 4 số ĐẦU (36527147 → ••••7147, 2511034038 → ••••034038)
--  * Trang Tổng quan của khách: lọc theo tháng / quý / tùy chọn ngày
--  * Chia lợi nhuận: lọc theo khoảng thời gian
--  * Passview (mật khẩu xem / Investor) + phiên bản bot cho tài khoản
-- Chạy SAU 003. Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================

alter table public.accounts add column if not exists bot_version text;

create table if not exists public.account_secrets (
  account_id     uuid primary key references public.accounts(id) on delete cascade,
  investor_pass  text,
  updated_at     timestamptz not null default now()
);
alter table public.account_secrets enable row level security;
drop policy if exists staff_read on public.account_secrets;
drop policy if exists editor_write on public.account_secrets;
create policy staff_read on public.account_secrets for select to authenticated using (public.is_staff());
create policy editor_write on public.account_secrets for all to authenticated using (public.is_editor()) with check (public.is_editor());
grant select, insert, update, delete on public.account_secrets to authenticated;

create or replace function public.mask_no(no text) returns text
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then no
              when length(no) <= 4 then '••••'
              else '••••' || substr(no, 5) end $$;

-- Số liệu từng tài khoản trong khoảng ngày (khách: tài khoản của mình + nhánh mình làm trưởng; quản lý: tất cả)
create or replace function public.portal_period(p_from date, p_to date)
returns table (id uuid, account_mask text, broker text, currency text, customer_name text, system_name text,
               is_mine boolean, status text, capital numeric, capital_usd numeric, start_balance numeric,
               profit numeric, profit_usd numeric, deposit numeric, withdraw numeric, growth_pct numeric,
               profit_total_usd numeric, days int, last_seen timestamptz)
language sql stable security definer set search_path = public as $$
  with acc as (
    select a.*, c.name as cname, s.name as sname,
           coalesce((select r.balance from public.daily_results r where r.account_id = a.id and r.date <= p_to and r.balance > 0
                      order by r.date desc limit 1), a.open_balance) as cap,
           public.acc_start_balance(a.id, p_from) as sb,
           (select coalesce(sum(r.net), 0) from public.daily_results r where r.account_id = a.id and r.date between p_from and p_to) as pn,
           (select count(*)::int from public.daily_results r where r.account_id = a.id and r.date between p_from and p_to) as nd,
           (select coalesce(sum(t.amount), 0) from public.transfers t where t.account_id = a.id and t.type = 'deposit' and t.date between p_from and p_to) as dep,
           (select coalesce(sum(t.amount), 0) from public.transfers t where t.account_id = a.id and t.type = 'withdraw' and t.date between p_from and p_to) as wd,
           (select coalesce(sum(r.net), 0) from public.daily_results r where r.account_id = a.id) as pt,
           greatest((select max(r.received_at) from public.daily_results r where r.account_id = a.id),
                    (select st.received_at from public.account_status st where st.account_id = a.id)) as seen
      from public.accounts a
      join public.customers c on c.id = a.customer_id
      left join public.systems s on s.id = c.system_id
     where a.customer_id in (select public.visible_customer_ids())
  )
  select id, public.mask_no(account_no), broker, currency, cname, sname,
         coalesce(customer_id = public.my_customer_id(), false) or (public.is_admin() and public.my_customer_id() is null),
         status, cap, round(public.to_usd(cap, currency), 2), sb,
         round(pn, 2), round(public.to_usd(pn, currency), 2), dep, wd,
         case when coalesce(sb, 0) + dep > 0 then round(pn / (coalesce(sb, 0) + dep) * 100, 2) end,
         round(public.to_usd(pt, currency), 2), nd, seen
    from acc order by cname, account_no $$;
grant execute on function public.portal_period(date, date) to authenticated;

-- Chia lợi nhuận theo khoảng: các kỳ (tháng) nằm trong khoảng; p_due_only = chỉ kỳ còn nợ
create or replace function public.admin_profit_range(p_from date, p_to date, p_due_only boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Chỉ quản lý được xem'; end if;
  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'account_id', pr.account_id, 'period', pr.period, 'account_no', a.account_no, 'broker', a.broker, 'currency', a.currency,
        'customer', c.name, 'system', s.name, 'days', pr.days, 'net', pr.net, 'net_usd', pr.net_usd, 'profit_usd', pr.profit_usd,
        'share_pct', pr.share_pct, 'due', pr.due, 'paid', pr.paid, 'out', pr.outstanding, 'status', pr.status,
        'manual', pr.manual, 'note', pr.note, 'last_paid', pr.last_paid)
        order by pr.period desc, c.name, a.account_no)
        from public.profit_rows() pr
        join public.accounts a on a.id = pr.account_id
        join public.customers c on c.id = a.customer_id
        left join public.systems s on s.id = c.system_id
       where (p_from is null or pr.period >= date_trunc('month', p_from)::date)
         and (p_to is null or pr.period <= date_trunc('month', p_to)::date)
         and (not p_due_only or pr.outstanding > 0)), '[]'::jsonb),
    'total_out', (select coalesce(sum(outstanding), 0) from public.profit_rows()));
end $$;
grant execute on function public.admin_profit_range(date, date, boolean) to authenticated;
