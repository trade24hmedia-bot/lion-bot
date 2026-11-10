-- =====================================================================
-- LION BOT · bổ sung 1.10.0 (10/11/2026): GIÁM SÁT BOT (đợt 2)
--  - Cảnh báo: sự kiện Đỏ/Cam của bot, mất tín hiệu 15/45 phút, 1 TK chạy 2 máy, TK mới chờ duyệt
--  - Gộp cảnh báo lặp (cùng TK + cùng loại khi chưa xử lý chỉ tăng số lần), nút "Đã xử lý"
--  - Gửi cảnh báo vào nhóm Telegram NỘI BỘ riêng (không gửi nhóm khách)
--  - Hàm cho màn Giám sát bot (Quản lý + Kỹ thuật)
-- Chạy SAU 010. Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================

-- ---------------------------------------------------------------- nhóm Telegram nội bộ
alter table public.tg_chats add column if not exists internal boolean not null default false;

-- nhóm nội bộ không nhận tin thị trường gửi khách
create or replace function public.tg_broadcast(p_key text, p_kind text, p_level text, p_html text) returns int
language plpgsql security definer set search_path = public as $$
declare c record; n int := 0;
begin
  for c in select * from tg_chats where enabled and not internal
             and lv_num(p_level) >= lv_num(min_level)
             and case p_kind when 'news' then send_news when 'event' then send_events when 'price' then send_price
                             when 'daily' then send_daily else true end loop
    insert into tg_sent (key, chat_id, preview) values (p_key, c.chat_id, left(p_html, 200)) on conflict do nothing;
    if found then perform tg_send(c.chat_id, p_html); n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.tg_broadcast(text, text, text, text) from public, anon, authenticated;

-- gửi vào mọi nhóm nội bộ đang bật
create or replace function public.tg_internal(p_html text) returns int
language plpgsql security definer set search_path = public as $$
declare c record; n int := 0;
begin
  if not exists (select 1 from bot_config where key = 'telegram_token' and coalesce(value, '') <> '') then return 0; end if;
  for c in select * from tg_chats where enabled and internal loop
    insert into tg_sent (key, chat_id, preview) values ('ops:' || gen_random_uuid(), c.chat_id, left(p_html, 200));
    perform tg_send(c.chat_id, p_html); n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.tg_internal(text) from public, anon, authenticated;

