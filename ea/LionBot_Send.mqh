//+------------------------------------------------------------------+
//| LionBot_Send.mqh  ·  v1.1.0  (04/11/2026)                         |
//| Gửi kết quả giao dịch của tài khoản MT5 về web Lion Bot           |
//| https://lion-bot.pages.dev  (máy chủ: Supabase)                   |
//+------------------------------------------------------------------+
//
// CÁCH GẮN NHANH (khuyên dùng) — chỉ thêm 3 dòng vào EA:
//   1. Chép file này vào  MQL5\Include\  rồi thêm ở đầu EA:   #include <LionBot_Send.mqh>
//   2. Trong OnInit():   EventSetTimer(60);          (nếu EA đã có timer thì giữ nguyên)
//   3. Trong OnTimer():  LB_Auto();                  (EA chưa có OnTimer thì tạo hàm mới)
//   LB_Auto() tự làm hết:
//     - Mỗi 5 phút (khi có lệnh mở) / 30 phút (khi không có lệnh): gửi số dư, equity, PNL chưa chốt, DD.
//     - Sang ngày mới (giờ sàn): tự tổng kết ngày hôm trước từ lịch sử MT5 (profit, swap, phí,
//       lots, số lệnh đóng, DD sâu nhất trong ngày) kèm từng giao dịch nạp / rút / bonus / credit, rồi gửi.
//     - Gửi lỗi (mất mạng, máy chủ bận): tự thử lại sau 10 phút, không mất ngày nào (bù tối đa 7 ngày).
//   Chỉ tính lệnh của bot (bỏ lệnh tay): LB_Auto(MagicNumberCuaBot);  Chỉ 1 mã: LB_Auto(-1, "XAUUSD").
//
// CÁCH GẮN THỦ CÔNG (nếu EA đã tự tính tổng kết ngày, ví dụ chỗ gửi "TỔNG KẾT NGÀY" lên Telegram):
//   LB_SendDaily(ngayTongKet, profit, swap, phi, tongLots, AccountInfoDouble(ACCOUNT_BALANCE), soLenh, ddMaxPct);
//     - ngayTongKet: datetime bất kỳ trong NGÀY ĐƯỢC TỔNG KẾT (giờ sàn), không phải giờ gửi.
//     - phi: phí + commission, SỐ ÂM nếu bị trừ. soLenh, ddMaxPct: không có thì truyền -1.
//     - Hàm tự đọc nạp / rút / bonus / credit trong ngày (mã deal là khóa, gửi lại không trùng)
//       và tự lùi số dư về CUỐI NGÀY tổng kết.
//   LB_SendStatus(ddPctHienTai);   // trong OnTimer 2–5 phút/lần; không có DD thì truyền -1
//   Gửi lại cùng một ngày: máy chủ ghi đè, không cộng trùng. Dùng cả LB_Auto và gửi thủ công cũng không sao.
//
// KỸ THUẬT ĐIỀN KHI GẮN EA LÊN TỪNG TÀI KHOẢN:
//   - InpLB_Key: MÃ KHÓA EA RIÊNG của tài khoản (web Lion Bot → Quản trị → Tài khoản & mã EA → Chép).
//     Mỗi tài khoản một mã. Để trống = không gửi gì (EA vẫn chạy bình thường).
//   - MT5: Tools > Options > Expert Advisors > tích "Allow WebRequest for listed URL" và thêm:
//         https://sypkzdcazdzekmgmgfhu.supabase.co
//   - Kiểm tra nhanh: chạy script LionBot_TestConnection trên tài khoản đó.
//
// Lưu ý: WebRequest chạy đồng bộ (tối đa ~10 giây/lần, thử lại 3 lần cách 2 giây) nên chỉ gọi trong
// OnTimer, KHÔNG gọi trong OnTick của chiến lược vào lệnh nhanh. Không dùng được trong indicator.
//+------------------------------------------------------------------+

