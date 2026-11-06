//+------------------------------------------------------------------+
//| LionBot_Example.mq5 · v1.2.0                                      |
//| VÍ DỤ cách gắn Lion Bot vào EA có sẵn. Dev chỉ cần chép 3 chỗ      |
//| đánh dấu [LION BOT] vào EA thật của mình.                          |
//+------------------------------------------------------------------+
#property version   "1.20"
#property description "Ví dụ gắn LionBot_Send.mqh vào EA"

#include <LionBot_Send.mqh>                 // [LION BOT] 1. thêm dòng include (file đặt trong MQL5\Include)

input long InpMagic = 0;                    // Magic number của bot (ví dụ; dùng lại input sẵn có của EA)

int OnInit()
{
   EventSetTimer(60);                       // [LION BOT] 2. bật timer 60 giây (EA đã có timer thì bỏ qua)
   // ... phần khởi tạo của EA ...
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   LB_Auto();                               // [LION BOT] 3. gửi trạng thái + tổng kết ngày tự động
   LB_RiskLevel();                          // (tùy chọn v1.2.0) cập nhật mức cảnh báo tin tức, tối đa 1 lần/phút
   // Chỉ tính lệnh của bot (bỏ lệnh tay):  LB_Auto(InpMagic);
   // Chỉ tính một mã:                       LB_Auto(-1, "XAUUSD");
   // ... phần timer có sẵn của EA (nếu có) ...
}

void OnTick()
{
   // ... chiến lược vào / thoát lệnh của EA ...
   // (tùy chọn v1.2.0) TRƯỚC KHI MỞ LỆNH MỚI:
   //   if(LB_RiskCache >= 3 || LB_NewsWindow(30, 30)) return;      // cảnh báo ĐỎ / sát tin đỏ USD: không vào lệnh mới
   //   double lot = LB_RiskLot(InpLot);                            // CAM: tự giảm còn 50% lot
   //   (LB_RiskCache được cập nhật bởi LB_RiskLevel() gọi trong OnTimer, không tốn thời gian trong OnTick)
}
//+------------------------------------------------------------------+
