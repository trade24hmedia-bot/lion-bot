-- =====================================================================
-- LION BOT · bổ sung 1.11.0 (10/11/2026): ĐỢT 3 GIÁM SÁT BOT
--  - Bộ cài đặt chuẩn theo mức vốn → so với cài đặt bot gửi lên, cảnh báo khi lệch
--  - Đánh dấu bot chạy bản cũ (so với "bản mới nhất" quản lý đặt)
--  - Bản tin 8:00 sáng vào nhóm Telegram nội bộ: bot / VPS sắp hết hạn, bản cũ, lệch chuẩn, cảnh báo tồn
--  - Xuất CSV lịch sử trạng thái (hàm ops_hist)
--  - Gộp dữ liệu cũ: lịch sử trạng thái quá 14 ngày giữ 2 điểm / giờ (cuối giờ + equity thấp nhất), giữ 400 ngày
-- Chạy SAU 011. Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================

-- ---------------------------------------------------------------- bộ cài đặt chuẩn
create table if not exists public.cfg_presets (
  id         bigserial primary key,
  name       text not null,
  cap_min    numeric not null default 0,       -- vốn (USD, TK cent đã đổi /100) từ
  cap_max    numeric,                          -- đến (trống = không giới hạn)
  settings   jsonb not null default '{}'::jsonb,   -- chỉ các thông số cần kiểm
  note       text,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);
create table if not exists public.acc_cfg_check (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  preset_id  bigint references public.cfg_presets(id) on delete set null,
  cap_usd    numeric,
  diff       jsonb,                            -- {"thông số": [thực tế, chuẩn]}
  checked_at timestamptz not null default now()
);
alter table public.cfg_presets   enable row level security;
alter table public.acc_cfg_check enable row level security;
drop policy if exists editor_read on public.cfg_presets;
create policy editor_read on public.cfg_presets for select to authenticated using (public.is_editor());
drop policy if exists editor_read on public.acc_cfg_check;
create policy editor_read on public.acc_cfg_check for select to authenticated using (public.is_editor());
grant select on public.cfg_presets, public.acc_cfg_check to authenticated;