create or replace function public.tg_save_chat(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.is_admin() then raise exception 'Chỉ quản lý'; end if;
  if coalesce(trim(p->>'chat_id'), '') = '' then raise exception 'Thiếu chat id'; end if;
  if (p->>'id') is not null then
    update tg_chats set name = coalesce(nullif(trim(p->>'name'), ''), 'Nhóm'), chat_id = trim(p->>'chat_id'),
      min_level = coalesce(p->>'min_level', 'orange'), send_news = coalesce((p->>'send_news')::boolean, true),
      send_events = coalesce((p->>'send_events')::boolean, true), send_price = coalesce((p->>'send_price')::boolean, true),
      send_daily = coalesce((p->>'send_daily')::boolean, true), enabled = coalesce((p->>'enabled')::boolean, true),
      internal = coalesce((p->>'internal')::boolean, false)
     where id = (p->>'id')::bigint returning id into v_id;
  else
    insert into tg_chats (name, chat_id, min_level, send_news, send_events, send_price, send_daily, enabled, internal)
    values (coalesce(nullif(trim(p->>'name'), ''), 'Nhóm'), trim(p->>'chat_id'), coalesce(p->>'min_level', 'orange'),
            coalesce((p->>'send_news')::boolean, true), coalesce((p->>'send_events')::boolean, true),
            coalesce((p->>'send_price')::boolean, true), coalesce((p->>'send_daily')::boolean, true),
            coalesce((p->>'enabled')::boolean, true), coalesce((p->>'internal')::boolean, false))
    on conflict (chat_id) do update set name = excluded.name, internal = excluded.internal returning id into v_id;
    insert into tg_sent (key, chat_id) select 'news:' || id, trim(p->>'chat_id') from news_items where created_at > now() - interval '1 day' on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------- bảng cảnh báo + ghi chú
create table if not exists public.acc_alerts (
  id          bigserial primary key,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  kind        text not null,               -- event / lost / two_terminals / pending
  code        text not null,               -- loại sự kiện (maxdd_cut, error…) hoặc giống kind
  level       text not null,               -- red / orange
  message     text,
  cnt         int not null default 1,      -- số lần lặp khi chưa xử lý
  first_at    timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  handled_by  text,
  handled_at  timestamptz,
  auto_closed boolean not null default false
);
create unique index if not exists acc_alerts_open_uq on public.acc_alerts (account_id, kind, code) where handled_at is null;
create index if not exists acc_alerts_last_idx on public.acc_alerts (last_at desc);

create table if not exists public.acc_notes (
  id         bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  at         timestamptz not null default now(),
  author     text,
  body       text not null
);
create index if not exists acc_notes_acc_idx on public.acc_notes (account_id, at desc);

alter table public.acc_alerts enable row level security;
alter table public.acc_notes  enable row level security;
drop policy if exists editor_read on public.acc_alerts;
create policy editor_read on public.acc_alerts for select to authenticated using (public.is_editor());
drop policy if exists editor_read on public.acc_notes;
create policy editor_read on public.acc_notes for select to authenticated using (public.is_editor());
grant select on public.acc_alerts, public.acc_notes to authenticated;

-- ---------------------------------------------------------------- tạo / gộp cảnh báo + báo Telegram nội bộ
create or replace function public.acc_label(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select 'TK <b>' || tg_esc(a.account_no) || '</b> · ' || tg_esc(coalesce(a.broker, a.company, a.server, ''))
         || E'\nKhách: ' || coalesce(tg_esc(c.name), '<i>chưa gắn (chờ duyệt)</i>')
    from accounts a left join customers c on c.id = a.customer_id where a.id = p_id $$;

create or replace function public.alert_raise(p_acc uuid, p_kind text, p_code text, p_level text, p_msg text) returns bigint
language plpgsql security definer set search_path = public as $$
declare o public.acc_alerts; v_id bigint; v_send boolean := false; head text;
begin
  select * into o from acc_alerts where account_id = p_acc and kind = p_kind and code = p_code and handled_at is null for update;
  if o.id is null then
    insert into acc_alerts (account_id, kind, code, level, message) values (p_acc, p_kind, p_code, p_level, left(p_msg, 2000))
    on conflict do nothing returning id into v_id;
    v_send := v_id is not null;
  else
    v_id := o.id;
    update acc_alerts set cnt = cnt + 1, last_at = now(), message = left(coalesce(p_msg, message), 2000),
           level = case when lv_num(p_level) > lv_num(level) then p_level else level end
     where id = o.id;
    v_send := lv_num(p_level) > lv_num(o.level);   -- nâng mức (vd mất tín hiệu 15 → 45 phút) thì báo lại
  end if;
  if v_send then
    head := case p_kind
      when 'lost' then '📡 <b>MẤT TÍN HIỆU BOT</b>'
      when 'two_terminals' then '🖥️ <b>1 TÀI KHOẢN CHẠY 2 MÁY</b>'
      when 'pending' then '🆕 <b>TÀI KHOẢN MỚI CHỜ DUYỆT</b>'
      else '<b>CẢNH BÁO BOT</b>' end;
    perform tg_internal(case when p_level = 'red' then '🔴 ' else '🟠 ' end || head || E'\n\n' || acc_label(p_acc)
      || E'\n' || tg_esc(coalesce(p_msg, p_code))
      || E'\n🕘 ' || vn_hm(now()) || ' (giờ VN)'
      || E'\n<a href="https://lion-bot.pages.dev/#/admin/botmon/' || p_acc || '">Mở trên Lion Bot</a>');
  end if;
  return v_id;
end $$;
revoke all on function public.alert_raise(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.ev_label(t text) returns text language sql immutable as $$
  select case t
    when 'maxdd_cut' then 'Cắt lệnh do chạm Max DD' when 'maxdd_hit_stopped' then 'Chạm Max DD, bot đã dừng'
    when 'error' then 'Lỗi bot' when 'auto_stop' then 'Bot tự dừng' when 'manual_stop' then 'Dừng bot bằng tay'
    when 'manual_close' then 'Đóng lệnh bằng tay' when 'bot_stop' then 'Bot tắt' when 'config_change' then 'Đổi thông số bot'
    when 'bot_start' then 'Bot khởi động' when 'news_pause' then 'Tạm dừng theo tin' else t end $$;

-- sự kiện Đỏ / Cam → cảnh báo
create or replace function public.trg_event_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.level in ('red', 'orange') then
    perform alert_raise(new.account_id, 'event', new.type, new.level,
      ev_label(new.type) || coalesce(': ' || nullif(new.message, ''), '')
      || case when new.dd_pct is not null then ' · DD ' || round(new.dd_pct, 2) || '%' else '' end);
  end if;
  -- bot khởi động lại → tự đóng cảnh báo "bot tắt / dừng"
  if new.type = 'bot_start' then
    update acc_alerts set handled_at = now(), handled_by = 'Tự động: bot khởi động lại', auto_closed = true
     where account_id = new.account_id and handled_at is null and kind = 'event' and code in ('bot_stop', 'auto_stop', 'manual_stop');
  end if;
  return null;
end $$;
drop trigger if exists acc_events_alert on public.acc_events;
create trigger acc_events_alert after insert on public.acc_events for each row execute function public.trg_event_alert();

-- tài khoản lạ tự tạo → cảnh báo chờ duyệt
create or replace function public.trg_pending_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.approved then
    perform alert_raise(new.id, 'pending', 'pending', 'orange',
      'Server ' || coalesce(new.server, '?') || coalesce(' · bot ' || new.bot_reported, '') || '. Vào Quản trị → Tài khoản để duyệt.');
  end if;
  return null;
end $$;
drop trigger if exists accounts_pending_alert on public.accounts;
create trigger accounts_pending_alert after insert on public.accounts for each row execute function public.trg_pending_alert();

-- ---------------------------------------------------------------- kiểm tra mỗi phút: mất tín hiệu, 2 máy
create or replace function public.market_closed() returns boolean language sql stable as $$
  -- vàng nghỉ từ sáng thứ 7 (≈ 04:00 VN) tới sáng thứ 2 (≈ 06:00 VN)
  select (extract(isodow from v) = 6 and extract(hour from v) >= 4) or extract(isodow from v) = 7
      or (extract(isodow from v) = 1 and extract(hour from v) < 6)
    from (select now() at time zone 'Asia/Ho_Chi_Minh' v) z $$;

create or replace function public.monitor_tick() returns void
language plpgsql security definer set search_path = public as $$
declare r record; m int;
begin
  -- 1) có tín hiệu lại → tự đóng cảnh báo mất tín hiệu
  for r in select al.id, al.account_id, al.first_at from acc_alerts al join accounts a on a.id = al.account_id
            where al.handled_at is null and al.kind = 'lost' and a.last_seen > now() - interval '5 minutes' loop
    update acc_alerts set handled_at = now(), handled_by = 'Tự động: có tín hiệu lại', auto_closed = true where id = r.id;
    perform tg_internal(E'✅ <b>BOT CÓ TÍN HIỆU LẠI</b>\n\n' || acc_label(r.account_id)
      || E'\nMất tín hiệu khoảng ' || dur_txt(ceil(extract(epoch from now() - r.first_at) / 60)::int + 15) || E'\n🕘 ' || vn_hm(now()) || ' (giờ VN)');
  end loop;

  -- 2) mất tín hiệu (chỉ khi thị trường mở, chỉ TK đã từng gửi theo số TK, đang chạy, không bị chặn)
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
  delete from acc_alerts where handled_at < now() - interval '90 days';
end $$;
revoke all on function public.monitor_tick() from public, anon, authenticated;
do $$ begin perform cron.schedule('lionbot-monitor', '* * * * *', 'select public.monitor_tick()'); exception when others then raise notice 'pg_cron chưa có: %', sqlerrm; end $$;

-- ---------------------------------------------------------------- hàm cho màn Giám sát bot (Quản lý + Kỹ thuật)
create or replace function public.ops_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_editor() then raise exception 'Chỉ Quản lý / Kỹ thuật'; end if;
  return jsonb_build_object(
    'now', now(), 'market_closed', market_closed(),
    'has_internal', exists (select 1 from tg_chats where internal and enabled),
    'accounts', coalesce((select jsonb_agg(x order by x.sort, x.account_no) from (
       select a.id, a.account_no, a.server, a.broker, a.currency, a.approved, a.blocked, a.status, a.source, a.bot_reported, a.bot_build,
              c.name as customer, sy.name as system_name, a.last_seen, s.received_at,
              s.balance, s.equity, s.floating, s.dd_pct, s.maxdd_pct, s.orders, s.positions, s.lots_buy, s.lots_sell,
              s.bot_state, s.basket_mode, s.basket_pnl, s.gong, s.credit,
              (select count(*) from acc_terminals t where t.account_id = a.id and t.last_seen > now() - interval '30 minutes') as terminals,
              (select count(*) from acc_alerts al where al.account_id = a.id and al.handled_at is null) as alerts_open,
              (select max(lv_num(al.level)) from acc_alerts al where al.account_id = a.id and al.handled_at is null) as alert_lv,
              (select jsonb_build_object('type', e.type, 'label', ev_label(e.type), 'level', e.level, 'at', e.received_at, 'message', e.message)
                 from acc_events e where e.account_id = a.id order by e.received_at desc limit 1) as last_event,
              case when a.last_seen is null then 3 when not a.approved then 0 else 1 end as sort
         from accounts a
         left join customers c on c.id = a.customer_id
         left join systems sy on sy.id = c.system_id
         left join account_status s on s.account_id = a.id
        where a.status = 'active' or a.last_seen > now() - interval '7 days') x), '[]'::jsonb),
    'alerts', coalesce((select jsonb_agg(x order by x.handled_at is not null, x.last_at desc) from (
       select al.*, a.account_no, a.broker, c.name as customer
         from acc_alerts al join accounts a on a.id = al.account_id left join customers c on c.id = a.customer_id
        where al.handled_at is null or al.handled_at > now() - interval '3 days'
        order by al.handled_at is not null, al.last_at desc limit 200) x), '[]'::jsonb));
end $$;

create or replace function public.ops_account(p_id uuid, p_hours int default 24) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := now() - make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 24 * 90));
        v_n int; v_step int;
