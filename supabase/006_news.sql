-- =====================================================================
-- LION BOT · bổ sung 1.5.0 (06/11/2026): TIN TỨC VÀNG + CẢNH BÁO BIẾN ĐỘNG
--  Chạy hoàn toàn trong Supabase (pg_cron + pg_net), không tốn thêm phí:
--   * Mỗi phút: giá vàng XAU (api.gold-api.com) → phát hiện giá chạy mạnh
--   * 5 phút/lần: tin Google News về vàng (tiếng Anh + tiếng Việt) → chấm điểm 0–100
--   * 60 phút/lần: lịch kinh tế ForexFactory (tin đỏ / cam giống lịch MT5)
--   * market_status(): mức cảnh báo hiện tại XANH / VÀNG / CAM / ĐỎ + lời khuyên (tắt bot / giảm vol)
--   * Tùy chọn: báo Telegram khi lên CAM / ĐỎ (điền token ở bảng bot_config)
--  Cũng sửa: Tổng quan khách, chế độ "Tất cả tài khoản" ẩn luôn tên nhánh của khách khác.
-- Chạy SAU 005. Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================

-- ---------------------------------------------------------------- sửa: ẩn nhánh của khách khác
create or replace function public.portal_period(p_from date, p_to date, p_scope text default 'mine')
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
  select id, public.mask_no(account_no), broker, currency, case when can then cname end, case when can then sname end,
         coalesce(customer_id = public.my_customer_id(), false) or (public.is_admin() and public.my_customer_id() is null),
         can, status, cap, round(public.to_usd(cap, currency), 2), sb,
         round(pn, 2), round(public.to_usd(pn, currency), 2), dep, wd,
         case when coalesce(sb, 0) + dep > 0 then round(pn / (coalesce(sb, 0) + dep) * 100, 2) end,
         round(public.to_usd(pt, currency), 2), nd, seen
    from acc order by can desc, cname, account_no $$;

-- ---------------------------------------------------------------- bảng
create table if not exists public.gold_ticks (
  ts     timestamptz primary key,
  price  numeric not null
);