-- so 2 giá trị: số so theo số (60 = 60.0), còn lại so chữ không phân biệt hoa thường (true = "True")
create or replace function public.cfg_eq(a jsonb, b jsonb) returns boolean language plpgsql immutable as $$
declare x text := lower(trim(a #>> '{}')); y text := lower(trim(b #>> '{}'));
begin
  if x is null or y is null then return x is not distinct from y; end if;
  if x ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$' and y ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$' then return x::numeric = y::numeric; end if;
  return x = y;
end $$;

create or replace function public.cfg_check(p_acc uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.accounts; v_set jsonb; v_cap numeric; p public.cfg_presets; v_diff jsonb; v_old jsonb; v_txt text;
begin
  select * into a from accounts where id = p_acc;
  select settings into v_set from acc_config where account_id = p_acc;
  if a.id is null or v_set is null then return; end if;
  select to_usd(s.balance, a.currency) into v_cap from account_status s where s.account_id = p_acc;
  select * into p from cfg_presets where enabled and coalesce(v_cap, 0) >= cap_min and (cap_max is null or coalesce(v_cap, 0) < cap_max)
   order by cap_min desc, id limit 1;
  if p.id is not null then
    select jsonb_object_agg(k, jsonb_build_array(v_set -> k, p.settings -> k)) into v_diff
      from jsonb_object_keys(p.settings) k where not cfg_eq(v_set -> k, p.settings -> k);
  end if;
  select diff into v_old from acc_cfg_check where account_id = p_acc;
  insert into acc_cfg_check (account_id, preset_id, cap_usd, diff, checked_at) values (p_acc, p.id, round(v_cap, 2), v_diff, now())
  on conflict (account_id) do update set preset_id = excluded.preset_id, cap_usd = excluded.cap_usd, diff = excluded.diff, checked_at = now();
  if v_diff is null then
    update acc_alerts set handled_at = now(), handled_by = 'Tự động: đã đúng cài đặt chuẩn', auto_closed = true
     where account_id = p_acc and kind = 'cfg' and handled_at is null;
  elsif v_old is distinct from v_diff then
    select string_agg(k || ': ' || coalesce(v_diff -> k ->> 0, '(không có)') || ' → chuẩn ' || coalesce(v_diff -> k ->> 1, '?'), '; ' order by k) into v_txt
      from jsonb_object_keys(v_diff) k;
    -- đóng cảnh báo cũ để cảnh báo mới (nội dung lệch khác) báo lại Telegram
    update acc_alerts set handled_at = now(), handled_by = 'Tự động: nội dung lệch đã thay đổi', auto_closed = true
     where account_id = p_acc and kind = 'cfg' and handled_at is null;
    perform alert_raise(p_acc, 'cfg', 'cfg', 'orange', 'Lệch cài đặt chuẩn "' || p.name || '" (' || (select count(*) from jsonb_object_keys(v_diff)) || ' thông số): ' || left(v_txt, 1500));
  end if;
end $$;
revoke all on function public.cfg_check(uuid) from public, anon, authenticated;

-- bot gửi cài đặt mới → kiểm tra ngay
create or replace function public.trg_cfg_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform cfg_check(new.account_id); return null; end $$;
drop trigger if exists acc_config_check on public.acc_config;
create trigger acc_config_check after insert or update of settings on public.acc_config for each row execute function public.trg_cfg_check();

create or replace function public.acc_label(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select 'TK <b>' || tg_esc(a.account_no) || '</b> · ' || tg_esc(coalesce(a.broker, a.company, a.server, ''))
         || E'\nKhách: ' || case when c.name is null then '<i>chưa gắn (chờ duyệt)</i>' else tg_esc(c.name) end
    from accounts a left join customers c on c.id = a.customer_id where a.id = p_id $$;

-- ---------------------------------------------------------------- phiên bản bot
create or replace function public.build_norm(b text) returns text language sql immutable as $$
  select nullif(rpad(left(regexp_replace(coalesce(b, ''), '[^0-9]', '', 'g'), 14), 14, '0'), '00000000000000') $$;
-- so phần chung: "2026-11-10" không bị coi là cũ hơn "2026.11.10 13:03"
create or replace function public.build_old(b text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(left(x, least(length(x), length(y))) < left(y, least(length(x), length(y))), false)
    from (select nullif(regexp_replace(coalesce(b, ''), '[^0-9]', '', 'g'), '') x,
                 nullif(regexp_replace(coalesce((select value from bot_config where key = 'bot_latest_build'), ''), '[^0-9]', '', 'g'), '') y) z $$;

-- ---------------------------------------------------------------- monitor_tick: thêm kiểm chuẩn mỗi 10 phút + bản tin 8:00
create or replace function public.monitor_tick() returns void
language plpgsql security definer set search_path = public as $$
declare r record; m int; v_vn timestamp := now() at time zone 'Asia/Ho_Chi_Minh'; txt text; part text;
begin
  -- 1) có tín hiệu lại → tự đóng cảnh báo mất tín hiệu
  for r in select al.id, al.account_id, al.first_at from acc_alerts al join accounts a on a.id = al.account_id
            where al.handled_at is null and al.kind = 'lost' and a.last_seen > now() - interval '5 minutes' loop
    update acc_alerts set handled_at = now(), handled_by = 'Tự động: có tín hiệu lại', auto_closed = true where id = r.id;
    perform tg_internal(E'✅ <b>BOT CÓ TÍN HIỆU LẠI</b>\n\n' || acc_label(r.account_id)
      || E'\nMất tín hiệu khoảng ' || dur_txt(ceil(extract(epoch from now() - r.first_at) / 60)::int + 15) || E'\n🕘 ' || vn_hm(now()) || ' (giờ VN)');
  end loop;

  -- 2) mất tín hiệu (chỉ khi thị trường mở)
  if not market_closed() then
    for r in select a.id, a.last_seen from accounts a
              where a.last_seen is not null and a.status = 'active' and not a.blocked
                and a.last_seen < now() - interval '15 minutes' and a.last_seen > now() - interval '7 days' loop
      m := floor(extract(epoch from now() - r.last_seen) / 60)::int;
      perform alert_raise(r.id, 'lost', 'lost', case when m >= 45 then 'red' else 'orange' end,
        'Không nhận dữ liệu ' || dur_txt(m) || ' (lần cuối ' || vn_hm(r.last_seen) || '). Kiểm tra VPS / MT5 / mạng.');
    end loop;
  end if;

  -- 3) 1 TK có ≥ 2 máy cùng gửi trong 10 phút
  for r in select t.account_id, count(*) n, string_agg(t.terminal_id, ', ') ids from acc_terminals t
            where t.last_seen > now() - interval '10 minutes' group by 1 having count(*) >= 2 loop
    perform alert_raise(r.account_id, 'two_terminals', 'two_terminals', 'red',
      r.n || ' máy đang chạy bot cùng lúc (mã máy: ' || r.ids || '). Dễ vào lệnh trùng, tắt bớt 1 máy.');
  end loop;
  update acc_alerts al set handled_at = now(), handled_by = 'Tự động: còn 1 máy', auto_closed = true
   where al.handled_at is null and al.kind = 'two_terminals' and al.last_at < now() - interval '20 minutes';

  -- 4) TK đã duyệt → đóng cảnh báo chờ duyệt
  update acc_alerts al set handled_at = now(), handled_by = 'Tự động: đã duyệt', auto_closed = true
    from accounts a where a.id = al.account_id and al.handled_at is null and al.kind = 'pending' and a.approved;

  -- 5) mỗi 10 phút: kiểm lại cài đặt chuẩn (vốn thay đổi có thể đổi bộ chuẩn)
  if extract(minute from v_vn)::int % 10 = 3 then
    for r in select account_id from acc_config loop perform cfg_check(r.account_id); end loop;
  end if;

  -- 6) bản tin 8:00 sáng cho nhóm nội bộ (1 lần / ngày)
  if extract(hour from v_vn) = 8 and extract(minute from v_vn) < 10
     and not exists (select 1 from bot_config where key = 'ops_digest_day' and value = to_char(v_vn, 'YYYYMMDD')) then
    insert into bot_config values ('ops_digest_day', to_char(v_vn, 'YYYYMMDD')) on conflict (key) do update set value = excluded.value;
    txt := E'☀️ <b>LION BOT · BẢN TIN KỸ THUẬT ' || to_char(v_vn, 'DD/MM') || '</b>';
    select string_agg('• ' || tg_esc(a.account_no) || ' · ' || tg_esc(coalesce(c.name, '?')) || ' · ' ||
             case when a.bot_end < (v_vn)::date then '<b>đã hết hạn ' || to_char(a.bot_end, 'DD/MM') || '</b>'
                  else 'hết hạn ' || to_char(a.bot_end, 'DD/MM') || ' (còn ' || (a.bot_end - (v_vn)::date) || ' ngày)' end, E'\n' order by a.bot_end)
      into part from accounts a left join customers c on c.id = a.customer_id
     where a.status = 'active' and a.bot_end is not null and a.bot_end <= (v_vn)::date + 7 and a.bot_end >= (v_vn)::date - 30;
    if part is not null then txt := txt || E'\n\n📅 <b>Bot sắp / đã hết hạn</b>\n' || part; end if;
    select string_agg('• ' || tg_esc(v.name) || ' · ' ||
             case when v.end_date < (v_vn)::date then '<b>đã hết hạn ' || to_char(v.end_date, 'DD/MM') || '</b>'
                  else 'hết hạn ' || to_char(v.end_date, 'DD/MM') || ' (còn ' || (v.end_date - (v_vn)::date) || ' ngày)' end
             || ' · ' || (select count(*) from accounts a where a.vps_id = v.id and a.status = 'active') || ' TK', E'\n' order by v.end_date)
      into part from vps v where v.end_date is not null and v.end_date <= (v_vn)::date + 7 and v.end_date >= (v_vn)::date - 30;
    if part is not null then txt := txt || E'\n\n🖥️ <b>VPS sắp / đã hết hạn</b>\n' || part; end if;
    select string_agg('• ' || tg_esc(a.account_no) || ' · bản ' || tg_esc(a.bot_build), E'\n' order by a.account_no) into part
      from accounts a where a.status = 'active' and build_old(a.bot_build) and a.last_seen > now() - interval '3 days';
    if part is not null then txt := txt || E'\n\n🧩 <b>Bot chạy bản cũ</b> (mới nhất: ' || tg_esc((select value from bot_config where key = 'bot_latest_build')) || E')\n' || part; end if;
    select string_agg('• ' || tg_esc(a.account_no) || ' · ' || (select count(*) from jsonb_object_keys(k.diff)) || ' thông số lệch "' || tg_esc(coalesce(p.name, '')) || '"', E'\n') into part
      from acc_cfg_check k join accounts a on a.id = k.account_id left join cfg_presets p on p.id = k.preset_id where k.diff is not null and a.status = 'active';
    if part is not null then txt := txt || E'\n\n⚙️ <b>Lệch cài đặt chuẩn</b>\n' || part; end if;
    select count(*) into m from acc_alerts where handled_at is null;
    txt := txt || E'\n\n🔔 Cảnh báo chưa xử lý: <b>' || m || '</b>'
        || E'\n<a href="https://lion-bot.pages.dev/#/admin/botmon">Mở Giám sát bot</a>';
    perform tg_internal(txt);
  end if;
  delete from acc_alerts where handled_at < now() - interval '90 days';
