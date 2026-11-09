-- =====================================================================
-- LION BOT · bổ sung 1.8.0 (09/11/2026): BÁO TELEGRAM CHO KHÁCH DÙNG BOT
--  Gửi vào nhóm / kênh Telegram (nhiều nhóm, mỗi nhóm chọn mức & loại tin):
--   • 🔴/🟠 Tin tức mới chấm điểm Đỏ / Cam + lời khuyên xử lý bot
--   • ⏰ 30 phút trước tin Đỏ / Cam trên lịch kinh tế (giống lịch MT5)
--   • ⚡ Giá vàng chạy mạnh (≤ 1 lần / giờ / mức)
--   • ✅ Hết cảnh báo → bot chạy lại bình thường
--   • ☀️ 7:00 sáng: lịch tin Đỏ / Cam trong ngày + mức cảnh báo hiện tại
--  Cài đặt ở web: Quản trị → Telegram (dán token bot, tìm nhóm, gửi thử).
-- Chạy SAU 006. Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================

create table if not exists public.tg_chats (
  id          bigserial primary key,
  name        text not null,
  chat_id     text not null unique,
  min_level   text not null default 'orange' check (min_level in ('orange', 'red')),
  send_news   boolean not null default true,
  send_events boolean not null default true,
  send_price  boolean not null default true,
  send_daily  boolean not null default true,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);
create table if not exists public.tg_sent (
  key      text not null,
  chat_id  text not null,
  sent_at  timestamptz not null default now(),
  preview  text,
  primary key (key, chat_id)
);
alter table public.tg_chats enable row level security;
alter table public.tg_sent  enable row level security;

-- chuyển cấu hình cũ (nếu đã điền telegram_chat)
insert into public.tg_chats (name, chat_id)
select 'Nhóm Telegram', value from public.bot_config where key = 'telegram_chat' and coalesce(value, '') <> ''
on conflict (chat_id) do nothing;

create or replace function public.lv_num(l text) returns int language sql immutable as $$
  select case l when 'red' then 3 when 'orange' then 2 when 'yellow' then 1 else 0 end $$;

