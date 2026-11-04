//+------------------------------------------------------------------+
//| LionBot_Send.mqh  ·  v1.0.0                                      |
//| Gửi kết quả giao dịch về Lion Bot (Supabase).                    |
//| Chạy SONG SONG với BotVangDesk_SendDaily.mqh (Google Sheet) trong |
//| thời gian chuyển đổi; hai file dùng tên hàm khác nhau.            |
//+------------------------------------------------------------------+
//
// GỬI DEV — CÁCH GẮN VÀO EA
// --------------------------
// 1. Chép file vào MQL5\Include\ và thêm vào đầu EA:  #include <LionBot_Send.mqh>
// 2. Tổng kết ngày: ngay chỗ EA gửi "TỔNG KẾT NGÀY" lên Telegram, gọi thêm:
//        LB_SendDaily(ngayTongKet, profit, swap, phi, tongLots, AccountInfoDouble(ACCOUNT_BALANCE), soLenh, ddMaxPct);
//    - ngayTongKet: datetime trong NGÀY ĐƯỢC TỔNG KẾT (giờ sàn), không phải giờ gửi.
//    - phi: phí + commission, SỐ ÂM nếu bị trừ. soLenh, ddMaxPct: không có thì truyền -1.
//    Hàm tự đọc từng giao dịch nạp / rút / bonus / credit trong ngày từ lịch sử MT5
//    (mã deal là khóa, gửi lại không trùng) và tự lùi số dư về CUỐI NGÀY tổng kết.
// 3. Trạng thái (PNL chưa chốt): trong OnTimer, khoảng 2–5 phút một lần khi có lệnh mở:
//        LB_SendStatus(ddPctHienTai);   // không có DD thì truyền -1
// 4. Inputs mới kỹ thuật điền khi gắn EA:
//    - InpLB_Url: https://sypkzdcazdzekmgmgfhu.supabase.co   (cố định, có sẵn)
//    - InpLB_Key: MÃ KHÓA EA RIÊNG CỦA TÀI KHOẢN NÀY (lấy ở web Lion Bot → Quản trị →
//      Tài khoản & mã EA → Chép). Mỗi tài khoản một mã khác nhau.
// 5. MT5: Tools > Options > Expert Advisors > Allow WebRequest, thêm:
//        https://sypkzdcazdzekmgmgfhu.supabase.co
//
// Gửi lỗi (mất mạng, máy chủ bận): hàm tự thử lại 3 lần, mỗi lần cách 2 giây, rồi ghi log.
// Gửi lại cùng ngày thì máy chủ ghi đè, không cộng trùng: dev có thể gọi lại LB_SendDaily cho ngày bị lỗi.
//+------------------------------------------------------------------+
#property strict

input string InpLB_Url = "https://sypkzdcazdzekmgmgfhu.supabase.co"; // Lion Bot: địa chỉ máy chủ
input string InpLB_Key = "";                                        // Lion Bot: mã khóa EA của tài khoản này

// Khóa công khai (anon) của dự án: chỉ cho phép gọi 2 hàm nhận dữ liệu, không đọc được gì.
#define LB_ANON "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5cGt6ZGNhemR6ZWttZ21nZmh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3Nzg1MDIsImV4cCI6MjEwOTM1NDUwMn0.W81InK_7Gpo1U14sl76cVia5DXZx9owTZZskX8GAU3Q"

string LB_N(const double v) { return DoubleToString(v, 2); }
string LB_E(string s) { StringReplace(s, "\\", "\\\\"); StringReplace(s, "\"", "\\\""); return s; }
string LB_Trim(string s) { StringTrimLeft(s); StringTrimRight(s); return s; }

bool LB_Post(const string fn, const string pjson)
{
   string url = LB_Trim(InpLB_Url), key = LB_Trim(InpLB_Key);
   if(url == "" || key == "") return false;
   string body = "{\"p\":" + pjson + "}";
   char data[], result[]; string resHeaders;
   int n = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(n > 0) ArrayResize(data, n - 1);
   string headers = "Content-Type: application/json\r\napikey: " + LB_ANON + "\r\nAuthorization: Bearer " + LB_ANON + "\r\n";
   for(int attempt = 1; attempt <= 3; attempt++)
   {
      ResetLastError();
      int code = WebRequest("POST", url + "/rest/v1/rpc/" + fn, headers, 10000, data, result, resHeaders);
      string reply = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
      if(code == 200 && StringFind(reply, "\"ok\": true") >= 0) return true;
      if(code == 200 && StringFind(reply, "\"ok\":true") >= 0) return true;
      if(code == 200) { PrintFormat("LionBot: %s bi tu choi: %s", fn, StringSubstr(reply, 0, 160)); return false; }   // sai mã, sai ngày: thử lại cũng vô ích
      if(code == -1) PrintFormat("LionBot: loi WebRequest %d (4014 = chua cho phep %s)", GetLastError(), url);
      else           PrintFormat("LionBot: may chu tra %d, thu lai %d/3", code, attempt);
      Sleep(2000);
   }
   return false;
}

