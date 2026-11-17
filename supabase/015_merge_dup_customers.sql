-- =====================================================================
-- LION BOT · 17/11/2026: GỘP KHÁCH HÀNG TRÙNG (cùng tên + cùng nhánh)
--  Giữ 1 khách (ưu tiên khách có tài khoản, rồi khách tạo sớm nhất), chuyển tài khoản / người dùng /
--  trưởng nhánh sang khách được giữ, rồi xóa các bản trùng. Khách cùng tên nhưng KHÁC nhánh giữ nguyên.
-- Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================
with g as (
  select c.id, first_value(c.id) over (partition by lower(trim(c.name)), coalesce(c.system_id::text, '')
           order by (select count(*) from public.accounts a where a.customer_id = c.id) > 0 desc, c.created_at, c.id) as keep
    from public.customers c
), m as (select id, keep from g where id <> keep),
u1 as (update public.accounts a set customer_id = m.keep from m where a.customer_id = m.id returning 1),
u2 as (update public.profiles p set customer_id = m.keep from m where p.customer_id = m.id returning 1),
u3 as (update public.systems s set leader_customer_id = m.keep from m where s.leader_customer_id = m.id returning 1)
select (select count(*) from m) as khach_trung, (select count(*) from u1) as tk_chuyen, (select count(*) from u2) as user_chuyen, (select count(*) from u3) as truong_nhanh;

delete from public.customers c
 using (select c2.id, first_value(c2.id) over (partition by lower(trim(c2.name)), coalesce(c2.system_id::text, '')
          order by (select count(*) from public.accounts a where a.customer_id = c2.id) > 0 desc, c2.created_at, c2.id) as keep
          from public.customers c2) g
 where c.id = g.id and g.id <> g.keep
   and not exists (select 1 from public.accounts a where a.customer_id = c.id)
   and not exists (select 1 from public.profiles p where p.customer_id = c.id)
   and not exists (select 1 from public.systems s where s.leader_customer_id = c.id);

select c.name, sy.name as nhanh, (select string_agg(a.account_no, ', ') from public.accounts a where a.customer_id = c.id) as tai_khoan
  from public.customers c left join public.systems sy on sy.id = c.system_id
 where lower(trim(c.name)) in ('demo exness', 'quy - chia với khách') order by c.name, sy.name;
