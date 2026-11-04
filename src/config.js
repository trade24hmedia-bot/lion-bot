// Địa chỉ dự án Supabase và khóa công khai (anon key).
// Khóa anon được thiết kế để nằm trong web công khai: mọi quyền đọc/ghi đều do phân quyền trong cơ sở dữ liệu quyết định.
// Lấy ở Supabase → Project Settings → API (hoặc Data API).
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://sypkzdcazdzekmgmgfhu.supabase.co';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5cGt6ZGNhemR6ZWttZ21nZmh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3Nzg1MDIsImV4cCI6MjEwOTM1NDUwMn0.W81InK_7Gpo1U14sl76cVia5DXZx9owTZZskX8GAU3Q';
