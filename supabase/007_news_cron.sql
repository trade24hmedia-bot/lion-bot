-- LION BOT · lịch chạy tin tức mỗi phút (chạy SAU 006, chỉ chạy trên Supabase)
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
select cron.schedule('lionbot-news', '* * * * *', 'select public.news_tick()');
