# Lion Bot

Cổng xem kết quả bot vàng: trang công khai (số tổng), cổng khách hàng (đăng nhập bằng link email), quản trị cơ bản.

- Web: Vite + React, chạy trên Cloudflare Pages (build `npm run build`, thư mục `dist`).
- Dữ liệu: Supabase (PostgreSQL). Toàn bộ bảng, phân quyền và hàm nằm trong `supabase/schema.sql`.
- EA gửi dữ liệu: `ea/LionBot_Send.mqh`.

## Cài đặt
1. Supabase → SQL Editor → dán `supabase/schema.sql` → Run.
2. Điền URL và anon key của dự án vào `src/config.js`.
3. Cloudflare Pages → kết nối kho GitHub này → Framework: Vite, build `npm run build`, output `dist`.
4. Supabase → Authentication → URL Configuration: Site URL = địa chỉ web Cloudflare.
5. Đăng nhập web 1 lần bằng email quản lý, rồi chạy trong SQL Editor:
   `update public.profiles set role = 'admin' where email = '<email>';`