input string InpLB_Url       = "https://sypkzdcazdzekmgmgfhu.supabase.co"; // Lion Bot: địa chỉ máy chủ (giữ nguyên)
input string InpLB_Key       = "";                                         // Lion Bot: mã khóa EA của tài khoản này
input int    InpLB_StatusMin = 5;                                          // Lion Bot: gửi trạng thái mỗi N phút khi có lệnh mở

// Khóa công khai (anon) của dự án: chỉ gọi được 2 hàm nhận dữ liệu, không đọc được dữ liệu nào.
#define LB_ANON "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5cGt6ZGNhemR6ZWttZ21nZmh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3Nzg1MDIsImV4cCI6MjEwOTM1NDUwMn0.W81InK_7Gpo1U14sl76cVia5DXZx9owTZZskX8GAU3Q"
#define LB_VERSION "1.1.0"

string LB_N(const double v) { return DoubleToString(v, 2); }
string LB_E(string s) { StringReplace(s, "\\", "\\\\"); StringReplace(s, "\"", "\\\""); return s; }
string LB_Trim(string s) { StringTrimLeft(s); StringTrimRight(s); return s; }
datetime LB_Day(const datetime t) { return t - (t % 86400); }
string LB_GV(const string k) { return "LB_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "_" + k; }

string LB_LastReply = "";   // phản hồi gần nhất của máy chủ (để in log / kiểm tra)

bool LB_Post(const string fn, const string pjson)
{
   string url = LB_Trim(InpLB_Url), key = LB_Trim(InpLB_Key);
   if(url == "" || key == "") { LB_LastReply = "chua dien InpLB_Key"; return false; }
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
      LB_LastReply = IntegerToString(code) + " " + StringSubstr(reply, 0, 200);
      if(code == 200 && (StringFind(reply, "\"ok\": true") >= 0 || StringFind(reply, "\"ok\":true") >= 0)) return true;
      if(code == 200) { PrintFormat("LionBot: %s bi tu choi: %s", fn, StringSubstr(reply, 0, 160)); return false; }   // sai mã, sai ngày: thử lại cũng vô ích
      if(code == -1)
      {
         int err = GetLastError();
         LB_LastReply = "WebRequest loi " + IntegerToString(err);
         PrintFormat("LionBot: loi WebRequest %d (4014 = chua cho phep %s trong Tools > Options > Expert Advisors)", err, url);
         if(err == 4014) return false;
      }
      else PrintFormat("LionBot: may chu tra %d, thu lai %d/3", code, attempt);
      Sleep(2000);
   }
   return false;
}

// Danh sách nạp / rút / bonus / credit trong ngày [d0, d1) + tổng biến động số dư SAU ngày (để lùi số dư)
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
   datetime d0 = LB_Day(day), d1 = d0 + 86400;
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

double LB_CurDD()
{
   double b = AccountInfoDouble(ACCOUNT_BALANCE), e = AccountInfoDouble(ACCOUNT_EQUITY);
   if(b <= 0) return -1;
   double dd = (b - e) / b * 100.0;
   return dd > 0 ? dd : 0;
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

// ------------------------------------------------------------ chế độ tự động
// Tổng hợp lệnh trong ngày [d0, d1) từ lịch sử MT5. magic < 0 = mọi lệnh; sym "" = mọi mã.
// allDeals = tổng số deal trong ngày (kể cả nạp / rút) để biết cuối tuần có phát sinh gì không.
void LB_DayStats(const datetime d0, const datetime d1, const long magic, const string sym,
                 double &profit, double &swap, double &fee, double &lots, int &trades, int &allDeals)
{
   profit = 0; swap = 0; fee = 0; lots = 0; trades = 0; allDeals = 0;
   if(!HistorySelect(d0, d1 - 1)) return;
   int n = HistoryDealsTotal();
   for(int i = 0; i < n; i++)
   {
      ulong tk = HistoryDealGetTicket(i);
      if(tk == 0) continue;
      allDeals++;
      long typ = HistoryDealGetInteger(tk, DEAL_TYPE);
      if(typ != DEAL_TYPE_BUY && typ != DEAL_TYPE_SELL) continue;
      if(magic >= 0 && HistoryDealGetInteger(tk, DEAL_MAGIC) != magic) continue;
      if(sym != "" && HistoryDealGetString(tk, DEAL_SYMBOL) != sym) continue;
      profit += HistoryDealGetDouble(tk, DEAL_PROFIT);
      swap   += HistoryDealGetDouble(tk, DEAL_SWAP);
      fee    += HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_FEE);
      long en = HistoryDealGetInteger(tk, DEAL_ENTRY);
      if(en == DEAL_ENTRY_OUT || en == DEAL_ENTRY_OUT_BY || en == DEAL_ENTRY_INOUT)
      {
         lots += HistoryDealGetDouble(tk, DEAL_VOLUME);
         trades++;
      }
   }
}