end $$;
revoke all on function public.monitor_tick() from public, anon, authenticated;

-- ---------------------------------------------------------------- gộp dữ liệu cũ (chạy mỗi giờ)
create or replace function public.ingest_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from public.ingest_seen where at < now() - interval '2 days';
  delete from public.ingest_log where at < now() - interval '3 days';
  -- quá 14 ngày: mỗi giờ giữ 2 điểm (điểm cuối giờ + điểm equity thấp nhất)
  delete from public.acc_status_hist h using (
    select account_id, ts,
           row_number() over (partition by account_id, date_trunc('hour', ts) order by ts desc) rn,
           row_number() over (partition by account_id, date_trunc('hour', ts) order by equity asc nulls last, ts) rm
      from public.acc_status_hist where ts < now() - interval '14 days' and ts > now() - interval '45 days') x
   where h.account_id = x.account_id and h.ts = x.ts and x.rn > 1 and x.rm > 1;
  delete from public.acc_status_hist where ts < now() - interval '400 days';
  delete from public.acc_events where level = 'info' and received_at < now() - interval '365 days';
$$;
revoke all on function public.ingest_cleanup() from public, anon, authenticated;

-- ---------------------------------------------------------------- màn hình
create or replace function public.ops_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_editor() then raise exception 'Chỉ Quản lý / Kỹ thuật'; end if;
  return jsonb_build_object(
    'now', now(), 'market_closed', market_closed(), 'today', (now() at time zone 'Asia/Ho_Chi_Minh')::date,
    'has_internal', exists (select 1 from tg_chats where internal and enabled),
    'latest_build', (select value from bot_config where key = 'bot_latest_build'),
    'accounts', coalesce((select jsonb_agg(x order by x.sort, x.account_no) from (
       select a.id, a.account_no, a.server, a.broker, a.currency, a.approved, a.blocked, a.status, a.source, a.bot_reported, a.bot_build,
              build_old(a.bot_build) as old_build, a.bot_end, v.name as vps_name, v.end_date as vps_end,
              c.name as customer, sy.name as system_name, a.last_seen, s.received_at,
              s.balance, s.equity, s.floating, s.dd_pct, s.maxdd_pct, s.orders, s.positions, s.lots_buy, s.lots_sell,
              s.bot_state, s.basket_mode, s.basket_pnl, s.gong, s.credit,
              k.cap_usd, p.name as preset, (select count(*) from jsonb_object_keys(coalesce(k.diff, '{}'::jsonb))) as cfg_diff,
              (select count(*) from acc_terminals t where t.account_id = a.id and t.last_seen > now() - interval '30 minutes') as terminals,
              (select count(*) from acc_alerts al where al.account_id = a.id and al.handled_at is null) as alerts_open,
              (select max(lv_num(al.level)) from acc_alerts al where al.account_id = a.id and al.handled_at is null) as alert_lv,
              (select jsonb_build_object('type', e.type, 'label', ev_label(e.type), 'level', e.level, 'at', e.received_at, 'message', e.message)
                 from acc_events e where e.account_id = a.id order by e.received_at desc limit 1) as last_event,
              case when a.last_seen is null then 3 when not a.approved then 0 else 1 end as sort
         from accounts a
         left join customers c on c.id = a.customer_id
         left join systems sy on sy.id = c.system_id
         left join vps v on v.id = a.vps_id
         left join account_status s on s.account_id = a.id
         left join acc_cfg_check k on k.account_id = a.id
         left join cfg_presets p on p.id = k.preset_id
        where a.status = 'active' or a.last_seen > now() - interval '7 days') x), '[]'::jsonb),
    'alerts', coalesce((select jsonb_agg(x order by x.handled_at is not null, x.last_at desc) from (
       select al.*, a.account_no, a.broker, c.name as customer
         from acc_alerts al join accounts a on a.id = al.account_id left join customers c on c.id = a.customer_id
        where al.handled_at is null or al.handled_at > now() - interval '3 days'
        order by al.handled_at is not null, al.last_at desc limit 200) x), '[]'::jsonb));
