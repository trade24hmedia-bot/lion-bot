-- =====================================================================
-- LION BOT · bổ sung schema 1.1.0 (04/11/2026)
-- Chạy SAU schema.sql. Chạy lại nhiều lần vẫn an toàn.
--  * VPS + mật khẩu VPS tách bảng riêng (chỉ admin / kỹ thuật đọc được)
--  * Tài khoản gắn VPS
--  * Trưởng nhánh ghi theo tên (khi người đó chưa phải khách hàng)
--  * Lịch sử gia hạn bot / VPS
--  * Mời nhân viên trước: đăng nhập lần đầu tự nhận đúng vai trò
--  * legacy_id: mã cũ bên Google Sheet, để chuyển dữ liệu lại không bị trùng
-- =====================================================================

create table if not exists public.vps (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,              -- IP:port hoặc tên gợi nhớ
  provider    text,
  spec        text,
  start_date  date,
  end_date    date,
  fee_usd     numeric,
  note        text,
  legacy_id   text unique,
  created_at  timestamptz not null default now()
);

-- Thông tin đăng nhập VPS: chỉ admin + kỹ thuật (core team không thấy)
create table if not exists public.vps_secrets (
  vps_id      uuid primary key references public.vps(id) on delete cascade,
  login_user  text,
  password    text,
  updated_at  timestamptz not null default now()
);

alter table public.accounts  add column if not exists vps_id uuid references public.vps(id) on delete set null;
alter table public.accounts  add column if not exists legacy_id text unique;
alter table public.customers add column if not exists legacy_id text unique;
alter table public.systems   add column if not exists legacy_id text unique;
alter table public.systems   add column if not exists leader_name text;
create index if not exists accounts_vps_idx on public.accounts (vps_id);

create table if not exists public.renewals (
  id          bigserial primary key,
  kind        text not null check (kind in ('bot','vps')),
  account_id  uuid references public.accounts(id) on delete cascade,
  vps_id      uuid references public.vps(id) on delete cascade,
  action      text,
  package     text,
  from_date   date,
  to_date     date,
  done_by     text,
  done_at     timestamptz not null default now(),
  legacy_key  text unique
);

create table if not exists public.preset_roles (
  email      text primary key,
  role       text not null check (role in ('admin','tech','core')),
  full_name  text,
  created_at timestamptz not null default now()
);

alter table public.vps          enable row level security;
alter table public.vps_secrets  enable row level security;
alter table public.renewals     enable row level security;
alter table public.preset_roles enable row level security;

do $$
declare t text;
begin
  foreach t in array array['vps','renewals'] loop
    execute format('drop policy if exists staff_read on public.%I', t);
    execute format('drop policy if exists editor_write on public.%I', t);
    execute format('create policy staff_read on public.%I for select to authenticated using (public.is_staff())', t);
    execute format('create policy editor_write on public.%I for all to authenticated using (public.is_editor()) with check (public.is_editor())', t);
  end loop;
end $$;

drop policy if exists editor_all on public.vps_secrets;
create policy editor_all on public.vps_secrets for all to authenticated
  using (public.is_editor()) with check (public.is_editor());

drop policy if exists admin_all on public.preset_roles;
create policy admin_all on public.preset_roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.vps, public.vps_secrets, public.renewals, public.preset_roles to authenticated;
grant usage, select on sequence public.renewals_id_seq to authenticated;

-- Người mới đăng nhập: gắn khách theo email + nhận vai trò đã mời trước (nếu có)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, customer_id)
  values (new.id, lower(new.email),
          (select pr.full_name from public.preset_roles pr where pr.email = lower(new.email)),
          coalesce((select pr.role from public.preset_roles pr where pr.email = lower(new.email)), 'customer'),
          (select c.id from public.customers c where lower(c.email) = lower(new.email) limit 1))
  on conflict (id) do nothing;
  return new;
end $$;

-- Mời trước cho người ĐÃ đăng nhập rồi: áp vai trò ngay
create or replace function public.apply_preset_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(trim(new.email));
  update public.profiles set role = new.role, full_name = coalesce(full_name, new.full_name)
   where lower(email) = new.email and role = 'customer';
  return new;
end $$;
drop trigger if exists preset_roles_apply on public.preset_roles;
create trigger preset_roles_apply before insert or update on public.preset_roles
  for each row execute function public.apply_preset_role();