// Ghi lại DD sâu nhất của từng ngày (lưu trong Global Variables của terminal, tắt MT5 không mất)
void LB_TrackDD()
{
   double dd = LB_CurDD();
   if(dd < 0) return;
   string k = LB_GV("dd" + IntegerToString((long)(LB_Day(TimeCurrent()) / 86400)));
   if(!GlobalVariableCheck(k) || GlobalVariableGet(k) < dd) GlobalVariableSet(k, dd);
}
double LB_DayDD(const datetime d0)
{
   string k = LB_GV("dd" + IntegerToString((long)(LB_Day(d0) / 86400)));
   return GlobalVariableCheck(k) ? GlobalVariableGet(k) : -1;
}

// Gọi trong OnTimer (khuyên timer 60 giây). Trả về true nếu lần gọi này có gửi thành công gì đó.
bool LB_Auto(const long magic = -1, const string sym = "")
{
   static datetime lastStatus = 0, lastTry = 0;
   if(LB_Trim(InpLB_Key) == "") return false;
   datetime now = TimeCurrent();
   if(now <= 0) return false;
   bool sent = false;
   LB_TrackDD();

   // 1) trạng thái
   int every = (PositionsTotal() > 0 ? MathMax(InpLB_StatusMin, 1) : 30) * 60;
   if(now - lastStatus >= every)
   {
      if(LB_SendStatus(LB_CurDD())) { lastStatus = now; sent = true; }
      else lastStatus = now - every + 120;   // lỗi: thử lại sau 2 phút
   }

   // 2) tổng kết các ngày đã qua chưa gửi
   datetime today = LB_Day(now);
   string kLast = LB_GV("last");
   if(!GlobalVariableCheck(kLast)) GlobalVariableSet(kLast, (double)(today - 2 * 86400));   // lần đầu: gửi hôm qua
   datetime last = (datetime)(long)GlobalVariableGet(kLast);
   if(last < today - 86400 && now - lastTry >= 600)
   {
      lastTry = now;
      datetime d = last + 86400;
      if(d < today - 7 * 86400) d = today - 7 * 86400;
      for(; d < today; d += 86400)
      {
         double p, s, f, l; int tr, all;
         LB_DayStats(d, d + 86400, magic, sym, p, s, f, l, tr, all);
         MqlDateTime t; TimeToStruct(d, t);
         if((t.day_of_week == 0 || t.day_of_week == 6) && all == 0) { GlobalVariableSet(kLast, (double)d); continue; }   // cuối tuần không phát sinh
         if(!LB_SendDaily(d, p, s, f, l, AccountInfoDouble(ACCOUNT_BALANCE), tr, LB_DayDD(d))) break;   // lỗi: 10 phút sau thử lại từ ngày này
         GlobalVariableSet(kLast, (double)d);
         sent = true;
      }
   }
   return sent;
}

// Gửi lại một ngày bất kỳ (ví dụ sửa dữ liệu): LB_ResendDay(D'2026.11.03');
bool LB_ResendDay(const datetime day, const long magic = -1, const string sym = "")
{
   double p, s, f, l; int tr, all;
   datetime d0 = LB_Day(day);
   LB_DayStats(d0, d0 + 86400, magic, sym, p, s, f, l, tr, all);
   return LB_SendDaily(d0, p, s, f, l, AccountInfoDouble(ACCOUNT_BALANCE), tr, LB_DayDD(d0));
}
//+------------------------------------------------------------------+