end $$;

create or replace function public.ops_account(p_id uuid, p_hours int default 24) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := now() - make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 24 * 400));
        v_n int; v_step int;
begin
  if not public.is_editor() then raise exception 'Chỉ Quản lý / Kỹ thuật'; end if;
  select count(*) into v_n from acc_status_hist where account_id = p_id and ts >= v_from;
  v_step := greatest(1, ceil(v_n / 600.0)::int);
  return jsonb_build_object(
    'acc', (select to_jsonb(a) - 'ingest_key' || jsonb_build_object('customer', c.name, 'system_name', sy.name, 'old_build', build_old(a.bot_build),
                     'latest_build', (select value from bot_config where key = 'bot_latest_build'), 'vps_name', v.name, 'vps_end', v.end_date)
              from accounts a left join customers c on c.id = a.customer_id left join systems sy on sy.id = c.system_id
              left join vps v on v.id = a.vps_id where a.id = p_id),
    'status', (select to_jsonb(s) from account_status s where s.account_id = p_id),
    'check', (select to_jsonb(k) || jsonb_build_object('preset', p.name, 'preset_settings', p.settings)
                from acc_cfg_check k left join cfg_presets p on p.id = k.preset_id where k.account_id = p_id),
    'series', coalesce((select jsonb_agg(jsonb_build_object('ts', ts, 'balance', balance, 'equity', equity, 'dd', dd_pct, 'floating', floating) order by ts)
                          from (select h.*, row_number() over (order by ts) rn from acc_status_hist h where h.account_id = p_id and h.ts >= v_from) z
                         where (rn - 1) % v_step = 0 or rn = v_n), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'label', ev_label(e.type), 'level', e.level, 'time_server', e.time_server,
                          'at', e.received_at, 'message', e.message, 'dd_pct', e.dd_pct, 'balance', e.balance, 'equity', e.equity, 'pnl', e.pnl, 'extra', e.extra) order by e.received_at desc)
                          from (select * from acc_events where account_id = p_id order by received_at desc limit 300) e), '[]'::jsonb),
    'config', (select to_jsonb(k) from acc_config k where k.account_id = p_id),
    'config_hist', coalesce((select jsonb_agg(to_jsonb(h) order by h.at desc) from (select * from acc_config_hist where account_id = p_id order by at desc limit 50) h), '[]'::jsonb),
    'terminals', coalesce((select jsonb_agg(to_jsonb(t) order by t.last_seen desc) from acc_terminals t where t.account_id = p_id), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(to_jsonb(n) order by n.at desc) from (select * from acc_notes where account_id = p_id order by at desc limit 100) n), '[]'::jsonb),
    'alerts', coalesce((select jsonb_agg(to_jsonb(al) order by al.last_at desc) from (select * from acc_alerts where account_id = p_id order by last_at desc limit 50) al), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('date', r.date, 'net', r.net, 'balance', r.balance, 'trades', r.trades, 'lots', r.lots, 'dd', r.dd_max_pct,
                          'deposit', r.deposit, 'withdraw', r.withdraw) order by r.date desc)
                         from (select * from daily_results where account_id = p_id order by date desc limit 400) r), '[]'::jsonb));
