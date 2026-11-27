-- =====================================================================
-- LION BOT · 27/11/2026 (bản 1.16.0)
--  1) Trang chủ "Tăng trưởng tháng này" bị trống: TK mới mở trong tháng có số dư đầu tháng = 0
--     (vốn vào bằng lệnh nạp). Nay % = lãi tháng / (số dư đầu tháng + tiền nạp trong tháng),
--     giống cách tính ở trang Tổng quan.
--  2) Mức cảnh báo VÀNG không ghi lý do: nay kèm tối đa 3 tin Vàng gần nhất làm lý do.
-- Không đổi dữ liệu, chỉ thay 2 hàm. Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================
create or replace function public.public_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  with acc as (select a.id, a.currency from public.accounts a where a.status = 'active' and a.approved and a.customer_id is not null),
  cap as (select coalesce(sum(public.to_usd(public.acc_capital(acc.id), acc.currency)), 0) v from acc),
  d as (
    select r.date, sum(public.to_usd(r.net, acc.currency)) as net_usd
      from public.daily_results r join acc on acc.id = r.account_id group by r.date
  ),
  mon as (
    select date_trunc('month', r.date)::date as month,
           sum(public.to_usd(r.net, acc.currency)) as net_usd,
           sum(public.to_usd(public.acc_start_balance(acc.id, date_trunc('month', r.date)::date), acc.currency))
             filter (where r.date = (select min(r2.date) from public.daily_results r2
                                       where r2.account_id = r.account_id
                                         and date_trunc('month', r2.date) = date_trunc('month', r.date))) as start_usd
      from public.daily_results r join acc on acc.id = r.account_id group by 1
  ),
  dep as (
    select date_trunc('month', t.date)::date as month, sum(public.to_usd(t.amount, acc.currency)) as dep_usd
      from public.transfers t join acc on acc.id = t.account_id where t.type = 'deposit' group by 1
  )
  select jsonb_build_object(
    'capital_usd', (select round(v, 2) from cap),
    'profit_total_usd', (select round(coalesce(sum(net_usd), 0), 2) from d),
    'accounts', (select count(*) from acc),
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', mon.month, 'net_usd', round(mon.net_usd, 2),
                         'pct', case when coalesce(start_usd, 0) + coalesce(dep.dep_usd, 0) > 0
                                      then round(mon.net_usd / (coalesce(start_usd, 0) + coalesce(dep.dep_usd, 0)) * 100, 2) end) order by mon.month)
                         from mon left join dep on dep.month = mon.month), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(jsonb_build_object('date', date, 'cum', round(c, 2)) order by date)
                        from (select date, sum(net_usd) over (order by date) c from d) z), '[]'::jsonb),
    'updated_at', now()) $$;

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
  if v_news_lvl = 0 then
    for nw in select * from news_items where published > v_now - interval '90 minutes' and level = 'yellow' order by score desc, published desc limit 3 loop
      v_news_lvl := 1;
      reasons := reasons || jsonb_build_object('kind', 'news', 'level', nw.level, 'at', nw.published, 'text', nw.title, 'link', nw.link, 'score', nw.score);
    end loop;
  end if;
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
