//+------------------------------------------------------------------+
//| LionBot_TestConnection.mq5 · v1.2.0                               |
//| Script kiểm tra kết nối Lion Bot trên một tài khoản.               |
//| Kéo script vào chart → dán mã khóa EA vào InpLB_Key → OK.           |
//| Kết quả hiện ở cửa sổ Alert và tab Experts.                        |
//+------------------------------------------------------------------+
#property script_show_inputs
#property version   "1.20"

#include <LionBot_Send.mqh>

input bool InpSendYesterday = false;   // Gửi luôn kết quả ngày hôm qua (để thử)

void OnStart()
{
   if(LB_Trim(InpLB_Key) == "") { Alert("Lion Bot: chưa dán mã khóa EA vào InpLB_Key"); return; }
   string acc = IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + " · " + AccountInfoString(ACCOUNT_SERVER);
   bool ok = LB_SendStatus(LB_CurDD());
   if(!ok)
   {
      if(StringFind(LB_LastReply, "4014") >= 0)
         Alert("Lion Bot ✗ MT5 chưa cho phép WebRequest. Vào Tools > Options > Expert Advisors, tích Allow WebRequest và thêm: ", InpLB_Url);
      else if(StringFind(LB_LastReply, "invalid key") >= 0)
         Alert("Lion Bot ✗ Mã khóa EA sai. Chép lại ở web Lion Bot → Quản trị → Tài khoản & mã EA (đúng tài khoản ", acc, ")");
      else
         Alert("Lion Bot ✗ Không gửi được: ", LB_LastReply);
      return;
   }
   string msg = "Lion Bot ✓ Kết nối OK cho TK " + acc + ". Web đã nhận số dư / equity.";
   if(InpSendYesterday)
      msg += LB_ResendDay(TimeCurrent() - 86400) ? " Đã gửi kết quả hôm qua." : " Gửi kết quả hôm qua lỗi: " + LB_LastReply;
   int lv = LB_RiskLevel();
   string names[] = {"XANH", "VANG", "CAM", "DO"};
   msg += lv >= 0 && lv <= 3 ? " Mức cảnh báo tin tức hiện tại: " + names[lv] + "." : " (Chưa đọc được mức cảnh báo tin tức.)";
   if(LB_NewsWindow(30, 30)) msg += " Đang trong ±30 phút quanh tin đỏ USD (lịch MT5).";
   Alert(msg);
}
//+------------------------------------------------------------------+