end $$;

-- toàn bộ lịch sử trạng thái để xuất CSV
create or replace function public.ops_hist(p_id uuid, p_hours int default 168) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_editor() then raise exception 'Chỉ Quản lý / Kỹ thuật'; end if;
  return coalesce((select jsonb_agg(jsonb_build_array(ts, balance, equity, floating, dd_pct, credit, orders, positions, lots_buy, lots_sell) order by ts)
                     from (select * from acc_status_hist where account_id = p_id and ts >= now() - make_interval(hours => least(greatest(coalesce(p_hours, 168), 1), 24 * 400))
                            order by ts limit 200000) h), '[]'::jsonb);
end $$;

-- cài đặt chuẩn + phiên bản
create or replace function public.ops_presets() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_editor() then raise exception 'Chỉ Quản lý / Kỹ thuật'; end if;
  return jsonb_build_object(
    'presets', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object(
                  'accounts', (select count(*) from acc_cfg_check k where k.preset_id = p.id),
                  'mismatch', (select count(*) from acc_cfg_check k where k.preset_id = p.id and k.diff is not null)) order by p.cap_min, p.id)
                from cfg_presets p), '[]'::jsonb),
    'latest_build', (select value from bot_config where key = 'bot_latest_build'),
    'builds', coalesce((select jsonb_agg(jsonb_build_object('build', b, 'n', n, 'old', build_old(b)) order by build_norm(b) desc nulls last)
                from (select bot_build b, count(*) n from accounts where bot_build is not null and status = 'active' group by 1) z), '[]'::jsonb),
    'keys', coalesce((select jsonb_agg(distinct k order by k) from acc_config c, jsonb_object_keys(c.settings) k), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'label', a.account_no || ' · ' || coalesce(cu.name, '?'), 'settings', c.settings,
                  'cap_usd', round(to_usd(s.balance, a.currency), 2)) order by a.account_no)
                from acc_config c join accounts a on a.id = c.account_id left join customers cu on cu.id = a.customer_id
                left join account_status s on s.account_id = a.id), '[]'::jsonb),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('account_id', a.id, 'account_no', a.account_no, 'customer', cu.name, 'cap_usd', k.cap_usd,
                  'preset', p.name, 'diff', k.diff) order by a.account_no)
                from acc_cfg_check k join accounts a on a.id = k.account_id left join customers cu on cu.id = a.customer_id
                left join cfg_presets p on p.id = k.preset_id), '[]'::jsonb));
