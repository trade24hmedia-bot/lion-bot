//+------------------------------------------------------------------+
//| LionBot_Example.mq5 · v1.1.0                                      |
//| VÍ DỤ cách gắn Lion Bot vào EA có sẵn. Dev chỉ cần chép 3 chỗ      |
//| đánh dấu [LION BOT] vào EA thật của mình.                          |
//+------------------------------------------------------------------+
#property version   "1.10"
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
   // Chỉ tính lệnh của bot (bỏ lệnh tay):  LB_Auto(InpMagic);
   // Chỉ tính một mã:                       LB_Auto(-1, "XAUUSD");
   // ... phần timer có sẵn của EA (nếu có) ...
}

void OnTick()
{
   // ... chiến lược vào / thoát lệnh của EA, KHÔNG gọi hàm Lion Bot ở đây ...
}
//+------------------------------------------------------------------+
