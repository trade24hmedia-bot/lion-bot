// Địa chỉ dự án Supabase và khóa công khai (anon key).
// Khóa anon được thiết kế để nằm trong web công khai: mọi quyền đọc/ghi đều do phân quyền trong cơ sở dữ liệu quyết định.
// Lấy ở Supabase → Project Settings → API (hoặc Data API).
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR-ANON-KEY';