end $$;

create or replace function public.ops_preset_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id bigint; r record;
begin
  if not public.is_editor() then raise exception 'Chỉ Quản lý / Kỹ thuật'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Nhập tên bộ cài đặt'; end if;
  if jsonb_typeof(p->'settings') <> 'object' then raise exception 'Thông số không hợp lệ'; end if;
  if (p->>'id') is not null then
    update cfg_presets set name = trim(p->>'name'), cap_min = coalesce(nullif(p->>'cap_min', '')::numeric, 0), cap_max = nullif(p->>'cap_max', '')::numeric,
           settings = p->'settings', note = nullif(trim(p->>'note'), ''), enabled = coalesce((p->>'enabled')::boolean, true),
           updated_at = now(), updated_by = auth.jwt()->>'email'
     where id = (p->>'id')::bigint returning id into v_id;
  else
    insert into cfg_presets (name, cap_min, cap_max, settings, note, enabled, updated_by)
    values (trim(p->>'name'), coalesce(nullif(p->>'cap_min', '')::numeric, 0), nullif(p->>'cap_max', '')::numeric, p->'settings',
            nullif(trim(p->>'note'), ''), coalesce((p->>'enabled')::boolean, true), auth.jwt()->>'email') returning id into v_id;
  end if;
  for r in select account_id from acc_config loop perform cfg_check(r.account_id); end loop;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.ops_preset_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_editor() then raise exception 'Chỉ Quản lý / Kỹ thuật'; end if;
  delete from cfg_presets where id = p_id;
  for r in select account_id from acc_config loop perform cfg_check(r.account_id); end loop;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ops_set_latest_build(p_build text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor() then raise exception 'Chỉ Quản lý / Kỹ thuật'; end if;
  if coalesce(trim(p_build), '') = '' then delete from bot_config where key = 'bot_latest_build';
  else insert into bot_config values ('bot_latest_build', left(trim(p_build), 40)) on conflict (key) do update set value = excluded.value; end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.ops_hist(uuid, int), public.ops_presets(), public.ops_preset_save(jsonb), public.ops_preset_delete(bigint),
  public.ops_set_latest_build(text) to authenticated;

-- kiểm lần đầu
do $$ declare r record; begin for r in select account_id from public.acc_config loop perform public.cfg_check(r.account_id); end loop; end $$;