begin
  if not public.is_editor() then raise exception 'Chỉ Quản lý / Kỹ thuật'; end if;
  select count(*) into v_n from acc_status_hist where account_id = p_id and ts >= v_from;
  v_step := greatest(1, ceil(v_n / 600.0)::int);   -- tối đa ~600 điểm trên biểu đồ
  return jsonb_build_object(
    'acc', (select to_jsonb(a) - 'ingest_key' || jsonb_build_object('customer', c.name, 'system_name', sy.name)
              from accounts a left join customers c on c.id = a.customer_id left join systems sy on sy.id = c.system_id where a.id = p_id),
    'status', (select to_jsonb(s) from account_status s where s.account_id = p_id),
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
                         from (select * from daily_results where account_id = p_id order by date desc limit 60) r), '[]'::jsonb));
end $$;

create or replace function public.ops_alert_handle(p_ids bigint[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_editor() then raise exception 'Chỉ Quản lý / Kỹ thuật'; end if;
  update acc_alerts set handled_at = now(), handled_by = coalesce(auth.jwt()->>'email', 'web')
   where id = any(p_ids) and handled_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.ops_note_add(p_id uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor() then raise exception 'Chỉ Quản lý / Kỹ thuật'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Ghi chú trống'; end if;
  insert into acc_notes (account_id, author, body) values (p_id, coalesce(auth.jwt()->>'email', 'web'), left(trim(p_body), 4000));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ops_note_delete(p_note bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor() then raise exception 'Chỉ Quản lý / Kỹ thuật'; end if;
  delete from acc_notes where id = p_note;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.ops_overview(), public.ops_account(uuid, int), public.ops_alert_handle(bigint[]),
  public.ops_note_add(uuid, text), public.ops_note_delete(bigint) to authenticated;

-- Gom các sự kiện Đỏ/Cam bot đã gửi hôm nay thành cảnh báo (không báo Telegram cho dữ liệu cũ)
insert into public.acc_alerts (account_id, kind, code, level, message, cnt, first_at, last_at)
select account_id, 'event', type, max(level), public.ev_label(type) || coalesce(': ' || max(message), ''), count(*), min(received_at), max(received_at)
  from public.acc_events where level in ('red', 'orange') and received_at > now() - interval '1 day'
   and not exists (select 1 from public.acc_alerts al where al.account_id = acc_events.account_id and al.kind = 'event' and al.code = acc_events.type)
 group by account_id, type
on conflict do nothing;