create table if not exists public.news_items (
  id         bigserial primary key,
  uid        text unique not null,          -- md5(tiêu đề chuẩn hóa) để không trùng tin
  lang       text not null,                 -- en / vi
  title      text not null,
  source     text,
  link       text,
  published  timestamptz not null,
  score      int not null,
  level      text not null,                 -- red / orange / yellow / info
  tags       text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists news_items_pub_idx on public.news_items (published desc);

create table if not exists public.econ_events (
  uid       text primary key,               -- md5(tiêu đề + nước + giờ)
  title     text not null,
  country   text not null,
  at        timestamptz not null,
  impact    text not null,                  -- High / Medium / Low / Holiday
  level     text not null,                  -- red / orange / yellow / info
  forecast  text,
  previous  text,
  updated_at timestamptz not null default now()
);
create index if not exists econ_events_at_idx on public.econ_events (at);

create table if not exists public.news_requests (
  id         bigint primary key,            -- id yêu cầu của pg_net
  kind       text not null,
  created_at timestamptz not null default now(),
  done       boolean not null default false,
  note       text
);

-- Cấu hình riêng (token Telegram…). KHÔNG mở cho web đọc.
create table if not exists public.bot_config (
  key   text primary key,
  value text
);
create table if not exists public.alert_log (
  id       bigserial primary key,
  level    text not null,
  reason   text not null,
  sent_at  timestamptz not null default now()
);

alter table public.gold_ticks    enable row level security;
alter table public.news_items    enable row level security;
alter table public.econ_events   enable row level security;
alter table public.news_requests enable row level security;
alter table public.bot_config    enable row level security;
alter table public.alert_log     enable row level security;
-- (không tạo policy: web chỉ đọc qua hàm market_feed / market_status bên dưới)

-- ---------------------------------------------------------------- chấm điểm tin
-- Điểm = 10 + tổng trọng số các nhóm từ khóa xuất hiện (tối đa 100).
-- >= 70 ĐỎ (rủi ro rất cao) · >= 45 CAM · >= 25 VÀNG · còn lại: tin thường
create or replace function public.news_score(p_title text, out score int, out level text, out tags text[])
language plpgsql immutable as $$
declare
  t text := ' ' || lower(coalesce(p_title, '')) || ' ';
  r record;
begin
  score := 10; tags := '{}';
  for r in select * from (values
    -- chiến sự / địa chính trị
    ('(\m(war|wars|missile|missiles|airstrike|air strike|invasion|invade[sd]?|troops|military|nuclear|bombing|drone attack|attack(s|ed)? on|escalat\w*|retaliat\w*)\M|chiến tranh|tên lửa|không kích|tấn công|xung đột|quân sự|hạt nhân|leo thang|trả đũa)', 35, 'Chiến sự'),
    ('(\m(iran|israel|gaza|hezbollah|houthi|russia|ukraine|taiwan|north korea|middle east|red sea)\M|\miran\M|\misrael\M|\mnga\M|\mukraine\M|đài loan|triều tiên|trung đông|biển đỏ)', 15, 'Địa chính trị'),
    -- Fed / lãi suất
    ('(\m(fed|fomc|powell|federal reserve|rate cut|rate cuts|rate hike|rate hikes|interest rates?|rate decision|dot plot|hawkish|dovish)\M|lãi suất|cục dự trữ|\mfed\M|powell|diều hâu|bồ câu)', 30, 'Fed / lãi suất'),
    -- dữ liệu kinh tế Mỹ
    ('(\m(cpi|inflation|nonfarm|non-farm|payrolls|nfp|jobs report|jobless|unemployment|pce|gdp|retail sales|ppi|ism)\M|lạm phát|bảng lương|việc làm|thất nghiệp|\mcpi\M|\mgdp\M)', 25, 'Dữ liệu Mỹ'),
    -- chính trị Mỹ / bầu cử
    ('(\m(election|elections|midterms?|democrats?|republicans?|impeach\w*|government shutdown|shutdown|debt ceiling|white house|trump)\M|bầu cử|đảng dân chủ|đảng cộng hòa|đóng cửa chính phủ|trần nợ|nhà trắng|\mtrump\M)', 25, 'Chính trị Mỹ'),
    -- thuế quan / trừng phạt
    ('(\m(tariffs?|trade war|sanctions?|embargo)\M|thuế quan|chiến tranh thương mại|trừng phạt|cấm vận)', 20, 'Thuế quan / trừng phạt'),
    -- giá chạy mạnh
    ('(\m(surges?|surging|soars?|soaring|skyrockets?|spikes?|jumps?|plunges?|plunging|crash(es|ed)?|tumbles?|slumps?|sinks?|rall(y|ies|ied)|record high|all-time high|fresh high|biggest (daily|weekly|one-day)|volatil\w*|sell-off|selloff)\M|tăng vọt|tăng sốc|tăng dựng đứng|lao dốc|giảm sốc|lập đỉnh|kỷ lục|tăng mạnh|giảm mạnh|bốc hơi|biến động mạnh|đỏ lửa)', 25, 'Giá chạy mạnh'),
    -- dòng tiền NHTW / trú ẩn
    ('(central banks? (buy|buying|purchas\w*)|\mpboc\M|people''s bank of china|safe[- ]haven|ngân hàng trung ương mua|trú ẩn an toàn)', 10, 'Dòng tiền trú ẩn'),
    -- USD / lợi suất
    ('(\m(dollar|dxy|treasury yields?|bond yields?|yields)\M|đồng usd|đô la|lợi suất)', 10, 'USD / lợi suất')
  ) v(pat, w, tag) loop
    if t ~* r.pat then score := score + r.w; tags := tags || r.tag; end if;
  end loop;
  score := least(score, 100);
  level := case when score >= 70 then 'red' when score >= 45 then 'orange' when score >= 25 then 'yellow' else 'info' end;
end $$;

-- ---------------------------------------------------------------- xử lý dữ liệu tải về
create or replace function public.xml_unescape(s text) returns text language sql immutable as $$
  select replace(replace(replace(replace(replace(replace(coalesce(s, ''), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&apos;', ''''), '&amp;', '&') $$;

create or replace function public.safe_ts(s text) returns timestamptz language plpgsql immutable as $$
begin return s::timestamptz; exception when others then return null; end $$;

create or replace function public.news_ingest_rss(p_content text, p_lang text) returns int
language plpgsql security definer set search_path = public as $$
declare it xml; v_title text; v_src text; v_link text; v_pub timestamptz; s record; n int := 0;
begin
  for it in select unnest(xpath('/rss/channel/item', p_content::xml)) loop
    v_title := xml_unescape((xpath('/item/title/text()', it))[1]::text);
    v_src   := xml_unescape((xpath('/item/source/text()', it))[1]::text);
    v_link  := xml_unescape((xpath('/item/link/text()', it))[1]::text);
    v_pub   := safe_ts((xpath('/item/pubDate/text()', it))[1]::text);
    if v_title is null or v_title = '' or v_pub is null then continue; end if;
    if v_src is not null and right(v_title, length(v_src) + 3) = ' - ' || v_src then
      v_title := left(v_title, length(v_title) - length(v_src) - 3);
    end if;
    if v_pub < now() - interval '3 days' then continue; end if;
    s := news_score(v_title);
    insert into news_items (uid, lang, title, source, link, published, score, level, tags)
    values (md5(lower(regexp_replace(v_title, '\W+', '', 'g'))), p_lang, v_title, v_src, v_link, least(v_pub, now()), s.score, s.level, s.tags)
    on conflict (uid) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function public.news_ingest_calendar(p_content text) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; v_at timestamptz; v_lvl text; n int := 0;
begin
  for e in select * from jsonb_array_elements(p_content::jsonb) loop
    v_at := safe_ts(e->>'date');
    if v_at is null then continue; end if;
    v_lvl := case
      when e->>'impact' = 'High'   and e->>'country' = 'USD' then 'red'
      when e->>'impact' = 'High'   then 'orange'
      when e->>'impact' = 'Medium' and e->>'country' = 'USD' then 'orange'
      when e->>'impact' = 'Medium' then 'yellow'
      when e->>'impact' = 'Low'    and e->>'country' = 'USD' then 'yellow'
      else 'info' end;
    insert into econ_events (uid, title, country, at, impact, level, forecast, previous, updated_at)
    values (md5((e->>'title') || (e->>'country') || (e->>'date')), e->>'title', e->>'country', v_at, coalesce(e->>'impact', ''), v_lvl,
            nullif(e->>'forecast', ''), nullif(e->>'previous', ''), now())
    on conflict (uid) do update set impact = excluded.impact, level = excluded.level, forecast = excluded.forecast,
                                    previous = excluded.previous, updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.news_process() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare r record; n int := 0; v_note text;
begin
  for r in select q.id, q.kind, resp.status_code, resp.content
             from news_requests q join net._http_response resp on resp.id = q.id
            where not q.done order by q.id loop
    v_note := null;
    begin
      if r.status_code <> 200 then v_note := 'HTTP ' || r.status_code;
      elsif r.kind = 'gold' then
        insert into gold_ticks (ts, price)
        values (coalesce(safe_ts(r.content::jsonb->>'updatedAt'), now()), (r.content::jsonb->>'price')::numeric)
        on conflict (ts) do nothing;
      elsif r.kind = 'calendar' then v_note := news_ingest_calendar(r.content) || ' sự kiện';
      elsif r.kind like 'rss_%' then v_note := news_ingest_rss(r.content, split_part(r.kind, '_', 2)) || ' tin mới';
      end if;
    exception when others then v_note := 'lỗi: ' || sqlerrm;
    end;
    update news_requests set done = true, note = v_note where id = r.id;
    n := n + 1;
  end loop;
  update news_requests set done = true, note = 'không có phản hồi' where not done and created_at < now() - interval '10 minutes';
  return n;
end $$;

-- ---------------------------------------------------------------- trạng thái thị trường
create or replace function public.market_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_now timestamptz := now();
  p_last record; v_r15 numeric; v_r60 numeric; v_d15 numeric; v_d60 numeric; v_lo15 numeric; v_hi15 numeric; v_lo60 numeric; v_hi60 numeric;
  v_price_lvl int := 0; v_ev_lvl int := 0; v_news_lvl int := 0; v_lvl int; reasons jsonb := '[]'::jsonb;
  e record; nw record;
begin
  -- 1) giá: biên độ 15 phút / 60 phút
  select ts, price into p_last from gold_ticks order by ts desc limit 1;
  if p_last.ts is not null and p_last.ts > v_now - interval '15 minutes' then
    select min(price), max(price) into v_lo15, v_hi15 from gold_ticks where ts >= p_last.ts - interval '15 minutes';
    select min(price), max(price) into v_lo60, v_hi60 from gold_ticks where ts >= p_last.ts - interval '60 minutes';
    v_r15 := round(v_hi15 - v_lo15, 2); v_r60 := round(v_hi60 - v_lo60, 2);
    v_d15 := round(p_last.price - (select price from gold_ticks where ts >= p_last.ts - interval '15 minutes' order by ts limit 1), 2);
    v_d60 := round(p_last.price - (select price from gold_ticks where ts >= p_last.ts - interval '60 minutes' order by ts limit 1), 2);
    if v_r15 >= p_last.price * 0.0035 or v_r60 >= p_last.price * 0.007 then v_price_lvl := 3;
    elsif v_r15 >= p_last.price * 0.002 or v_r60 >= p_last.price * 0.004 then v_price_lvl := 2; end if;
    if v_price_lvl > 0 then
      reasons := reasons || jsonb_build_object('kind', 'price', 'level', case v_price_lvl when 3 then 'red' else 'orange' end,
        'text', format('Giá vàng biến động mạnh: %s$%s trong 15 phút, biên độ 60 phút $%s', case when v_d15 >= 0 then '+' else '−' end, abs(v_d15), v_r60));
    end if;
  end if;
  -- 2) tin lịch kinh tế: từ 30 phút trước đến 30 phút sau giờ ra tin
  for e in select * from econ_events where level in ('red', 'orange') and at between v_now - interval '30 minutes' and v_now + interval '30 minutes' order by at loop
    v_ev_lvl := greatest(v_ev_lvl, case e.level when 'red' then 3 else 2 end);
    reasons := reasons || jsonb_build_object('kind', 'event', 'level', e.level, 'at', e.at,
      'text', format('%s tin %s (%s) lúc %s', case when e.at > v_now then 'Sắp ra' else 'Vừa ra' end, e.title, e.country,
                     to_char(e.at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI')));
  end loop;
  -- 3) tin nóng trong 90 phút qua
  for nw in select * from news_items where published > v_now - interval '90 minutes' and level in ('red', 'orange') order by score desc, published desc limit 3 loop
    v_news_lvl := greatest(v_news_lvl, case nw.level when 'red' then 3 else 2 end);
    reasons := reasons || jsonb_build_object('kind', 'news', 'level', nw.level, 'at', nw.published, 'text', nw.title, 'link', nw.link, 'score', nw.score);
  end loop;
  if v_news_lvl = 0 and exists (select 1 from news_items where published > v_now - interval '90 minutes' and level = 'yellow') then v_news_lvl := 1; end if;
  v_lvl := greatest(v_price_lvl, v_ev_lvl, v_news_lvl);
  return jsonb_build_object(
    'level', case v_lvl when 3 then 'red' when 2 then 'orange' when 1 then 'yellow' else 'green' end,
    'level_num', v_lvl,
    'advice', case v_lvl
      when 3 then 'Rủi ro rất cao: nên TẮT BOT hoặc GIẢM VOL mạnh, không mở lệnh mới cho đến khi hết cảnh báo.'
      when 2 then 'Thận trọng: nên giảm vol, theo dõi sát DD trong ngày.'
      when 1 then 'Có tin cần chú ý, bot chạy bình thường.'
      else 'Thị trường bình thường.' end,
    'reasons', reasons,
    'price', p_last.price, 'price_at', p_last.ts, 'chg15', v_d15, 'chg60', v_d60, 'range15', v_r15, 'range60', v_r60,
    'next_red', (select jsonb_build_object('title', title, 'country', country, 'at', at) from econ_events
                  where level = 'red' and at > v_now order by at limit 1),
    'updated_at', v_now);
end $$;

-- Dữ liệu cho trang Tin tức (công khai)
create or replace function public.market_feed(p_hours int default 48) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'status', public.market_status(),
    'news', coalesce((select jsonb_agg(to_jsonb(n) - 'uid' - 'created_at' order by n.published desc) from (
               select * from news_items where published > now() - make_interval(hours => least(greatest(p_hours, 1), 168))
                order by published desc limit 150) n), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'uid' - 'updated_at' order by e.at) from econ_events e
               where e.at between now() - interval '12 hours' and now() + interval '7 days' and e.level <> 'info'), '[]'::jsonb),
    'ticks', coalesce((select jsonb_agg(jsonb_build_object('t', ts, 'p', price) order by ts) from gold_ticks
               where ts > now() - interval '24 hours'), '[]'::jsonb)) $$;

grant execute on function public.market_status(), public.market_feed(int) to anon, authenticated;
revoke all on function public.news_process(), public.news_ingest_rss(text, text), public.news_ingest_calendar(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- Telegram (tùy chọn)
-- Bật: insert into public.bot_config values ('telegram_token','<token bot>'), ('telegram_chat','<chat id nhóm>');
create or replace function public.alert_notify() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare st jsonb := market_status(); v_tok text; v_chat text; r jsonb; v_key text; v_msg text := '';
begin
  if (st->>'level_num')::int < 2 then return; end if;
  select value into v_tok from bot_config where key = 'telegram_token';
  select value into v_chat from bot_config where key = 'telegram_chat';
  if coalesce(v_tok, '') = '' or coalesce(v_chat, '') = '' then return; end if;
  for r in select * from jsonb_array_elements(st->'reasons') loop
    if r->>'level' not in ('red', 'orange') then continue; end if;
    v_key := md5(coalesce(r->>'kind', '') || coalesce(r->>'text', ''));
    if r->>'kind' = 'price' then v_key := 'price-' || (r->>'level'); end if;
    if exists (select 1 from alert_log where reason = v_key and sent_at > now() - interval '2 hours') then continue; end if;
    insert into alert_log (level, reason) values (r->>'level', v_key);
    v_msg := v_msg || case r->>'level' when 'red' then '🔴 ' else '🟠 ' end || (r->>'text') || E'\n';
  end loop;
  if v_msg = '' then return; end if;
  v_msg := case st->>'level' when 'red' then '🚨 LION BOT · CẢNH BÁO ĐỎ' else '⚠️ LION BOT · CẢNH BÁO CAM' end || E'\n'
        || 'Giá vàng: $' || coalesce(st->>'price', '?') || E'\n\n' || v_msg || E'\n👉 ' || (st->>'advice') || E'\nhttps://lion-bot.pages.dev/#/news';
  perform net.http_post(url := 'https://api.telegram.org/bot' || v_tok || '/sendMessage',
                        body := jsonb_build_object('chat_id', v_chat, 'text', v_msg, 'disable_web_page_preview', true));
end $$;
revoke all on function public.alert_notify() from public, anon, authenticated;

-- ---------------------------------------------------------------- vòng chạy mỗi phút
create or replace function public.news_tick() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare m int := extract(minute from now())::int; h jsonb := jsonb_build_object('User-Agent', 'Mozilla/5.0 (LionBot news)');
begin
  perform news_process();
  insert into news_requests (id, kind) values (net.http_get('https://api.gold-api.com/price/XAU', headers := h, timeout_milliseconds := 8000), 'gold');
  if m % 5 = 0 then
    insert into news_requests (id, kind) values
      (net.http_get('https://news.google.com/rss/search?q=gold+price+when:1d&hl=en-US&gl=US&ceid=US:en', headers := h, timeout_milliseconds := 10000), 'rss_en'),
      (net.http_get('https://news.google.com/rss/search?q=gold+(fed+OR+war+OR+missile+OR+election+OR+tariff+OR+inflation+OR+iran+OR+israel)+when:1d&hl=en-US&gl=US&ceid=US:en', headers := h, timeout_milliseconds := 10000), 'rss_en'),
      (net.http_get('https://news.google.com/rss/search?q=gi%C3%A1+v%C3%A0ng+th%E1%BA%BF+gi%E1%BB%9Bi+when:1d&hl=vi&gl=VN&ceid=VN:vi', headers := h, timeout_milliseconds := 10000), 'rss_vi');
  end if;
  if m = 7 or not exists (select 1 from econ_events where updated_at > now() - interval '2 hours') then
    if not exists (select 1 from news_requests where kind = 'calendar' and created_at > now() - interval '20 minutes') then
      insert into news_requests (id, kind) values (net.http_get('https://nfs.faireconomy.media/ff_calendar_thisweek.json', headers := h, timeout_milliseconds := 10000), 'calendar');
    end if;
  end if;
  perform alert_notify();
  -- dọn dữ liệu cũ
  if m = 30 then
    delete from gold_ticks where ts < now() - interval '3 days';
    delete from news_items where published < now() - interval '7 days';
    delete from news_requests where created_at < now() - interval '1 day';
    delete from econ_events where at < now() - interval '14 days';
    delete from alert_log where sent_at < now() - interval '30 days';
  end if;
end $$;
revoke all on function public.news_tick() from public, anon, authenticated;