create or replace function public.tg_esc(s text) returns text language sql immutable as $$
  select replace(replace(replace(coalesce(s, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') $$;

create or replace function public.tg_advice(l text) returns text language sql immutable as $$
  select case l
    when 'red'    then 'Nên TẮT BOT hoặc GIẢM VOL mạnh, không mở lệnh mới cho đến khi hết cảnh báo. Lệnh đang âm sâu cân nhắc đóng bớt để giữ DD ngày.'
    when 'orange' then 'Nên GIẢM VOL (ví dụ còn 50%), theo dõi sát DD trong ngày, tránh nhồi lệnh.'
    else 'Bot chạy bình thường.' end $$;

-- gửi 1 tin (HTML) tới 1 chat
create or replace function public.tg_send(p_chat text, p_html text) returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare v_tok text;
begin
  select value into v_tok from bot_config where key = 'telegram_token';
  if coalesce(v_tok, '') = '' or coalesce(p_chat, '') = '' then return null; end if;
  return net.http_post(url := 'https://api.telegram.org/bot' || v_tok || '/sendMessage',
                       body := jsonb_build_object('chat_id', p_chat, 'text', left(p_html, 4000), 'parse_mode', 'HTML', 'disable_web_page_preview', true),
                       timeout_milliseconds := 8000);
end $$;

-- gửi cho mọi nhóm phù hợp, mỗi (key, nhóm) chỉ 1 lần
create or replace function public.tg_broadcast(p_key text, p_kind text, p_level text, p_html text) returns int
language plpgsql security definer set search_path = public as $$
declare c record; n int := 0;
begin
  for c in select * from tg_chats where enabled
             and lv_num(p_level) >= lv_num(min_level)
             and case p_kind when 'news' then send_news when 'event' then send_events when 'price' then send_price
                             when 'daily' then send_daily else true end loop
    insert into tg_sent (key, chat_id, preview) values (p_key, c.chat_id, left(p_html, 200)) on conflict do nothing;
    if found then perform tg_send(c.chat_id, p_html); n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function public.tg_tick() returns void
language plpgsql security definer set search_path = public as $$
declare
  st jsonb; v_lvl text; v_prev text; v_prev_at timestamptz; r record; txt text; v_now timestamptz := now();
  v_vn timestamp := now() at time zone 'Asia/Ho_Chi_Minh'; lst text;
  web text := E'\n<a href="https://lion-bot.pages.dev/#/news">Xem chi tiết trên Lion Bot</a>';
begin
  if not exists (select 1 from bot_config where key = 'telegram_token' and coalesce(value, '') <> '')
     or not exists (select 1 from tg_chats where enabled) then return; end if;
  st := market_status(); v_lvl := st->>'level';

  -- 1) tin tức mới Đỏ / Cam (gộp tối đa 5 tin / lần)
  for r in select level, string_agg(
              case level when 'red' then '🔴' else '🟠' end || ' <b>' || score || ' điểm</b> · ' || tg_esc(title)
              || E'\n<i>' || tg_esc(coalesce(source, '')) || ' · ' || to_char(published at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM')
              || case when array_length(tags, 1) > 0 then ' · ' || tg_esc(array_to_string(tags, ', ')) else '' end || '</i>'
              || case when link is not null then E'\n<a href="' || tg_esc(link) || '">Đọc tin</a>' else '' end, E'\n\n' order by score desc) as body,
              string_agg(id::text, ',') as ids
             from (select * from news_items
                    where level in ('red', 'orange') and created_at > v_now - interval '20 minutes' and published > v_now - interval '3 hours'
                      and not exists (select 1 from tg_sent s where s.key = 'news:' || news_items.id)
                    order by score desc limit 5) x
            group by level order by lv_num(level) desc loop
    txt := case r.level when 'red' then '🚨 <b>LION BOT · TIN ĐỎ</b>' else '⚠️ <b>LION BOT · TIN CAM</b>' end || E'\n\n' || r.body
        || E'\n\n👉 <b>Lời khuyên:</b> ' || tg_advice(r.level)
        || case when st->>'price' is not null then E'\n💰 Giá vàng: $' || to_char((st->>'price')::numeric, 'FM999G990D00') else '' end || web;
    perform tg_broadcast('news:' || split_part(r.ids, ',', 1), 'news', r.level, txt);
    -- đánh dấu các tin còn lại trong nhóm là đã gửi (để không gửi lại)
    insert into tg_sent (key, chat_id) select 'news:' || unnest(string_to_array(r.ids, ',')), '*' on conflict do nothing;
  end loop;

  -- 2) 30 phút trước tin lịch Đỏ / Cam
  for r in select * from econ_events where level in ('red', 'orange') and at > v_now and at <= v_now + interval '30 minutes' order by at loop
    txt := '⏰ <b>' || to_char(r.at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') || ' ra tin ' || case r.level when 'red' then '🔴 ĐỎ' else '🟠 CAM' end || '</b> · '
        || tg_esc(r.country) || E'\n<b>' || tg_esc(r.title) || '</b>'
        || case when r.forecast is not null or r.previous is not null then E'\nDự báo: ' || coalesce(tg_esc(r.forecast), '—') || ' · Kỳ trước: ' || coalesce(tg_esc(r.previous), '—') else '' end
        || E'\n\n👉 <b>Lời khuyên:</b> ' || tg_advice(r.level)
        || E'\nKhung nên thận trọng: ' || to_char((r.at - interval '30 minutes') at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') || ' – '
        || to_char((r.at + interval '30 minutes') at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') || web;
    perform tg_broadcast('ev30:' || r.uid, 'event', r.level, txt);
  end loop;

  -- 3) giá chạy mạnh
  for r in select * from jsonb_to_recordset(st->'reasons') as x(kind text, level text, text text) where kind = 'price' loop
    txt := case r.level when 'red' then '⚡ <b>LION BOT · GIÁ VÀNG CHẠY RẤT MẠNH</b>' else '⚡ <b>LION BOT · GIÁ VÀNG BIẾN ĐỘNG</b>' end
        || E'\n\n' || tg_esc(r.text) || E'\n💰 Giá hiện tại: $' || to_char((st->>'price')::numeric, 'FM999G990D00')
        || E'\n\n👉 <b>Lời khuyên:</b> ' || tg_advice(r.level) || web;
    perform tg_broadcast('price:' || r.level || ':' || to_char(v_vn, 'YYYYMMDDHH24'), 'price', r.level, txt);
  end loop;

  -- 4) hết cảnh báo (từ Cam/Đỏ về Vàng/Xanh và giữ được ≥ 15 phút)
  select value into v_prev from bot_config where key = 'tg_last_level';
  select nullif(value, '')::timestamptz into v_prev_at from bot_config where key = 'tg_last_level_at';
  if v_prev is distinct from v_lvl then
    insert into bot_config values ('tg_last_level', v_lvl) on conflict (key) do update set value = excluded.value;
    insert into bot_config values ('tg_last_level_at', v_now::text) on conflict (key) do update set value = excluded.value;
    if lv_num(v_lvl) >= 2 then
      insert into bot_config values ('tg_alert_on', 'yes') on conflict (key) do update set value = excluded.value;
    end if;
  elsif lv_num(v_lvl) <= 1 and v_prev_at < v_now - interval '15 minutes'
        and exists (select 1 from bot_config where key = 'tg_alert_on' and value = 'yes') then
    update bot_config set value = 'no' where key = 'tg_alert_on';
    txt := E'✅ <b>LION BOT · HẾT CẢNH BÁO</b>\n\nThị trường đã ổn định hơn (mức hiện tại: ' || case v_lvl when 'yellow' then '🟡 Vàng' else '🟢 Xanh' end
        || E').\n👉 Bot có thể chạy lại bình thường. Vẫn theo dõi DD trong ngày.' || web;
    perform tg_broadcast('clear:' || to_char(v_vn, 'YYYYMMDDHH24MI'), 'clear', 'red', txt);
  end if;

  -- 5) bản tin 7:00 sáng (giờ VN)
  if extract(hour from v_vn) = 7 and extract(minute from v_vn) < 10 then
    select string_agg(case level when 'red' then '🔴 ' else '🟠 ' end || to_char(at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') || ' · '
                      || tg_esc(country) || ' · ' || tg_esc(title), E'\n' order by at)
      into lst from econ_events
     where level in ('red', 'orange') and at between v_now and v_now + interval '24 hours';
    txt := E'☀️ <b>LION BOT · BẢN TIN ' || to_char(v_vn, 'DD/MM') || E'</b>\n\n'
        || 'Mức cảnh báo hiện tại: ' || case v_lvl when 'red' then '🔴 ĐỎ' when 'orange' then '🟠 CAM' when 'yellow' then '🟡 VÀNG' else '🟢 XANH' end
        || case when st->>'price' is not null then E'\n💰 Giá vàng: $' || to_char((st->>'price')::numeric, 'FM999G990D00') else '' end
        || E'\n\n<b>Lịch tin Đỏ / Cam 24 giờ tới (giờ VN):</b>\n' || coalesce(lst, 'Không có tin Đỏ / Cam.')
        || E'\n\n👉 Quanh giờ ra tin 🔴: nên tạm dừng bot hoặc giảm vol (30 phút trước → 30 phút sau).' || web;
    perform tg_broadcast('daily:' || to_char(v_vn, 'YYYYMMDD'), 'daily', 'red', txt);
  end if;

  delete from tg_sent where sent_at < v_now - interval '14 days';
end $$;

-- vòng chạy mỗi phút: thay alert_notify cũ bằng tg_tick
create or replace function public.alert_notify() returns void
language plpgsql security definer set search_path = public as $$
begin perform public.tg_tick(); end $$;

revoke all on function public.tg_send(text, text), public.tg_broadcast(text, text, text, text), public.tg_tick(), public.alert_notify()
  from public, anon, authenticated;

-- ---------------------------------------------------------------- màn cài đặt (chỉ quản lý)
create or replace function public.tg_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tok text;
begin
  if not public.is_admin() then raise exception 'Chỉ quản lý'; end if;
  select value into v_tok from bot_config where key = 'telegram_token';
  return jsonb_build_object(
    'has_token', coalesce(v_tok, '') <> '',
    'token_hint', case when coalesce(v_tok, '') <> '' then split_part(v_tok, ':', 1) || ':' || left(split_part(v_tok, ':', 2), 3) || '•••' end,
    'chats', coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from tg_chats c), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(x order by x.sent_at desc) from (
              select s.sent_at, s.preview, c.name from tg_sent s left join tg_chats c on c.chat_id = s.chat_id
               where s.chat_id <> '*' order by s.sent_at desc limit 30) x), '[]'::jsonb));
end $$;

create or replace function public.tg_save_token(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Chỉ quản lý'; end if;
  if coalesce(trim(p_token), '') !~ '^[0-9]{5,}:[A-Za-z0-9_-]{20,}$' then raise exception 'Token không đúng dạng (ví dụ 123456789:AAH...)'; end if;
  insert into bot_config values ('telegram_token', trim(p_token)) on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true);
end $$;

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
      send_daily = coalesce((p->>'send_daily')::boolean, true), enabled = coalesce((p->>'enabled')::boolean, true)
     where id = (p->>'id')::bigint returning id into v_id;
  else
    insert into tg_chats (name, chat_id, min_level, send_news, send_events, send_price, send_daily, enabled)
    values (coalesce(nullif(trim(p->>'name'), ''), 'Nhóm'), trim(p->>'chat_id'), coalesce(p->>'min_level', 'orange'),
            coalesce((p->>'send_news')::boolean, true), coalesce((p->>'send_events')::boolean, true),
            coalesce((p->>'send_price')::boolean, true), coalesce((p->>'send_daily')::boolean, true), coalesce((p->>'enabled')::boolean, true))
    on conflict (chat_id) do update set name = excluded.name returning id into v_id;
    -- không dội tin cũ vào nhóm mới
    insert into tg_sent (key, chat_id) select 'news:' || id, trim(p->>'chat_id') from news_items where created_at > now() - interval '1 day' on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.tg_delete_chat(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Chỉ quản lý'; end if;
  delete from tg_chats where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.tg_test(p_chat text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st jsonb := public.market_status(); v_req bigint;
begin
  if not public.is_admin() then raise exception 'Chỉ quản lý'; end if;
  v_req := tg_send(p_chat, E'✅ <b>LION BOT</b> đã kết nối nhóm này.\n\nNhóm sẽ nhận: tin tức Đỏ / Cam kèm lời khuyên, nhắc 30 phút trước tin lịch, cảnh báo giá chạy mạnh, bản tin 7:00 sáng.\n\nMức cảnh báo hiện tại: '
    || case st->>'level' when 'red' then '🔴 ĐỎ' when 'orange' then '🟠 CAM' when 'yellow' then '🟡 VÀNG' else '🟢 XANH' end
    || E'\n<a href="https://lion-bot.pages.dev/#/news">Tin tức trên Lion Bot</a>');
  if v_req is null then raise exception 'Chưa có token bot'; end if;
  return jsonb_build_object('ok', true, 'request', v_req);
end $$;

-- Tìm nhóm: gọi getUpdates của bot, vài giây sau đọc kết quả
create or replace function public.tg_discover() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare v_tok text;
begin
  if not public.is_admin() then raise exception 'Chỉ quản lý'; end if;
  select value into v_tok from bot_config where key = 'telegram_token';
  if coalesce(v_tok, '') = '' then raise exception 'Chưa có token bot'; end if;
  return net.http_get('https://api.telegram.org/bot' || v_tok || '/getUpdates?limit=100&allowed_updates=%5B%22message%22%2C%22channel_post%22%2C%22my_chat_member%22%5D', timeout_milliseconds := 8000);
end $$;

create or replace function public.tg_request_result(p_req bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r record; j jsonb;
begin
  if not public.is_admin() then raise exception 'Chỉ quản lý'; end if;
  select status_code, content into r from net._http_response where id = p_req;
  if not found then return jsonb_build_object('ready', false); end if;
  begin j := r.content::jsonb; exception when others then j := null; end;
  if r.status_code <> 200 then
    return jsonb_build_object('ready', true, 'ok', false, 'error', coalesce(j->>'description', 'HTTP ' || r.status_code));
  end if;
  return jsonb_build_object('ready', true, 'ok', true, 'chats', coalesce((
    select jsonb_agg(distinct jsonb_build_object('chat_id', c->>'id', 'title', coalesce(c->>'title', trim(coalesce(c->>'first_name', '') || ' ' || coalesce(c->>'last_name', ''))), 'type', c->>'type'))
      from jsonb_array_elements(j->'result') u,
           lateral (select coalesce(u->'message'->'chat', u->'channel_post'->'chat', u->'my_chat_member'->'chat') c) x
     where c is not null), '[]'::jsonb));
end $$;

grant execute on function public.tg_settings(), public.tg_save_token(text), public.tg_save_chat(jsonb), public.tg_delete_chat(bigint),
  public.tg_test(text), public.tg_discover(), public.tg_request_result(bigint) to authenticated;