// Danh sách nạp / rút / bonus / credit trong ngày + số tiền phát sinh SAU ngày (để lùi số dư)
string LB_Transfers(const datetime d0, const datetime d1, double &after)
{
   after = 0;
   string arr = "";
   if(!HistorySelect(d0, TimeCurrent() + 86400)) return "[]";
   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong tk = HistoryDealGetTicket(i);
      if(tk == 0) continue;
      datetime tm  = (datetime)HistoryDealGetInteger(tk, DEAL_TIME);
      long     typ = HistoryDealGetInteger(tk, DEAL_TYPE);
      double   pr  = HistoryDealGetDouble(tk, DEAL_PROFIT);
      if(tm >= d1)
      {
         if(typ != DEAL_TYPE_CREDIT)
            after += pr + HistoryDealGetDouble(tk, DEAL_SWAP) + HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_FEE);
         continue;
      }
      string t = "";
      if(typ == DEAL_TYPE_BALANCE)      t = pr >= 0 ? "deposit" : "withdraw";
      else if(typ == DEAL_TYPE_BONUS)   t = pr >= 0 ? "bonusIn" : "bonusOut";
      else if(typ == DEAL_TYPE_CREDIT)  t = pr >= 0 ? "creditIn" : "creditOut";
      else continue;
      if(arr != "") arr += ",";
      arr += "{\"type\":\"" + t + "\",\"ticket\":\"" + IntegerToString((long)tk) + "\",\"amount\":" + LB_N(pr)
           + ",\"time\":\"" + TimeToString(tm, TIME_DATE | TIME_SECONDS) + "\",\"comment\":\"" + LB_E(HistoryDealGetString(tk, DEAL_COMMENT)) + "\"}";
   }
   return "[" + arr + "]";
}

bool LB_SendDaily(const datetime day, const double profit, const double swap, const double fee,
                  const double lots, const double balanceNow, const int trades = -1, const double ddMaxPct = -1)
{
   datetime d0 = day - (day % 86400), d1 = d0 + 86400;
   double after;
   string tr = LB_Transfers(d0, d1, after);
   MqlDateTime t; TimeToStruct(d0, t);
   string p = "{\"key\":\"" + LB_E(LB_Trim(InpLB_Key)) + "\""
      + ",\"date\":\"" + StringFormat("%04d-%02d-%02d", t.year, t.mon, t.day) + "\""
      + ",\"profit\":" + LB_N(profit) + ",\"swap\":" + LB_N(swap) + ",\"fee\":" + LB_N(fee)
      + ",\"net\":" + LB_N(profit + swap + fee) + ",\"lots\":" + LB_N(lots)
      + ",\"balance\":" + LB_N(balanceNow - after)
      + (trades >= 0 ? ",\"trades\":" + IntegerToString(trades) : "")
      + (ddMaxPct >= 0 ? ",\"ddMaxPct\":" + LB_N(ddMaxPct) : "")
      + ",\"transfers\":" + tr + "}";
   bool ok = LB_Post("ingest_daily", p);
   if(ok) PrintFormat("LionBot: da gui ket qua ngay %04d-%02d-%02d", t.year, t.mon, t.day);
   return ok;
}

bool LB_SendStatus(const double ddPct = -1)
{
   double bal = AccountInfoDouble(ACCOUNT_BALANCE), eq = AccountInfoDouble(ACCOUNT_EQUITY);
   string p = "{\"key\":\"" + LB_E(LB_Trim(InpLB_Key)) + "\""
      + ",\"balance\":" + LB_N(bal) + ",\"equity\":" + LB_N(eq) + ",\"floating\":" + LB_N(eq - bal - AccountInfoDouble(ACCOUNT_CREDIT))
      + ",\"positions\":" + IntegerToString(PositionsTotal())
      + (ddPct >= 0 ? ",\"ddPct\":" + LB_N(ddPct) : "") + "}";
   return LB_Post("ingest_status", p);
}
//+------------------------------------------------------------------+
