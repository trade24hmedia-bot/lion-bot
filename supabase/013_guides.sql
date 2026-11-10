-- =====================================================================
-- LION BOT · bổ sung 1.12.0 (10/11/2026): HƯỚNG DẪN MỞ TÀI KHOẢN & COPY BOT THEO SÀN
--  - guide_brokers: các sàn (Vantage, GTC, StarTrader, Valetax…) + link đăng ký, mã giới thiệu
--  - guide_steps: từng bước theo mục (đăng ký / xác minh / nạp tiền / cài copy bot), có ảnh + video
--  - Ai cũng xem được (không cần đăng nhập); Quản lý + Kỹ thuật sửa
--  - Ảnh / video lưu ở Supabase Storage, thư mục công khai "guides" (tối đa 50MB / file)
-- Chạy SAU 012. Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================

create table if not exists public.guide_brokers (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  logo_url   text,
  intro      text,
  intro_en   text,
  ref_link   text,
  ref_code   text,
  sort       int not null default 0,
  published  boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.guide_steps (
  id         uuid primary key default gen_random_uuid(),
  broker_id  uuid not null references public.guide_brokers(id) on delete cascade,
  section    text not null default 'register',   -- register / verify / deposit / copy / other
  sort       int not null default 0,
  title      text not null,
  title_en   text,
  body       text,
  body_en    text,
  images     text[] not null default '{}',
  video_url  text,
  updated_at timestamptz not null default now()
);
create index if not exists guide_steps_broker_idx on public.guide_steps (broker_id, section, sort);

alter table public.guide_brokers enable row level security;
alter table public.guide_steps   enable row level security;
drop policy if exists public_read on public.guide_brokers;
create policy public_read on public.guide_brokers for select to anon, authenticated using (published or public.is_editor());
drop policy if exists public_read on public.guide_steps;
create policy public_read on public.guide_steps for select to anon, authenticated
  using (exists (select 1 from public.guide_brokers b where b.id = broker_id and (b.published or public.is_editor())));
drop policy if exists editor_write on public.guide_brokers;
create policy editor_write on public.guide_brokers for all to authenticated using (public.is_editor()) with check (public.is_editor());
drop policy if exists editor_write on public.guide_steps;
create policy editor_write on public.guide_steps for all to authenticated using (public.is_editor()) with check (public.is_editor());
grant select on public.guide_brokers, public.guide_steps to anon, authenticated;
grant insert, update, delete on public.guide_brokers, public.guide_steps to authenticated;

-- 4 sàn ban đầu (chưa có bước; Quản lý / Kỹ thuật thêm trong Quản trị → Hướng dẫn)
insert into public.guide_brokers (slug, name, sort, intro, intro_en) values
  ('vantage', 'Vantage', 1, 'Hướng dẫn mở tài khoản Vantage và copy bot Lion Bot.', 'How to open a Vantage account and copy the Lion Bot strategy.'),
  ('gtc', 'GTC', 2, 'Hướng dẫn mở tài khoản GTC và copy bot Lion Bot.', 'How to open a GTC account and copy the Lion Bot strategy.'),
  ('startrader', 'StarTrader', 3, 'Hướng dẫn mở tài khoản StarTrader và copy bot Lion Bot.', 'How to open a StarTrader account and copy the Lion Bot strategy.'),
  ('valetax', 'Valetax', 4, 'Hướng dẫn mở tài khoản Valetax và copy bot Lion Bot.', 'How to open a Valetax account and copy the Lion Bot strategy.')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------- nơi lưu ảnh / video
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('guides', 'guides', true, 52428800,
            array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists guides_editor_insert on storage.objects';
    execute 'create policy guides_editor_insert on storage.objects for insert to authenticated with check (bucket_id = ''guides'' and public.is_editor())';
    execute 'drop policy if exists guides_editor_update on storage.objects';
    execute 'create policy guides_editor_update on storage.objects for update to authenticated using (bucket_id = ''guides'' and public.is_editor())';
    execute 'drop policy if exists guides_editor_delete on storage.objects';
    execute 'create policy guides_editor_delete on storage.objects for delete to authenticated using (bucket_id = ''guides'' and public.is_editor())';
  end if;
end $$;
