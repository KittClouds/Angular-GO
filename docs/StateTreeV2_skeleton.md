```mql5
//+------------------------------------------------------------------+
//| StateTreeV2.mq5                                                  |
//+------------------------------------------------------------------+
#property strict
#include <Trade\Trade.mqh>

enum ENUM_ENGINE_STATE { ENGINE_BOOT=0, ENGINE_SYNC_DATA=1, ENGINE_BUILD_STRUCTURE=2, ENGINE_EVALUATE_SIGNALS=3, ENGINE_MANAGE_TRADES=4, ENGINE_WAIT_REFRESH=5, ENGINE_ERROR=6 };
enum ENUM_TRADE_STATE { TRADE_FLAT=0, TRADE_ARMED_LONG=1, TRADE_ARMED_SHORT=2, TRADE_PENDING_LONG=3, TRADE_PENDING_SHORT=4, TRADE_OPEN_LONG=5, TRADE_OPEN_SHORT=6, TRADE_BREAK_EVEN=7, TRADE_PARTIAL_DONE=8, TRADE_TRAILING=9, TRADE_EXIT=10 };
enum ENUM_RISK_BASE { RISK_BASE_EQUITY=1, RISK_BASE_BALANCE=2, RISK_BASE_FREEMARGIN=3 };
enum ENUM_RISK_DEFAULT_SIZE { RISK_DEFAULT_FIXED=1, RISK_DEFAULT_AUTO=2 };
enum ENUM_MODE_SL { SL_FIXED=0, SL_AUTO=1 };
enum ENUM_MODE_TP { TP_FIXED=0, TP_AUTO=1 };

input group "Core"
input int                CycleThrottleMs             = 250;
input int                SignalRefreshPeriod         = 5;
input ENUM_TIMEFRAMES    StructureTimeFrame          = PERIOD_CURRENT;
input ENUM_TIMEFRAMES    SignalTimeFrame             = PERIOD_CURRENT;
input ENUM_TIMEFRAMES    ATRTimeFrame                = PERIOD_CURRENT;

input group "Risk"
input ENUM_RISK_DEFAULT_SIZE RiskDefaultSize         = RISK_DEFAULT_FIXED;
input ENUM_RISK_BASE     RiskBase                    = RISK_BASE_BALANCE;
input double             DefaultLotSize              = 0.01;
input int                MaxRiskPerTrade             = 2;
input double             MinLotSize                  = 0.01;
input double             MaxLotSize                  = 100.0;
input int                MaxPositions                = 8;

input group "Stops"
input int                ATRPeriod                   = 100;
input double             ATRMultiplierSL             = 3.0;
input double             ATRMultiplierTP             = 8.0;
input ENUM_MODE_SL       StopLossMode                = SL_FIXED;
input ENUM_MODE_TP       TakeProfitMode              = TP_FIXED;
input int                DefaultStopLoss             = 0;
input int                DefaultTakeProfit           = 0;
input bool               EnableBreakEven             = false;
input double             BreakEvenDistance           = 100;
input bool               UsePartialClose             = false;
input double             PartialClosePerc            = 50;
input double             ATRMultiplierPC             = 5;

input group "Trailing"
input bool               EnablePSARTrailing          = true;
input double             PSARStep                    = 0.0004;
input double             PSARMaximum                 = 0.2;
input bool               EnableAMATrailing           = false;
input int                AMATrailingPeriod           = 500;
input int                AMATrailingFastEMA          = 7;
input int                AMATrailingSlowEMA          = 40;
input int                AMATrailingSignal           = 2;
input ENUM_APPLIED_PRICE AMATrailingApplyPrice       = PRICE_CLOSE;
input int                AMATrailingShift            = 11;
input int                TrailingStartProfit         = 0;

input group "Trade Surface"
input string             Comment_d                   = "==========";
input int                MagicNumber                 = 0;
input string             OrderNote                   = "";
input int                Slippage                    = 5;
input int                MaxSpread                   = 50;

input group "Schedule"
input bool               UseTradingHours             = false;
input int                TradingHourStart            = 7;
input int                TradingHourEnd              = 19;
input bool               UseCloseByTime              = false;
input int                CloseHour                   = 23;
input int                CloseMinute                 = 55;

input group "Filters"
input bool               EnableTrendFiltering        = true;
input bool               UseWiseNetFilter            = true;
input int                WiseNetPeriod               = 400;
input ENUM_MA_METHOD     WiseNetMethod               = MODE_EMA;
input ENUM_APPLIED_PRICE WiseNetAppliedPrice         = PRICE_CLOSE;
input int                WiseNetShift                = 0;
input bool               UseWiseDayLineFilter        = false;
input int                WiseDayLineBuffer           = 0;
input int                TimeShift                   = 0;
input bool               UseVWAPDailyFilter          = false;
input bool               ReverseVWAPDailyLogic       = false;
input bool               UseVWAPWeeklyFilter         = false;
input bool               ReverseVWAPWeeklyLogic      = false;
input bool               UseLocationFilter           = true;
input bool               UseWiseNetLocationFilter    = true;
input double             MaxBuyWiseNetDistATR        = 1.80;
input double             MaxSellWiseNetDistATR       = 1.80;
input bool               UseVWAPDailyLocationFilter  = true;
input double             MaxBuyVWAPDailyDistATR      = 1.20;
input double             MaxSellVWAPDailyDistATR     = 1.20;
input bool               UseVWAPWeeklyLocationFilter = true;
input double             MaxBuyVWAPWeeklyDistATR     = 2.50;
input double             MaxSellVWAPWeeklyDistATR    = 2.50;
input bool               UseBreakMaturityGate        = true;
input int                MaxBullBreakCount           = 2;
input int                MaxBearBreakCount           = 2;
input bool               UsePullbackGate             = true;
input int                PullbackLookbackBars        = 40;
input double             MinBuyPullbackFraction      = 0.25;
input double             MinSellPullbackFraction     = 0.25;

struct SEngineContext { ENUM_ENGINE_STATE state; datetime last_cycle_time; datetime last_sync_time; bool data_ready; bool structure_ready; bool management_ready; string last_error; };
struct SSignalContext { bool buy_trend_pass; bool buy_location_pass; bool buy_maturity_pass; bool buy_pullback_pass; bool buy_refresh_pass; bool buy_ready; bool sell_trend_pass; bool sell_location_pass; bool sell_maturity_pass; bool sell_pullback_pass; bool sell_refresh_pass; bool sell_ready; };
struct STradeContext { ENUM_TRADE_STATE state; ulong ticket; bool break_even_done; bool partial_done; double psar_stop; double ama_stop; double active_stop; };
struct SOrderPlan { bool is_buy; bool valid; double entry; double sl; double tp; double size; string reason; };

CTrade Trade;
SEngineContext g_engine;
SSignalContext g_signal;
STradeContext g_trade;

int ATRHandle = INVALID_HANDLE, PSARHandle = INVALID_HANDLE, AMAHandle = INVALID_HANDLE, WiseNetHandle = INVALID_HANDLE, WiseDayLineHandle = INVALID_HANDLE, VWAPDailyHandle = INVALID_HANDLE, VWAPWeeklyHandle = INVALID_HANDLE;
double ATR_previous = 0.0, ATR_current = 0.0, netBuffer[2], dayLineBuffer[2], vwapDailyBuffer[2], vwapWeeklyBuffer[2];
datetime lastBuySignalTime = 0, lastSellSignalTime = 0;
int BullBreakCount = 0, BearBreakCount = 0;
uint g_lastCycleMs = 0;

void ResetSignalContext() { ZeroMemory(g_signal); }
void ResetTradeContext() { g_trade.state = TRADE_FLAT; g_trade.ticket = 0; g_trade.break_even_done = false; g_trade.partial_done = false; g_trade.psar_stop = 0.0; g_trade.ama_stop = 0.0; g_trade.active_stop = 0.0; }
void SetEngineState(const ENUM_ENGINE_STATE next_state, const string err = "") { g_engine.state = next_state; g_engine.last_cycle_time = TimeCurrent(); g_engine.last_error = err; }
bool MatchesMagic(const long magic) { return (MagicNumber == 0 || magic == MagicNumber); }
bool CheckSpreadOK() { return (MaxSpread <= 0 || (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) <= MaxSpread); }
bool IsUsableLocationNumber(const double value) { return (MathIsValidNumber(value) && value != EMPTY_VALUE && value != 0.0); }

bool IsCurrentTimeInInterval(const int startHour, const int endHour)
{
   MqlDateTime now; TimeToStruct(TimeCurrent(), now);
   if(startHour == endHour) return true;
   if(startHour < endHour) return (now.hour >= startHour && now.hour < endHour);
   return (now.hour >= startHour || now.hour < endHour);
}

bool CheckTradingHours() { return (!UseTradingHours || IsCurrentTimeInInterval(TradingHourStart, TradingHourEnd)); }

double ResolveRiskBaseAmount()
{
   if(RiskBase == RISK_BASE_EQUITY) return AccountInfoDouble(ACCOUNT_EQUITY);
   if(RiskBase == RISK_BASE_FREEMARGIN) return AccountInfoDouble(ACCOUNT_FREEMARGIN);
   return AccountInfoDouble(ACCOUNT_BALANCE);
}

double ComputeLotSize(const double stopLoss, const double entry)
{
   double size = DefaultLotSize;
   if(RiskDefaultSize == RISK_DEFAULT_AUTO && stopLoss > 0.0)
   {
      double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      double slPoints = MathAbs(entry - stopLoss) / _Point;
      if(slPoints > 0.0 && tickValue > 0.0) size = (ResolveRiskBaseAmount() * MaxRiskPerTrade / 100.0) / (slPoints * tickValue);
   }
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), brokerMin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), brokerMax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   size = MathFloor(size / lotStep) * lotStep;
   if(size > MaxLotSize) size = MaxLotSize;
   if(size > brokerMax) size = brokerMax;
   if(size < MinLotSize || size < brokerMin) size = 0.0;
   return size;
}

double DynamicStopLossPrice(const ENUM_ORDER_TYPE type, const double entry) { if(ATR_previous <= 0.0) return 0.0; return NormalizeDouble((type == ORDER_TYPE_BUY) ? entry - ATR_previous * ATRMultiplierSL : entry + ATR_previous * ATRMultiplierSL, _Digits); }
double DynamicTakeProfitPrice(const ENUM_ORDER_TYPE type, const double entry) { if(ATR_previous <= 0.0) return 0.0; return NormalizeDouble((type == ORDER_TYPE_BUY) ? entry + ATR_previous * ATRMultiplierTP : entry - ATR_previous * ATRMultiplierTP, _Digits); }

SOrderPlan BuildDefaultOrderPlan(const bool isBuy)
{
   SOrderPlan plan; plan.is_buy = isBuy; plan.valid = false; plan.entry = isBuy ? SymbolInfoDouble(_Symbol, SYMBOL_ASK) : SymbolInfoDouble(_Symbol, SYMBOL_BID); plan.reason = "";
   plan.sl = (StopLossMode == SL_AUTO) ? DynamicStopLossPrice(isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, plan.entry) : 0.0;
   plan.tp = (TakeProfitMode == TP_AUTO) ? DynamicTakeProfitPrice(isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, plan.entry) : 0.0;
   if(StopLossMode == SL_FIXED && DefaultStopLoss > 0) plan.sl = isBuy ? plan.entry - DefaultStopLoss * _Point : plan.entry + DefaultStopLoss * _Point;
   if(TakeProfitMode == TP_FIXED && DefaultTakeProfit > 0) plan.tp = isBuy ? plan.entry + DefaultTakeProfit * _Point : plan.entry - DefaultTakeProfit * _Point;
   plan.size = ComputeLotSize(plan.sl, plan.entry);
   return plan;
}

bool CanRefreshSignal(const bool isBuy)
{
   datetime nowBar = iTime(_Symbol, SignalTimeFrame, 0);
   if(isBuy)
   {
      if(lastBuySignalTime == 0 || nowBar - lastBuySignalTime >= SignalRefreshPeriod * PeriodSeconds(SignalTimeFrame)) { lastBuySignalTime = nowBar; return true; }
      return false;
   }
   if(lastSellSignalTime == 0 || nowBar - lastSellSignalTime >= SignalRefreshPeriod * PeriodSeconds(SignalTimeFrame)) { lastSellSignalTime = nowBar; return true; }
   return false;
}

bool InitializeHandles()
{
   ATRHandle = iATR(_Symbol, ATRTimeFrame, ATRPeriod);
   PSARHandle = iSAR(_Symbol, PERIOD_CURRENT, PSARStep, PSARMaximum);
   AMAHandle = iAMA(_Symbol, PERIOD_CURRENT, AMATrailingPeriod, AMATrailingFastEMA, AMATrailingSlowEMA, AMATrailingSignal, AMATrailingApplyPrice);
   if(UseWiseNetFilter || UseWiseNetLocationFilter || EnableTrendFiltering) WiseNetHandle = iMA(_Symbol, PERIOD_CURRENT, WiseNetPeriod, WiseNetShift, WiseNetMethod, WiseNetAppliedPrice);
   if(UseWiseDayLineFilter) WiseDayLineHandle = iCustom(_Symbol, PERIOD_CURRENT, "WiseDayLine.ex5", TimeShift);
   if(UseVWAPDailyFilter || UseVWAPDailyLocationFilter) VWAPDailyHandle = iCustom(_Symbol, PERIOD_CURRENT, "\\Indicators\\vwap1");
   if(UseVWAPWeeklyFilter || UseVWAPWeeklyLocationFilter) VWAPWeeklyHandle = iCustom(_Symbol, PERIOD_CURRENT, "\\Indicators\\vwap1");
   return (ATRHandle != INVALID_HANDLE && PSARHandle != INVALID_HANDLE && AMAHandle != INVALID_HANDLE);
}

void ReleaseHandles()
{
   if(ATRHandle != INVALID_HANDLE) IndicatorRelease(ATRHandle);
   if(PSARHandle != INVALID_HANDLE) IndicatorRelease(PSARHandle);
   if(AMAHandle != INVALID_HANDLE) IndicatorRelease(AMAHandle);
   if(WiseNetHandle != INVALID_HANDLE) IndicatorRelease(WiseNetHandle);
   if(WiseDayLineHandle != INVALID_HANDLE) IndicatorRelease(WiseDayLineHandle);
   if(VWAPDailyHandle != INVALID_HANDLE) IndicatorRelease(VWAPDailyHandle);
   if(VWAPWeeklyHandle != INVALID_HANDLE) IndicatorRelease(VWAPWeeklyHandle);
}

bool SyncDataForest()
{
   double atrBuf[2];
   if(CopyBuffer(ATRHandle, 0, 0, 2, atrBuf) < 2) return false;
   ATR_previous = atrBuf[0]; ATR_current = atrBuf[1];
   if(WiseNetHandle != INVALID_HANDLE && CopyBuffer(WiseNetHandle, 0, 0, 2, netBuffer) < 2) return false;
   if(WiseDayLineHandle != INVALID_HANDLE && CopyBuffer(WiseDayLineHandle, WiseDayLineBuffer, 0, 2, dayLineBuffer) < 2) return false;
   if(VWAPDailyHandle != INVALID_HANDLE && CopyBuffer(VWAPDailyHandle, 0, 0, 2, vwapDailyBuffer) < 2) return false;
   if(VWAPWeeklyHandle != INVALID_HANDLE && CopyBuffer(VWAPWeeklyHandle, 1, 0, 2, vwapWeeklyBuffer) < 2) return false;
   g_engine.data_ready = true; g_engine.last_sync_time = TimeCurrent(); return true;
}

bool BuildStructureForest() { g_engine.structure_ready = true; return true; }
double GetBuyExtensionATR(const double price, const double anchor, const bool reverseLogic = false) { if(ATR_previous <= 0.0) return DBL_MAX; return (reverseLogic ? (anchor - price) : (price - anchor)) / ATR_previous; }
double GetSellExtensionATR(const double price, const double anchor, const bool reverseLogic = false) { if(ATR_previous <= 0.0) return DBL_MAX; return (reverseLogic ? (price - anchor) : (anchor - price)) / ATR_previous; }

bool EvaluateTrendForest(const bool isBuy, const double price)
{
   if(!EnableTrendFiltering) return true;
   if(UseWiseNetFilter && (!IsUsableLocationNumber(netBuffer[0]) || !(isBuy ? price > netBuffer[0] : price < netBuffer[0]))) return false;
   if(UseWiseDayLineFilter && (!IsUsableLocationNumber(dayLineBuffer[0]) || !(isBuy ? price > dayLineBuffer[0] : price < dayLineBuffer[0]))) return false;
   if(UseVWAPDailyFilter && (!IsUsableLocationNumber(vwapDailyBuffer[0]) || !(isBuy ? (ReverseVWAPDailyLogic ? price < vwapDailyBuffer[0] : price > vwapDailyBuffer[0]) : (ReverseVWAPDailyLogic ? price > vwapDailyBuffer[0] : price < vwapDailyBuffer[0])))) return false;
   if(UseVWAPWeeklyFilter && (!IsUsableLocationNumber(vwapWeeklyBuffer[0]) || !(isBuy ? (ReverseVWAPWeeklyLogic ? price < vwapWeeklyBuffer[0] : price > vwapWeeklyBuffer[0]) : (ReverseVWAPWeeklyLogic ? price > vwapWeeklyBuffer[0] : price < vwapWeeklyBuffer[0])))) return false;
   return true;
}

bool EvaluateLocationForest(const bool isBuy, const double price)
{
   if(!UseLocationFilter) return true;
   if(ATR_previous <= 0.0) return false;
   if(UseWiseNetLocationFilter && (!IsUsableLocationNumber(netBuffer[0]) || (isBuy ? GetBuyExtensionATR(price, netBuffer[0], false) > MaxBuyWiseNetDistATR : GetSellExtensionATR(price, netBuffer[0], false) > MaxSellWiseNetDistATR))) return false;
   if(UseVWAPDailyLocationFilter && (!IsUsableLocationNumber(vwapDailyBuffer[0]) || (isBuy ? GetBuyExtensionATR(price, vwapDailyBuffer[0], ReverseVWAPDailyLogic) > MaxBuyVWAPDailyDistATR : GetSellExtensionATR(price, vwapDailyBuffer[0], ReverseVWAPDailyLogic) > MaxSellVWAPDailyDistATR))) return false;
   if(UseVWAPWeeklyLocationFilter && (!IsUsableLocationNumber(vwapWeeklyBuffer[0]) || (isBuy ? GetBuyExtensionATR(price, vwapWeeklyBuffer[0], ReverseVWAPWeeklyLogic) > MaxBuyVWAPWeeklyDistATR : GetSellExtensionATR(price, vwapWeeklyBuffer[0], ReverseVWAPWeeklyLogic) > MaxSellVWAPWeeklyDistATR))) return false;
   return true;
}

bool EvaluateMaturityForest(const bool isBuy) { if(!UseBreakMaturityGate) return true; return isBuy ? (BullBreakCount <= MaxBullBreakCount) : (BearBreakCount <= MaxBearBreakCount); }

bool EvaluatePullbackForest(const bool isBuy, const double price)
{
   if(!UsePullbackGate) return true;
   int hiShift = iHighest(_Symbol, SignalTimeFrame, MODE_HIGH, PullbackLookbackBars, 1), loShift = iLowest(_Symbol, SignalTimeFrame, MODE_LOW, PullbackLookbackBars, 1);
   if(hiShift < 0 || loShift < 0) return true;
   double hi = iHigh(_Symbol, SignalTimeFrame, hiShift), lo = iLow(_Symbol, SignalTimeFrame, loShift), width = MathMax(hi - lo, _Point);
   double pullback = isBuy ? ((price - lo) / width) : ((hi - price) / width);
   return isBuy ? (pullback >= MinBuyPullbackFraction) : (pullback >= MinSellPullbackFraction);
}

bool EvaluateEntryModelForest(const bool isBuy, SOrderPlan &plan) { plan = BuildDefaultOrderPlan(isBuy); plan.valid = false; plan.reason = "Entry model intentionally blank"; return false; }

bool EvaluateBuyTree()
{
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   g_signal.buy_trend_pass = EvaluateTrendForest(true, ask);
   g_signal.buy_location_pass = EvaluateLocationForest(true, ask);
   g_signal.buy_maturity_pass = EvaluateMaturityForest(true);
   g_signal.buy_pullback_pass = EvaluatePullbackForest(true, ask);
   g_signal.buy_refresh_pass = CanRefreshSignal(true);
   g_signal.buy_ready = g_signal.buy_trend_pass && g_signal.buy_location_pass && g_signal.buy_maturity_pass && g_signal.buy_pullback_pass && g_signal.buy_refresh_pass;
   return g_signal.buy_ready;
}

bool EvaluateSellTree()
{
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   g_signal.sell_trend_pass = EvaluateTrendForest(false, bid);
   g_signal.sell_location_pass = EvaluateLocationForest(false, bid);
   g_signal.sell_maturity_pass = EvaluateMaturityForest(false);
   g_signal.sell_pullback_pass = EvaluatePullbackForest(false, bid);
   g_signal.sell_refresh_pass = CanRefreshSignal(false);
   g_signal.sell_ready = g_signal.sell_trend_pass && g_signal.sell_location_pass && g_signal.sell_maturity_pass && g_signal.sell_pullback_pass && g_signal.sell_refresh_pass;
   return g_signal.sell_ready;
}

int CountManagedPositions()
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(PositionGetSymbol(i) != "" && PositionGetString(POSITION_SYMBOL) == _Symbol && MatchesMagic(PositionGetInteger(POSITION_MAGIC))) count++;
   return count;
}

void UpdateTradeStateFromTerminal()
{
   ResetTradeContext();
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(PositionGetSymbol(i) != "" && PositionGetString(POSITION_SYMBOL) == _Symbol && MatchesMagic(PositionGetInteger(POSITION_MAGIC))) { g_trade.ticket = PositionGetInteger(POSITION_TICKET); g_trade.state = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? TRADE_OPEN_LONG : TRADE_OPEN_SHORT; return; }
}

bool ApplyTrailingStop(const ulong ticket, const double newSL)
{
   if(!PositionSelectByTicket(ticket)) return false;
   double currentSL = PositionGetDouble(POSITION_SL), tp = PositionGetDouble(POSITION_TP);
   int type = (int)PositionGetInteger(POSITION_TYPE);
   if(type == POSITION_TYPE_BUY && (newSL <= currentSL && currentSL != 0.0)) return false;
   if(type == POSITION_TYPE_SELL && (newSL >= currentSL && currentSL != 0.0)) return false;
   return Trade.PositionModify(ticket, NormalizeDouble(newSL, _Digits), tp);
}

void BreakEvenLogic()
{
   if(!EnableBreakEven || g_trade.ticket == 0 || !PositionSelectByTicket(g_trade.ticket)) return;
   double openPrice = PositionGetDouble(POSITION_PRICE_OPEN), tp = PositionGetDouble(POSITION_TP), sl = PositionGetDouble(POSITION_SL);
   if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
   {
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      if(bid - openPrice >= BreakEvenDistance * _Point && sl < openPrice) { Trade.PositionModify(g_trade.ticket, openPrice + 5 * _Point, tp); g_trade.break_even_done = true; g_trade.state = TRADE_BREAK_EVEN; }
   }
   else
   {
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      if(openPrice - ask >= BreakEvenDistance * _Point && (sl > openPrice || sl == 0.0)) { Trade.PositionModify(g_trade.ticket, openPrice - 5 * _Point, tp); g_trade.break_even_done = true; g_trade.state = TRADE_BREAK_EVEN; }
   }
}

void PartialCloseAll()
{
   if(!UsePartialClose || g_trade.ticket == 0 || g_trade.partial_done || !PositionSelectByTicket(g_trade.ticket)) return;
   double openPrice = PositionGetDouble(POSITION_PRICE_OPEN), current = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(MathAbs(current - openPrice) <= ATR_previous * ATRMultiplierPC) return;
   double size = PositionGetDouble(POSITION_VOLUME) * PartialClosePerc / 100.0, lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   size = MathFloor(size / lotStep) * lotStep;
   if(size >= SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN) && Trade.PositionClosePartial(g_trade.ticket, size)) { g_trade.partial_done = true; g_trade.state = TRADE_PARTIAL_DONE; }
}

bool ReadPSARStop(double &stop) { double buf[1]; if(PSARHandle == INVALID_HANDLE || CopyBuffer(PSARHandle, 0, 0, 1, buf) < 1) return false; stop = buf[0]; return (stop != 0.0 && stop != EMPTY_VALUE); }
bool ReadAMAStop(double &stop) { double buf[1]; if(AMAHandle == INVALID_HANDLE || CopyBuffer(AMAHandle, 0, AMATrailingShift, 1, buf) < 1) return false; stop = buf[0]; return (stop != 0.0 && stop != EMPTY_VALUE); }

void TrailingArbiter()
{
   if(g_trade.ticket == 0 || !PositionSelectByTicket(g_trade.ticket)) return;
   bool isBuy = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
   double openPrice = PositionGetDouble(POSITION_PRICE_OPEN), current = isBuy ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(TrailingStartProfit > 0 && MathAbs(current - openPrice) / _Point < TrailingStartProfit) return;
   double psarStop = 0.0, amaStop = 0.0, candidate = 0.0;
   bool psarReady = EnablePSARTrailing && ReadPSARStop(psarStop), amaReady = EnableAMATrailing && ReadAMAStop(amaStop);
   if(!psarReady && !amaReady) return;
   if(psarReady && amaReady) candidate = isBuy ? MathMax(psarStop, amaStop) : MathMin(psarStop, amaStop); else candidate = psarReady ? psarStop : amaStop;
   if(ApplyTrailingStop(g_trade.ticket, candidate)) { g_trade.psar_stop = psarStop; g_trade.ama_stop = amaStop; g_trade.active_stop = candidate; g_trade.state = TRADE_TRAILING; }
}

void CloseByTime()
{
   if(!UseCloseByTime) return;
   MqlDateTime now; TimeToStruct(TimeCurrent(), now);
   if(now.hour == CloseHour && now.min == CloseMinute)
      for(int i = PositionsTotal() - 1; i >= 0; i--)
         if(PositionGetSymbol(i) != "" && PositionGetString(POSITION_SYMBOL) == _Symbol && MatchesMagic(PositionGetInteger(POSITION_MAGIC))) Trade.PositionClose(PositionGetInteger(POSITION_TICKET));
}

void EvaluateExecutionForest()
{
   if(!CheckTradingHours() || !CheckSpreadOK() || CountManagedPositions() >= MaxPositions) return;
   SOrderPlan plan;
   if(EvaluateBuyTree()) { g_trade.state = TRADE_ARMED_LONG; if(EvaluateEntryModelForest(true, plan)) { g_trade.state = TRADE_PENDING_LONG; Trade.Buy(plan.size, _Symbol, plan.entry, plan.sl, plan.tp, OrderNote); } }
   if(EvaluateSellTree()) { g_trade.state = TRADE_ARMED_SHORT; if(EvaluateEntryModelForest(false, plan)) { g_trade.state = TRADE_PENDING_SHORT; Trade.Sell(plan.size, _Symbol, plan.entry, plan.sl, plan.tp, OrderNote); } }
}

void ManageTrades() { CloseByTime(); BreakEvenLogic(); PartialCloseAll(); TrailingArbiter(); g_engine.management_ready = true; }

void RunStateTreeCycle()
{
   uint nowMs = GetTickCount();
   if(nowMs - g_lastCycleMs < (uint)MathMax(CycleThrottleMs, 1)) return;
   g_lastCycleMs = nowMs;

   ResetSignalContext();
   UpdateTradeStateFromTerminal();

   SetEngineState(ENGINE_SYNC_DATA);
   if(!SyncDataForest()) { g_engine.data_ready = false; SetEngineState(ENGINE_WAIT_REFRESH, "Data not ready"); return; }

   SetEngineState(ENGINE_BUILD_STRUCTURE);
   if(!BuildStructureForest()) { SetEngineState(ENGINE_ERROR, "Structure build failed"); return; }

   SetEngineState(ENGINE_EVALUATE_SIGNALS);
   EvaluateExecutionForest();

   SetEngineState(ENGINE_MANAGE_TRADES);
   ManageTrades();

   SetEngineState(ENGINE_WAIT_REFRESH);
}

int OnInit()
{
   ZeroMemory(g_engine);
   ResetSignalContext();
   ResetTradeContext();
   Trade.SetExpertMagicNumber(MagicNumber);
   Trade.SetDeviationInPoints(Slippage);
   SetEngineState(ENGINE_BOOT);
   if(!InitializeHandles()) { SetEngineState(ENGINE_ERROR, "Handle initialization failed"); return INIT_FAILED; }
   EventSetTimer(1);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); ReleaseHandles(); }
void OnTick() { RunStateTreeCycle(); }
void OnTimer() { RunStateTreeCycle(); }
//+------------------------------------------------------------------+
```
