-- =====================================================================
-- LION BOT · bổ sung 1.13.0 (11/11/2026): MỤC HƯỚNG DẪN TỰ TẠO THEO TỪNG SÀN
--  - guide_sections: danh sách mục của từng sàn (thêm / đổi tên / đổi thứ tự / xóa)
--  - guide_steps.section giữ "mã mục" (register, verify… hoặc mã mục tự tạo)
--  - Sàn đã có: tự tạo 5 mục mặc định (Đăng ký, Xác minh, Nạp tiền, Cài copy bot, Lưu ý khác)
-- Chạy SAU 013. Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================

create table if not exists public.guide_sections (
  id        uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.guide_brokers(id) on delete cascade,
  key       text not null,
  name      text not null,
  name_en   text,
  sort      int not null default 0,
  unique (broker_id, key)
);
create index if not exists guide_sections_broker_idx on public.guide_sections (broker_id, sort);

alter table public.guide_sections enable row level security;
drop policy if exists public_read on public.guide_sections;
create policy public_read on public.guide_sections for select to anon, authenticated
  using (exists (select 1 from public.guide_brokers b where b.id = broker_id and (b.published or public.is_editor())));
drop policy if exists editor_write on public.guide_sections;
create policy editor_write on public.guide_sections for all to authenticated using (public.is_editor()) with check (public.is_editor());
grant select on public.guide_sections to anon, authenticated;
grant insert, update, delete on public.guide_sections to authenticated;

-- 5 mục mặc định cho mọi sàn đang có
insert into public.guide_sections (broker_id, key, name, name_en, sort)
select b.id, d.key, d.name, d.name_en, d.sort
  from public.guide_brokers b
 cross join (values ('register', 'Đăng ký tài khoản', 'Open an account', 10),
                    ('verify', 'Xác minh danh tính', 'Verify your identity', 20),
                    ('deposit', 'Nạp tiền', 'Deposit', 30),
                    ('copy', 'Cài đặt copy bot', 'Set up bot copying', 40),
                    ('other', 'Lưu ý khác', 'Other notes', 50)) as d(key, name, name_en, sort)
on conflict (broker_id, key) do nothing;
