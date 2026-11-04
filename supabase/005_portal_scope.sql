-- =====================================================================
-- LION BOT · bổ sung 1.4.0 (04/11/2026)
--  Trang Tổng quan có 2 chế độ:
--   * 'all'  = tất cả tài khoản đang chạy Lion Bot (ai đăng nhập cũng xem được, số TK che 4 số đầu,
--              tên khách chỉ hiện với tài khoản người xem được phép thấy, còn lại chỉ hiện nhánh)
--   * 'mine' = tài khoản của mình + nhánh mình làm trưởng (quản lý: tất cả)
-- Chạy SAU 004. Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================

drop function if exists public.portal_period(date, date);
drop function if exists public.portal_period(date, date, text);
create function public.portal_period(p_from date, p_to date, p_scope text default 'mine')
returns table (id uuid, account_mask text, broker text, currency text, customer_name text, system_name text,
               is_mine boolean, can_open boolean, status text, capital numeric, capital_usd numeric, start_balance numeric,
               profit numeric, profit_usd numeric, deposit numeric, withdraw numeric, growth_pct numeric,
               profit_total_usd numeric, days int, last_seen timestamptz)
language sql stable security definer set search_path = public as $$
  with vis as (select public.visible_customer_ids() as cid),
  acc as (
    select a.*, c.name as cname, s.name as sname, (a.customer_id in (select cid from vis)) as can,
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
     where auth.uid() is not null
       and (p_scope = 'all' or a.customer_id in (select cid from vis))
  )
  select id, public.mask_no(account_no), broker, currency, case when can then cname end, sname,
         coalesce(customer_id = public.my_customer_id(), false) or (public.is_admin() and public.my_customer_id() is null),
         can, status, cap, round(public.to_usd(cap, currency), 2), sb,
         round(pn, 2), round(public.to_usd(pn, currency), 2), dep, wd,
         case when coalesce(sb, 0) + dep > 0 then round(pn / (coalesce(sb, 0) + dep) * 100, 2) end,
         round(public.to_usd(pt, currency), 2), nd, seen
    from acc order by can desc, cname, sname, account_no $$;

-- Lãi/lỗ theo ngày (USD) cho biểu đồ, cùng phạm vi với portal_period
create or replace function public.portal_daily(p_from date, p_to date, p_scope text default 'mine')
returns table (date date, net_usd numeric)
language sql stable security definer set search_path = public as $$
  select r.date, round(sum(public.to_usd(r.net, a.currency)), 2)
    from public.daily_results r join public.accounts a on a.id = r.account_id
   where auth.uid() is not null and r.date between p_from and p_to
     and (p_scope = 'all' or a.customer_id in (select public.visible_customer_ids()))
   group by r.date order by r.date $$;

revoke all on function public.portal_period(date, date, text), public.portal_daily(date, date, text) from public, anon;
grant execute on function public.portal_period(date, date, text), public.portal_daily(date, date, text) to authenticated;
