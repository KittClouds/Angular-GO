
//+------------------------------------------------------------------+
//| StateTreeV1.mq5                                                  |
//+------------------------------------------------------------------+
#property strict
#include <Trade\Trade.mqh>

enum ENUM_VOLUME_TYPE { VOL_TICK = 0, VOL_REAL = 1 };
enum ENUM_DOT_SIZE { DOT_TINY = 1, DOT_SMALL = 2, DOT_NORMAL = 3, DOT_LARGE = 4, DOT_HUGE = 5 };
enum ENUM_LEVEL_STATE { LEVEL_FRESH, LEVEL_TESTED, LEVEL_ACCEPTED, LEVEL_REJECTED, LEVEL_BROKEN, LEVEL_RECLAIMED };
enum ENUM_RANGE_STATE { RANGE_ACTIVE = 0, RANGE_BROKEN = 1 };
enum ENUM_RANGE_RELATION { RANGE_ROOT = 0, RANGE_CHILD = 1, RANGE_SIBLING = 2 };
enum ENUM_RISK_BASE { RISK_BASE_EQUITY = 1, RISK_BASE_BALANCE = 2, RISK_BASE_FREEMARGIN = 3 };
enum ENUM_RISK_DEFAULT_SIZE { RISK_DEFAULT_FIXED = 1, RISK_DEFAULT_AUTO = 2 };
enum ENUM_MODE_SL { SL_FIXED = 0, SL_AUTO = 1 };
enum ENUM_MODE_TP { TP_FIXED = 0, TP_AUTO = 1 };

input group "Clustering Settings"
input int                InpLookback     = 200;
input int                InpClusters     = 5;
input int                InpIterations   = 50;

input group "Velocity & Tracking Settings"
input int                InpVelocityBars = 5;
input int                InpRowsPerVP    = 20;
input int                InpVPWidth      = 40;
input int                InpVPOffset     = 10;
input bool               InpShowDots     = true;
input ENUM_DOT_SIZE      InpDotSize      = DOT_SMALL;
input ENUM_VOLUME_TYPE   InpVolumeType   = VOL_TICK;
input uint               InpRefreshRate  = 250;

input group "MTF Settings"
input ENUM_TIMEFRAMES    InpCalcTF       = PERIOD_CURRENT;
input bool               InpRequireHTF   = true;
input ENUM_TIMEFRAMES    InpRangeTF      = PERIOD_M3;
input ENUM_TIMEFRAMES    ATRTimeFrame    = PERIOD_CURRENT;

input group "Cluster Colors"
input color InpColor1  = clrTeal;
input color InpColor2  = clrDodgerBlue;
input color InpColor3  = clrYellow;
input color InpColor4  = clrRed;
input color InpColor5  = clrDarkOrchid;
input color InpColor6  = C'0,188,212';
input color InpColor7  = C'255,235,59';
input color InpColor8  = C'233,30,99';
input color InpColor9  = C'121,85,72';
input color InpColor10 = C'96,125,139';

input group "Extreme Zone Projection"
input bool              InpEnableExtremeZones = true;
input color             InpLowerExtremeColor  = clrDarkOrchid;
input color             InpUpperExtremeColor  = clrTeal;
input double            InpExtremeStepFactor  = 1.0;

input group "Range Detection Core"
input int               rangeBars                 = 10;
input double            maxRangePips              = 50.0;
input double            breakoutBufferPips        = 0.0;
input int               breakoutCandles           = 0;

input group "Range Detection Relationships"
input double            relationTolerancePips     = 0.2;
input double            sameOverlapMin            = 0.80;
input double            sameMidpointMaxWidthFrac  = 0.25;
input double            childMaxWidthParentFrac   = 0.85;
input double            siblingOverlapMin         = 0.35;
input double            siblingMidpointMinFrac    = 0.20;
input double            siblingMidpointMaxFrac    = 1.25;

input group "Range Detection Visuals"
input color             activeRootColor           = clrBlue;
input color             activeChildColor          = clrDodgerBlue;
input color             activeSiblingColor        = clrDeepSkyBlue;
input color             brokenRangeColor          = clrSlateBlue;
input bool              fillRectangle             = true;
input ENUM_LINE_STYLE   rectangleStyle            = STYLE_SOLID;
input int               rectangleWidth            = 1;
input bool              drawMidpoint              = true;
input color             midpointColor             = clrYellow;
input ENUM_LINE_STYLE   midpointStyle             = STYLE_SOLID;
input int               midpointWidth             = 1;
input bool              hideObjects               = false;

input group "Signal Surface"
input string            Comment_0                 = "==========";
input int               SignalRefreshPeriod       = 5;
input bool              UseTradingHours           = false;
input int               TradingHourStart          = 7;
input int               TradingHourEnd            = 19;
input bool              UseCloseByTime            = false;
input int               CloseHour                 = 23;
input int               CloseMinute               = 55;

input group "Risk Management"
input string            Comment_a                 = "==========";
input ENUM_RISK_DEFAULT_SIZE RiskDefaultSize      = RISK_DEFAULT_FIXED;
input double            DefaultLotSize            = 0.01;
input ENUM_RISK_BASE    RiskBase                  = RISK_BASE_BALANCE;
input int               MaxRiskPerTrade           = 2;
input double            MinLotSize                = 0.01;
input double            MaxLotSize                = 100.0;
input int               MaxPositions              = 8;
input bool              EnableBreakEven           = false;
input double            BreakEvenDistance         = 100;

input group "Stop Loss & Take Profit"
input string            Comment_b                 = "==========";
input int               ATRPeriod                 = 100;
input double            ATRMultiplierSL           = 3.0;
input double            ATRMultiplierTP           = 8.0;
input ENUM_MODE_SL      StopLossMode              = SL_FIXED;
input int               DefaultStopLoss           = 0;
input int               MinStopLoss               = 0;
input int               MaxStopLoss               = 5000;
input ENUM_MODE_TP      TakeProfitMode            = TP_FIXED;
input int               DefaultTakeProfit         = 0;
input int               MinTakeProfit             = 0;
input int               MaxTakeProfit             = 5000;

input group "Partial Close"
input string            Comment_c                 = "==========";
input bool              UsePartialClose           = false;
input double            PartialClosePerc          = 50;
input double            ATRMultiplierPC           = 5;

input group "Additional Settings"
input string            Comment_d                 = "==========";
input int               MagicNumber               = 0;
input string            OrderNote                 = "";
input int               Slippage                  = 5;
input int               MaxSpread                 = 50;

input group "Trend Filters"
input bool              UseWiseNetFilter          = true;
input bool              EnableTrendFiltering      = true;
input int               WiseNetPeriod             = 400;
input ENUM_MA_METHOD    WiseNetMethod             = MODE_EMA;
input ENUM_APPLIED_PRICE WiseNetAppliedPrice      = PRICE_CLOSE;
input int               WiseNetShift              = 0;
input bool              UseWiseDayLineFilter      = false;
input int               WiseDayLineBuffer         = 0;
input int               TimeShift                 = 0;

input group "VWAP Filters"
input string            CommentVWAP               = "=== VWAP Filter Settings ===";
input bool              UseVWAPDailyFilter        = false;
input bool              ReverseVWAPDailyLogic     = false;
input bool              UseVWAPWeeklyFilter       = false;
input bool              ReverseVWAPWeeklyLogic    = false;

input group "Location Filter"
input string            Comment_loc               = "==========";
input bool              UseLocationFilter         = true;
input bool              DebugLocationFilter       = false;
input bool              UseWiseNetLocationFilter  = true;
input double            MaxBuyWiseNetDistATR      = 1.80;
input double            MaxSellWiseNetDistATR     = 1.80;
input bool              UseVWAPDailyLocationFilter= true;
input double            MaxBuyVWAPDailyDistATR    = 1.20;
input double            MaxSellVWAPDailyDistATR   = 1.20;
input bool              UseVWAPWeeklyLocationFilter= true;
input double            MaxBuyVWAPWeeklyDistATR   = 2.50;
input double            MaxSellVWAPWeeklyDistATR  = 2.50;

input group "Maturity & Pullback Filters"
input string            Comment_mat               = "==========";
input bool              UseBreakMaturityGate      = true;
input int               MaxBullBreakCount         = 2;
input int               MaxBearBreakCount         = 2;
input string            Comment_pb                = "==========";
input bool              UsePullbackGate           = true;
input int               PullbackLookbackBars      = 40;
input double            MinBuyPullbackFraction    = 0.25;
input double            MinSellPullbackFraction   = 0.25;

input group "Trailing Stops"
input bool              EnablePSARTrailing        = true;
input double            PSARStep                  = 0.0004;
input double            PSARMaximum               = 0.2;
input bool              EnableAMATrailing         = false;
input int               AMATrailingPeriod         = 500;
input int               AMATrailingFastEMA        = 7;
input int               AMATrailingSlowEMA        = 40;
input int               AMATrailingSignal         = 2;
input ENUM_APPLIED_PRICE AMATrailingApplyPrice    = PRICE_CLOSE;
input int               AMATrailingShift          = 11;
input int               TrailingStartProfit       = 0;

const string PREFIX_BASE = "StateTree_";
#define MAX_CLUSTERS 10

struct POC_State {
   double           price;
   datetime         birth_time;
   int              age_bars;
   int              touch_count;
   int              rejection_count;
   double           max_break_dist;
   int              reclaim_success;
   int              bars_accepted;
   ENUM_LEVEL_STATE status;
   datetime         last_time_updated;
   bool             touched_this_bar;
   int              broken_side;
   double           snap_centroid;
   double           snap_mass;
   double           snap_range;
   datetime         snap_time;
   string           regime_dir;
   string           regime_auc;
   string           regime_vol;
   bool             synthetic;
   bool             activated;
   int              source_slot;
};

struct SRange {
   int                 id;
   int                 parent_id;
   ENUM_RANGE_STATE    state;
   ENUM_RANGE_RELATION relation;
   datetime            t_start;
   datetime            t_end;
   datetime            born_bar_time;
   datetime            last_seen_bar_time;
   double              high;
   double              low;
   int                 consec_above;
   int                 consec_below;
};

struct SCandidate {
   datetime t_start;
   datetime t_end;
   datetime born_bar_time;
   double   high;
   double   low;
};

CTrade Trade;
color PALETTE[MAX_CLUSTERS];
POC_State LevelStates[MAX_CLUSTERS];
SRange g_ranges[];

double mem_centroids[];
double g_lastClusterPoc[MAX_CLUSTERS];

string g_prefix = "";
string g_range_prefix = "";
ENUM_TIMEFRAMES g_calc_tf = PERIOD_CURRENT;
int g_chart_period_sec = 0;
int g_calc_period_sec = 0;
int prev_dots = 0, prev_boxes = 0, prev_lines = 0, prev_txt_poc = 0, prev_txt_tot = 0, prev_txt_vel = 0;
int g_nextRangeId = 1;
datetime g_lastRangeTfBarTime = 0;
bool g_range_history_built = false;
int g_activeRangeIdx = -1;
datetime g_lastRangeBreakTime = 0;
const int MAX_RANGE_HISTORY_SCAN = 200;
uint g_lastVisualRefresh = 0;
datetime lastBuySignalTime = 0;
datetime lastSellSignalTime = 0;
int BullBreakCount = 0;
int BearBreakCount = 0;
double LastBullBreakPrice = 0.0;
double LastBearBreakPrice = 0.0;
datetime LastBullBreakTime = 0;
datetime LastBearBreakTime = 0;

int ATRHandle = INVALID_HANDLE;
int PSARHandle = INVALID_HANDLE;
int AMAHandle = INVALID_HANDLE;
int WiseNetFilterHandle = INVALID_HANDLE;
int handleWiseDayLine = INVALID_HANDLE;
int handleVWAPDaily = INVALID_HANDLE;
int handleVWAPWeekly = INVALID_HANDLE;
double ATR_current = 0.0;
double ATR_previous = 0.0;
double netBuffer[2];
double dayLineBuffer[2];
double vwapDailyBuffer[2];
double vwapWeeklyBuffer[2];

int RequestedClusterCount() { return MathMax(1, MathMin(InpClusters, MAX_CLUSTERS)); }
bool CanUseExtremeZones() { return (InpEnableExtremeZones && RequestedClusterCount() <= MAX_CLUSTERS - 2); }

double PipSize() { return (_Digits == 3 || _Digits == 5) ? _Point * 10.0 : _Point; }
double PipsToPrice(const double pips) { return pips * PipSize(); }
double BreakBuffer() { return PipsToPrice(breakoutBufferPips); }
double TolerancePrice() { return PipsToPrice(relationTolerancePips); }
double NormalizePrice(const double price) { return NormalizeDouble(price, _Digits); }
double GetBarVolume(const MqlRates &bar) { return (InpVolumeType == VOL_TICK) ? (double)bar.tick_volume : (double)bar.real_volume; }

string TfLabel(const ENUM_TIMEFRAMES tf) {
   switch(tf) {
      case PERIOD_M1: return "M1";
      case PERIOD_M2: return "M2";
      case PERIOD_M3: return "M3";
      case PERIOD_M4: return "M4";
      case PERIOD_M5: return "M5";
      case PERIOD_M6: return "M6";
      case PERIOD_M10: return "M10";
      case PERIOD_M12: return "M12";
      case PERIOD_M15: return "M15";
      case PERIOD_M20: return "M20";
      case PERIOD_M30: return "M30";
      case PERIOD_H1: return "H1";
      case PERIOD_H2: return "H2";
      case PERIOD_H3: return "H3";
      case PERIOD_H4: return "H4";
      case PERIOD_H6: return "H6";
      case PERIOD_H8: return "H8";
      case PERIOD_H12: return "H12";
      case PERIOD_D1: return "D1";
      case PERIOD_W1: return "W1";
      case PERIOD_MN1: return "MN1";
      case PERIOD_CURRENT: return "CURRENT";
   }
   return IntegerToString((int)tf);
}

ENUM_TIMEFRAMES ResolveCalcTF() {
   if(InpCalcTF == PERIOD_CURRENT)
      return (ENUM_TIMEFRAMES)_Period;
   return InpCalcTF;
}

void PushPOCBuffers(double &clusterPoc[]) {
   for(int i = 0; i < MAX_CLUSTERS; i++)
      g_lastClusterPoc[i] = clusterPoc[i];
}

void DeleteAllObjects() {
   for(int i = ObjectsTotal(0, 0, -1) - 1; i >= 0; i--) {
      string name = ObjectName(0, i, 0, -1);
      if(StringFind(name, g_prefix) == 0)
         ObjectDelete(0, name);
   }
   prev_dots = 0;
   prev_boxes = 0;
   prev_lines = 0;
   prev_txt_poc = 0;
   prev_txt_tot = 0;
   prev_txt_vel = 0;
   ArrayResize(mem_centroids, 0);
}

void DeleteRangeObjects() {
   for(int i = ObjectsTotal(0, 0, -1) - 1; i >= 0; --i) {
      string name = ObjectName(0, i, 0, -1);
      if(StringFind(name, g_range_prefix) == 0)
         ObjectDelete(0, name);
   }
}

void ResetRangeEngine() {
   ArrayResize(g_ranges, 0);
   g_nextRangeId = 1;
   g_lastRangeTfBarTime = 0;
   g_activeRangeIdx = -1;
   g_lastRangeBreakTime = 0;
}

string FormatVolume(double vol) {
   if(vol >= 1000000.0) return DoubleToString(vol / 1000000.0, 3) + "M";
   if(vol >= 1000.0) return DoubleToString(vol / 1000.0, 3) + "K";
   return DoubleToString(vol, 2);
}

color MixColor(color baseColor, double ratio) {
   color bgColor = (color)ChartGetInteger(0, CHART_COLOR_BACKGROUND);
   int r = (int)(baseColor & 0xFF), g = (int)((baseColor >> 8) & 0xFF), b = (int)((baseColor >> 16) & 0xFF);
   int br = (int)(bgColor & 0xFF), bgc = (int)((bgColor >> 8) & 0xFF), bb = (int)((bgColor >> 16) & 0xFF);
   return (color)((((int)(b * (1.0 - ratio) + bb * ratio)) << 16) | (((int)(g * (1.0 - ratio) + bgc * ratio)) << 8) | ((int)(r * (1.0 - ratio) + br * ratio)));
}

color ReadableTextColor(color preferred) {
   color bgColor = (color)ChartGetInteger(0, CHART_COLOR_BACKGROUND);
   int pr = (int)(preferred & 0xFF), pg = (int)((preferred >> 8) & 0xFF), pb = (int)((preferred >> 16) & 0xFF);
   int br = (int)(bgColor & 0xFF), bgc = (int)((bgColor >> 8) & 0xFF), bb = (int)((bgColor >> 16) & 0xFF);
   int delta = MathAbs(pr - br) + MathAbs(pg - bgc) + MathAbs(pb - bb);
   if(delta >= 180)
      return preferred;
   int bg_luma = (br * 30 + bgc * 59 + bb * 11) / 100;
   return (bg_luma < 128) ? clrWhite : clrBlack;
}

void DrawDot(int id, datetime t, double p, color c, int size) {
   string name = g_prefix + "Dot_" + IntegerToString(id);
   if(!ObjectCreate(0, name, OBJ_ARROW, 0, t, p))
      ObjectMove(0, name, 0, t, p);
   else {
      ObjectSetInteger(0, name, OBJPROP_ARROWCODE, 159);
      ObjectSetInteger(0, name, OBJPROP_BACK, true);
      ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
   }
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, size);
}

void DrawBox(int id, datetime t1, double p1, datetime t2, double p2, color bgC, color brdC) {
   string name = g_prefix + "VPBox_" + IntegerToString(id);
   if(!ObjectCreate(0, name, OBJ_RECTANGLE, 0, t1, p1, t2, p2)) {
      ObjectMove(0, name, 0, t1, p1);
      ObjectMove(0, name, 1, t2, p2);
   } else {
      ObjectSetInteger(0, name, OBJPROP_FILL, true);
      ObjectSetInteger(0, name, OBJPROP_BACK, true);
      ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
   }
   ObjectSetInteger(0, name, OBJPROP_COLOR, brdC);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, bgC);
}

void DrawLine(int id, datetime t1, double p, datetime t2, color c, int style, int width) {
   string name = g_prefix + "POCLine_" + IntegerToString(id);
   if(!ObjectCreate(0, name, OBJ_TREND, 0, t1, p, t2, p)) {
      ObjectMove(0, name, 0, t1, p);
      ObjectMove(0, name, 1, t2, p);
   } else {
      ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT, false);
      ObjectSetInteger(0, name, OBJPROP_BACK, true);
      ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
   }
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_STYLE, style);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, width);
}

void DrawText(string prefix, int id, datetime t, double p, string txt, color c, int anchor) {
   string name = g_prefix + prefix + IntegerToString(id);
   if(!ObjectCreate(0, name, OBJ_TEXT, 0, t, p))
      ObjectMove(0, name, 0, t, p);
   else {
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 8);
      ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
   }
   ObjectSetString(0, name, OBJPROP_TEXT, txt);
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_ANCHOR, anchor);
}

void UpdateLevelState(POC_State &st, double poc_price, double cur_mass, double cur_range, double bin_size, const datetime cur_time, const int period_sec, const double o0, const double h0, const double l0, const double c0, const double o1, const double h1, const double l1, const double c1) {
   if(st.price == 0.0 || MathAbs(poc_price - st.price) > (bin_size * 2.5)) {
      st.price = poc_price;
      st.birth_time = cur_time;
      st.age_bars = 0;
      st.touch_count = 0;
      st.rejection_count = 0;
      st.max_break_dist = 0;
      st.reclaim_success = 0;
      st.bars_accepted = 0;
      st.status = LEVEL_FRESH;
      st.last_time_updated = cur_time;
      st.touched_this_bar = false;
      st.broken_side = 0;
      st.snap_time = cur_time;
      st.snap_centroid = poc_price;
      st.snap_mass = cur_mass;
      st.snap_range = cur_range;
      st.regime_dir = "Init";
      st.regime_auc = "Init";
      st.regime_vol = "Init";
      return;
   }

   st.price = poc_price;
   double thresh = MathMax(bin_size * 0.5, SymbolInfoDouble(_Symbol, SYMBOL_POINT) * 5.0);
   int period_sec_safe = MathMax(period_sec, 1);

   if(st.last_time_updated != cur_time && o1 != 0.0) {
      st.age_bars++;
      double dist_close = c1 - st.price;
      double abs_dist = MathAbs(dist_close);

      if(abs_dist <= bin_size * 1.5) {
         st.bars_accepted++;
         if((st.status == LEVEL_TESTED || st.status == LEVEL_FRESH) && st.bars_accepted >= 3)
            st.status = LEVEL_ACCEPTED;
      }

      if(h1 >= st.price && l1 <= st.price) {
         if((o1 < st.price && c1 < st.price && (st.price - c1) > thresh) ||
            (o1 > st.price && c1 > st.price && (c1 - st.price) > thresh)) {
            st.rejection_count++;
            if(st.status != LEVEL_BROKEN)
               st.status = LEVEL_REJECTED;
         }
      }

      if(st.broken_side == 0) {
         if(c1 > st.price + thresh && o1 < st.price) {
            st.broken_side = 1;
            st.status = LEVEL_BROKEN;
         } else if(c1 < st.price - thresh && o1 > st.price) {
            st.broken_side = -1;
            st.status = LEVEL_BROKEN;
         }
      } else {
         if(abs_dist > st.max_break_dist)
            st.max_break_dist = abs_dist;
         if((st.broken_side == 1 && c1 < st.price) || (st.broken_side == -1 && c1 > st.price)) {
            st.reclaim_success++;
            st.broken_side = 0;
            st.status = LEVEL_RECLAIMED;
         }
      }

      st.touched_this_bar = false;
      st.last_time_updated = cur_time;
   }

   if(!st.touched_this_bar && h0 >= st.price && l0 <= st.price) {
      st.touch_count++;
      st.touched_this_bar = true;
      if(st.status == LEVEL_FRESH)
         st.status = LEVEL_TESTED;
   }

   if(cur_time - st.snap_time >= (InpVelocityBars * period_sec_safe)) {
      if(st.snap_mass > 0.0) {
         double c_delta = poc_price - st.snap_centroid;
         double m_delta = cur_mass - st.snap_mass;
         double r_delta = cur_range - st.snap_range;
         double micro_thresh = bin_size * 0.15;
         st.regime_dir = (c_delta > micro_thresh) ? "Rise" : (c_delta < -micro_thresh) ? "Fall" : "Stat";
         st.regime_auc = (r_delta > micro_thresh) ? "Expand" : (r_delta < -micro_thresh) ? "Compress" : "Stat";
         st.regime_vol = (m_delta > 0.0) ? "Supply" : "Hollow";
      }
      st.snap_centroid = poc_price;
      st.snap_mass = cur_mass;
      st.snap_range = cur_range;
      st.snap_time = cur_time;
   }
}

string GetStateString(POC_State &st) {
   string stat = "FRESH";
   if(st.status == LEVEL_TESTED) stat = "TESTED";
   else if(st.status == LEVEL_ACCEPTED) stat = "ACCPTD";
   else if(st.status == LEVEL_REJECTED) stat = "REJCTD";
   else if(st.status == LEVEL_BROKEN) stat = "BROKEN";
   else if(st.status == LEVEL_RECLAIMED) stat = "RCLAIM";
   return StringFormat("[%s] Age:%d | Tch:%d | Acc:%d", stat, st.age_bars, st.touch_count, st.bars_accepted);
}

void ResolveStateVisuals(const ENUM_LEVEL_STATE status, const color clusterColor, color &line_color, color &text_color, color &poc_fill_color, color &poc_border_color, int &line_style, int &line_width) {
   line_color = clusterColor;
   text_color = ReadableTextColor(clusterColor);
   poc_fill_color = clusterColor;
   poc_border_color = clusterColor;
   line_style = STYLE_DASH;
   line_width = 2;

   if(status == LEVEL_FRESH) {
      line_style = STYLE_SOLID;
      line_width = 2;
   } else if(status == LEVEL_TESTED) {
      line_style = STYLE_DASH;
      line_width = 2;
      poc_fill_color = MixColor(clusterColor, 0.20);
   } else if(status == LEVEL_ACCEPTED) {
      line_style = STYLE_SOLID;
      line_width = 4;
      poc_fill_color = MixColor(clusterColor, 0.10);
   } else if(status == LEVEL_REJECTED) {
      line_style = STYLE_DASHDOT;
      line_width = 3;
      poc_fill_color = MixColor(clusterColor, 0.25);
   } else if(status == LEVEL_BROKEN) {
      line_style = STYLE_DASHDOTDOT;
      line_width = 4;
      poc_fill_color = MixColor(clusterColor, 0.35);
      poc_border_color = text_color;
   } else if(status == LEVEL_RECLAIMED) {
      line_style = STYLE_DASHDOTDOT;
      line_width = 3;
      poc_fill_color = MixColor(clusterColor, 0.18);
   }
}

double ExtremeStepDistance(const double edgePoc, const double neighborPoc, const double fallbackStep) {
   double step = MathAbs(edgePoc - neighborPoc) * InpExtremeStepFactor;
   if(step < _Point)
      step = fallbackStep;
   return MathMax(step, _Point * 10.0);
}

void RenderPOCZoneVisual(int &cur_boxes, int &cur_lines, int &cur_txt_poc, int &cur_txt_tot, int &cur_txt_vel, const datetime calcStartTime, const datetime vpStartTime, const datetime endXTime, const double zoneBottom, const double zoneTop, const double pocY, const double pocVol, const double totalVol, const color baseColor, const string zoneTag, POC_State &st) {
   int line_style = STYLE_DASH;
   int line_width = 2;
   color state_color = baseColor;
   color text_color = ReadableTextColor(baseColor);
   color poc_fill_color = baseColor;
   color poc_border_color = baseColor;
   ResolveStateVisuals(st.status, baseColor, state_color, text_color, poc_fill_color, poc_border_color, line_style, line_width);
   DrawBox(cur_boxes++, vpStartTime, zoneTop, endXTime, zoneBottom, poc_fill_color, poc_border_color);
   DrawLine(cur_lines++, calcStartTime, pocY, vpStartTime, state_color, line_style, line_width);
   DrawText("POCTxt_", cur_txt_poc++, calcStartTime, pocY, FormatVolume(pocVol), text_color, ANCHOR_RIGHT_LOWER);
   string tfTag = "[" + TfLabel(g_calc_tf) + "]";
   string stat_text = tfTag + " " + zoneTag + " Vol: " + FormatVolume(totalVol) + " " + GetStateString(st);
   string vel_text = StringFormat("%s %s Velocity: [%s | %s | %s]", tfTag, zoneTag, st.regime_dir, st.regime_auc, st.regime_vol);
   DrawText("TotTxt_", cur_txt_tot++, endXTime, pocY, stat_text, text_color, ANCHOR_LEFT_LOWER);
   DrawText("VelTxt_", cur_txt_vel++, endXTime, pocY, vel_text, text_color, ANCHOR_LEFT_UPPER);
}

void MaybeRenderExtremeZone(const bool isUpper, const int slot, const int edgeIdx, const int neighborIdx, const datetime calcStartTime, const datetime vpStartTime, const datetime curTime, const double o0, const double h0, const double l0, const double c0, const double o1, const double h1, const double l1, const double c1, double &zonePoc[], double &zoneRange[], double &zoneMass[], double &zoneBinSize[], double &zonePocVol[], datetime &zoneEndTime[], bool &zoneValid[], double &clusterPoc[], int &cur_boxes, int &cur_lines, int &cur_txt_poc, int &cur_txt_tot, int &cur_txt_vel) {
   if(edgeIdx < 0 || !zoneValid[edgeIdx])
      return;

   LevelStates[slot].synthetic = true;
   LevelStates[slot].source_slot = edgeIdx;
   if(LevelStates[edgeIdx].status == LEVEL_BROKEN)
      LevelStates[slot].activated = true;
   if(!LevelStates[slot].activated)
      return;

   double fallbackStep = MathMax(zoneRange[edgeIdx] * 0.5, zoneBinSize[edgeIdx] * 2.0);
   double neighborPoc = (neighborIdx >= 0 && zoneValid[neighborIdx]) ? zonePoc[neighborIdx] : (isUpper ? zonePoc[edgeIdx] - fallbackStep : zonePoc[edgeIdx] + fallbackStep);
   double step = ExtremeStepDistance(zonePoc[edgeIdx], neighborPoc, fallbackStep);
   double extremePoc = isUpper ? (zonePoc[edgeIdx] + step) : (zonePoc[edgeIdx] - step);
   double extremeBin = MathMax(zoneBinSize[edgeIdx], _Point);
   double zoneBottom = extremePoc - extremeBin * 0.5;
   double zoneTop = extremePoc + extremeBin * 0.5;
   color extremeColor = isUpper ? InpUpperExtremeColor : InpLowerExtremeColor;
   string zoneTag = isUpper ? "[+EXT]" : "[-EXT]";

   UpdateLevelState(LevelStates[slot], extremePoc, zoneMass[edgeIdx], zoneRange[edgeIdx], extremeBin, curTime, g_calc_period_sec, o0, h0, l0, c0, o1, h1, l1, c1);

   clusterPoc[slot] = extremePoc;
   zoneValid[slot] = true;
   zonePoc[slot] = extremePoc;
   zoneRange[slot] = zoneRange[edgeIdx];
   zoneMass[slot] = zoneMass[edgeIdx];
   zoneBinSize[slot] = extremeBin;
   zonePocVol[slot] = zonePocVol[edgeIdx];
   zoneEndTime[slot] = zoneEndTime[edgeIdx];

   RenderPOCZoneVisual(cur_boxes, cur_lines, cur_txt_poc, cur_txt_tot, cur_txt_vel, calcStartTime, vpStartTime, zoneEndTime[slot], zoneBottom, zoneTop, extremePoc, zonePocVol[slot], zoneMass[slot], extremeColor, zoneTag, LevelStates[slot]);
}

double RangeWidthFromBounds(const double high, const double low) { return MathMax(high - low, _Point); }
double RangeWidth(const SRange &r) { return RangeWidthFromBounds(r.high, r.low); }
double CandidateWidth(const SCandidate &c) { return RangeWidthFromBounds(c.high, c.low); }
double MidFromBounds(const double high, const double low) { return NormalizePrice((high + low) * 0.5); }
bool RangeEnoughBars() { return (iBars(_Symbol, InpRangeTF) >= rangeBars + 2); }

double OverlapSize(const double h1, const double l1, const double h2, const double l2) {
   double top = MathMin(h1, h2);
   double bot = MathMax(l1, l2);
   return MathMax(0.0, top - bot);
}

double OverlapRatioToSmaller(const double h1, const double l1, const double h2, const double l2) {
   double sm = MathMin(RangeWidthFromBounds(h1, l1), RangeWidthFromBounds(h2, l2));
   if(sm <= 0.0) return 0.0;
   return OverlapSize(h1, l1, h2, l2) / sm;
}

double WidthSimilarity(const double w1, const double w2) {
   double lg = MathMax(w1, w2);
   if(lg <= 0.0) return 0.0;
   return MathMin(w1, w2) / lg;
}

bool IsContained(const double innerHigh, const double innerLow, const double outerHigh, const double outerLow, const double tol) {
   return (innerHigh <= outerHigh + tol && innerLow >= outerLow - tol);
}

string RectName(const int id) { return g_range_prefix + "RECT_" + IntegerToString(id); }
string MidName(const int id) { return g_range_prefix + "MID_" + IntegerToString(id); }

color RangeColor(const SRange &r) {
   if(r.state == RANGE_BROKEN) return brokenRangeColor;
   switch(r.relation) {
      case RANGE_CHILD: return activeChildColor;
      case RANGE_SIBLING: return activeSiblingColor;
      default: return activeRootColor;
   }
}

void ApplyCommonStyle(const string name) {
   ObjectSetInteger(0, name, OBJPROP_BACK, true);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTED, false);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN, hideObjects);
}

void DrawRangeRectangle(const string name, const datetime t1, const double high, const datetime t2, const double low, const color clr) {
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_RECTANGLE, 0, t1, high, t2, low);
   ObjectMove(0, name, 0, t1, high);
   ObjectMove(0, name, 1, t2, low);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_STYLE, rectangleStyle);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, rectangleWidth);
   ObjectSetInteger(0, name, OBJPROP_FILL, fillRectangle);
   ApplyCommonStyle(name);
}

void DrawRangeMidpointLine(const string name, const datetime t1, const datetime t2, const double mid) {
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_TREND, 0, t1, mid, t2, mid);
   ObjectMove(0, name, 0, t1, mid);
   ObjectMove(0, name, 1, t2, mid);
   ObjectSetInteger(0, name, OBJPROP_COLOR, midpointColor);
   ObjectSetInteger(0, name, OBJPROP_STYLE, midpointStyle);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, midpointWidth);
   ObjectSetInteger(0, name, OBJPROP_RAY_LEFT, false);
   ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT, false);
   ApplyCommonStyle(name);
}

void RenderRangeRecord(const SRange &r) {
   string rect = RectName(r.id);
   string mid = MidName(r.id);
   DrawRangeRectangle(rect, r.t_start, r.high, r.t_end, r.low, RangeColor(r));
   if(drawMidpoint)
      DrawRangeMidpointLine(mid, r.t_start, r.t_end, MidFromBounds(r.high, r.low));
   else if(ObjectFind(0, mid) >= 0)
      ObjectDelete(0, mid);
}

void RenderAllRangeRecords() {
   for(int i = 0; i < ArraySize(g_ranges); ++i)
      RenderRangeRecord(g_ranges[i]);
}

bool CandidateSameAsRange(const SCandidate &c, const SRange &r) {
   double wc = CandidateWidth(c), wr = RangeWidth(r);
   double overlap = OverlapRatioToSmaller(c.high, c.low, r.high, r.low);
   double midDist = MathAbs(MidFromBounds(c.high, c.low) - MidFromBounds(r.high, r.low));
   double widthSim = WidthSimilarity(wc, wr);
   double maxMidDist = MathMax(TolerancePrice(), sameMidpointMaxWidthFrac * MathMax(wc, wr));
   return (overlap >= sameOverlapMin && midDist <= maxMidDist && widthSim >= 0.80);
}

bool CandidateChildOfRange(const SCandidate &c, const SRange &r) {
   double wc = CandidateWidth(c), wr = RangeWidth(r);
   double overlap = OverlapRatioToSmaller(c.high, c.low, r.high, r.low);
   if(!IsContained(c.high, c.low, r.high, r.low, TolerancePrice())) return false;
   if(wc > wr * childMaxWidthParentFrac) return false;
   return (overlap >= 0.95);
}

bool CandidateSiblingOfRange(const SCandidate &c, const SRange &r) {
   double wc = CandidateWidth(c), wr = RangeWidth(r);
   double overlap = OverlapRatioToSmaller(c.high, c.low, r.high, r.low);
   double midDist = MathAbs(MidFromBounds(c.high, c.low) - MidFromBounds(r.high, r.low));
   double maxWidth = MathMax(wc, wr);
   double minMidDist = siblingMidpointMinFrac * maxWidth;
   double maxMidDist = siblingMidpointMaxFrac * maxWidth;
   if(IsContained(c.high, c.low, r.high, r.low, TolerancePrice()) || IsContained(r.high, r.low, c.high, c.low, TolerancePrice()))
      return false;
   return (overlap >= siblingOverlapMin && overlap < sameOverlapMin && midDist >= minMidDist && midDist <= maxMidDist);
}

int FindBestSame(const SCandidate &c) {
   int best = -1;
   double bestScore = -1e100;
   int total = ArraySize(g_ranges);
   int limit = MathMax(0, total - MAX_RANGE_HISTORY_SCAN);
   for(int i = total - 1; i >= limit; --i) {
      if(!CandidateSameAsRange(c, g_ranges[i])) continue;
      double wc = CandidateWidth(c), wr = RangeWidth(g_ranges[i]);
      double overlap = OverlapRatioToSmaller(c.high, c.low, g_ranges[i].high, g_ranges[i].low);
      double midDist = MathAbs(MidFromBounds(c.high, c.low) - MidFromBounds(g_ranges[i].high, g_ranges[i].low));
      double score = overlap * 10.0 + WidthSimilarity(wc, wr) - (midDist / MathMax(wc, wr));
      if(score > bestScore) { bestScore = score; best = i; }
   }
   return best;
}

int FindBestChildParent(const SCandidate &c) {
   int best = -1;
   double narrowestW = DBL_MAX;
   int total = ArraySize(g_ranges);
   int limit = MathMax(0, total - MAX_RANGE_HISTORY_SCAN);
   for(int i = total - 1; i >= limit; --i) {
      if(!CandidateChildOfRange(c, g_ranges[i])) continue;
      double wr = RangeWidth(g_ranges[i]);
      if(wr < narrowestW) { narrowestW = wr; best = i; }
   }
   return best;
}

int FindBestSiblingAnchor(const SCandidate &c) {
   int best = -1;
   double bestScore = -1e100;
   int total = ArraySize(g_ranges);
   int limit = MathMax(0, total - MAX_RANGE_HISTORY_SCAN);
   for(int i = total - 1; i >= limit; --i) {
      if(!CandidateSiblingOfRange(c, g_ranges[i])) continue;
      double overlap = OverlapRatioToSmaller(c.high, c.low, g_ranges[i].high, g_ranges[i].low);
      double midDist = MathAbs(MidFromBounds(c.high, c.low) - MidFromBounds(g_ranges[i].high, g_ranges[i].low));
      double score = overlap * 10.0 - (midDist / MathMax(CandidateWidth(c), RangeWidth(g_ranges[i])));
      if(score > bestScore) { bestScore = score; best = i; }
   }
   return best;
}

int AddRangeRecord(const SCandidate &c, const ENUM_RANGE_RELATION rel, const int parent_id) {
   int n = ArraySize(g_ranges);
   ArrayResize(g_ranges, n + 1);
   g_ranges[n].id = g_nextRangeId++;
   g_ranges[n].parent_id = parent_id;
   g_ranges[n].state = RANGE_ACTIVE;
   g_ranges[n].relation = rel;
   g_ranges[n].t_start = c.t_start;
   g_ranges[n].t_end = c.t_end;
   g_ranges[n].born_bar_time = c.born_bar_time;
   g_ranges[n].last_seen_bar_time = c.born_bar_time;
   g_ranges[n].high = NormalizePrice(c.high);
   g_ranges[n].low = NormalizePrice(c.low);
   g_ranges[n].consec_above = 0;
   g_ranges[n].consec_below = 0;
   return n;
}

int ProcessRangeCandidate(const SCandidate &c) {
   int sameIdx = FindBestSame(c);
   if(sameIdx >= 0) {
      int parent_id = (g_ranges[sameIdx].parent_id > 0 ? g_ranges[sameIdx].parent_id : g_ranges[sameIdx].id);
      return AddRangeRecord(c, RANGE_SIBLING, parent_id);
   }
   int childIdx = FindBestChildParent(c);
   if(childIdx >= 0) return AddRangeRecord(c, RANGE_CHILD, g_ranges[childIdx].id);
   int siblingIdx = FindBestSiblingAnchor(c);
   if(siblingIdx >= 0) {
      int parent_id = (g_ranges[siblingIdx].parent_id > 0 ? g_ranges[siblingIdx].parent_id : g_ranges[siblingIdx].id);
      return AddRangeRecord(c, RANGE_SIBLING, parent_id);
   }
   return AddRangeRecord(c, RANGE_ROOT, -1);
}

bool BuildRangeCandidateAtOpenShift(const int openShift, SCandidate &c) {
   int bars = iBars(_Symbol, InpRangeTF);
   if(openShift + rangeBars >= bars) return false;
   c.t_start = iTime(_Symbol, InpRangeTF, openShift + rangeBars);
   if(g_lastRangeBreakTime != 0 && c.t_start <= g_lastRangeBreakTime)
      return false;
   int highShift = iHighest(_Symbol, InpRangeTF, MODE_HIGH, rangeBars, openShift + 1);
   int lowShift = iLowest(_Symbol, InpRangeTF, MODE_LOW, rangeBars, openShift + 1);
   if(highShift < 0 || lowShift < 0) return false;
   double hi = NormalizePrice(iHigh(_Symbol, InpRangeTF, highShift));
   double lo = NormalizePrice(iLow(_Symbol, InpRangeTF, lowShift));
   if((hi - lo) > PipsToPrice(maxRangePips)) return false;
   c.t_end = iTime(_Symbol, InpRangeTF, openShift);
   c.born_bar_time = iTime(_Symbol, InpRangeTF, openShift);
   c.high = hi;
   c.low = lo;
   return true;
}

void AdvanceActiveRangeHistorical(const int barShift) {
   if(g_activeRangeIdx < 0) return;
   datetime barTime = iTime(_Symbol, InpRangeTF, barShift);
   if(g_ranges[g_activeRangeIdx].t_end != barTime)
      g_ranges[g_activeRangeIdx].t_end = barTime;
   double upper = g_ranges[g_activeRangeIdx].high + BreakBuffer();
   double lower = g_ranges[g_activeRangeIdx].low - BreakBuffer();
   bool broken = false;
   if(breakoutCandles <= 0) {
      double barHigh = NormalizePrice(iHigh(_Symbol, InpRangeTF, barShift));
      double barLow = NormalizePrice(iLow(_Symbol, InpRangeTF, barShift));
      if(barHigh > upper || barLow < lower) broken = true;
   } else {
      double barClose = NormalizePrice(iClose(_Symbol, InpRangeTF, barShift));
      if(barClose > upper)      { g_ranges[g_activeRangeIdx].consec_above++; g_ranges[g_activeRangeIdx].consec_below = 0; }
      else if(barClose < lower) { g_ranges[g_activeRangeIdx].consec_below++; g_ranges[g_activeRangeIdx].consec_above = 0; }
      else                      { g_ranges[g_activeRangeIdx].consec_above = 0; g_ranges[g_activeRangeIdx].consec_below = 0; }
      if(g_ranges[g_activeRangeIdx].consec_above >= breakoutCandles || g_ranges[g_activeRangeIdx].consec_below >= breakoutCandles)
         broken = true;
   }
   if(broken) {
      double breakMid = MidFromBounds(g_ranges[g_activeRangeIdx].high, g_ranges[g_activeRangeIdx].low);
      double breakClose = NormalizePrice(iClose(_Symbol, InpRangeTF, barShift));
      RegisterRangeBreak(breakClose, breakMid, barTime);
      g_ranges[g_activeRangeIdx].state = RANGE_BROKEN;
      g_ranges[g_activeRangeIdx].t_end = barTime;
      g_lastRangeBreakTime = barTime;
      g_activeRangeIdx = -1;
   }
}

void AdvanceActiveRangeLive(const bool isNewTfBar) {
   if(g_activeRangeIdx < 0) return;
   bool changed = false;
   datetime currentOpen = iTime(_Symbol, InpRangeTF, 0);
   if(g_ranges[g_activeRangeIdx].t_end != currentOpen) {
      g_ranges[g_activeRangeIdx].t_end = currentOpen;
      changed = true;
   }
   double upper = g_ranges[g_activeRangeIdx].high + BreakBuffer();
   double lower = g_ranges[g_activeRangeIdx].low - BreakBuffer();
   bool broken = false;
   if(breakoutCandles <= 0) {
      double ask = NormalizePrice(SymbolInfoDouble(_Symbol, SYMBOL_ASK));
      double bid = NormalizePrice(SymbolInfoDouble(_Symbol, SYMBOL_BID));
      if(ask > upper || bid < lower) {
         g_ranges[g_activeRangeIdx].state = RANGE_BROKEN;
         g_ranges[g_activeRangeIdx].t_end = TimeCurrent();
         g_lastRangeBreakTime = g_ranges[g_activeRangeIdx].t_end;
         broken = true;
      }
   } else if(isNewTfBar) {
      double close1 = NormalizePrice(iClose(_Symbol, InpRangeTF, 1));
      if(close1 > upper)      { g_ranges[g_activeRangeIdx].consec_above++; g_ranges[g_activeRangeIdx].consec_below = 0; }
      else if(close1 < lower) { g_ranges[g_activeRangeIdx].consec_below++; g_ranges[g_activeRangeIdx].consec_above = 0; }
      else                    { g_ranges[g_activeRangeIdx].consec_above = 0; g_ranges[g_activeRangeIdx].consec_below = 0; }
      if(g_ranges[g_activeRangeIdx].consec_above >= breakoutCandles || g_ranges[g_activeRangeIdx].consec_below >= breakoutCandles) {
         g_ranges[g_activeRangeIdx].state = RANGE_BROKEN;
         g_ranges[g_activeRangeIdx].t_end = currentOpen;
         g_lastRangeBreakTime = currentOpen;
         broken = true;
      }
      changed = true;
   }
   if(broken) {
      double breakMid = MidFromBounds(g_ranges[g_activeRangeIdx].high, g_ranges[g_activeRangeIdx].low);
      double refPrice = NormalizePrice((SymbolInfoDouble(_Symbol, SYMBOL_ASK) + SymbolInfoDouble(_Symbol, SYMBOL_BID)) * 0.5);
      RegisterRangeBreak(refPrice, breakMid, g_lastRangeBreakTime);
      RenderRangeRecord(g_ranges[g_activeRangeIdx]);
      g_activeRangeIdx = -1;
   } else if(changed) {
      RenderRangeRecord(g_ranges[g_activeRangeIdx]);
   }
}

bool DetectNewRangeTfBar() {
   datetime currentBar = iTime(_Symbol, InpRangeTF, 0);
   if(currentBar == 0) return false;
   if(g_lastRangeTfBarTime == 0) {
      g_lastRangeTfBarTime = currentBar;
      return false;
   }
   if(currentBar != g_lastRangeTfBarTime) {
      g_lastRangeTfBarTime = currentBar;
      return true;
   }
   return false;
}

void RegisterRangeBreak(const double breakPrice, const double rangeMid, const datetime breakTime) {
   if(breakPrice >= rangeMid) {
      BullBreakCount++;
      BearBreakCount = 0;
      LastBullBreakPrice = breakPrice;
      LastBullBreakTime = breakTime;
   } else {
      BearBreakCount++;
      BullBreakCount = 0;
      LastBearBreakPrice = breakPrice;
      LastBearBreakTime = breakTime;
   }
}

void BuildRangeHistory() {
   DeleteRangeObjects();
   ResetRangeEngine();
   if(!RangeEnoughBars()) return;
   int bars = iBars(_Symbol, InpRangeTF);
   for(int openShift = bars - rangeBars - 1; openShift >= 0; --openShift) {
      if(g_activeRangeIdx != -1)
         AdvanceActiveRangeHistorical(openShift);
      if(g_activeRangeIdx == -1) {
         SCandidate c;
         if(BuildRangeCandidateAtOpenShift(openShift, c))
            g_activeRangeIdx = ProcessRangeCandidate(c);
      }
   }
   if(g_activeRangeIdx != -1)
      g_ranges[g_activeRangeIdx].t_end = iTime(_Symbol, InpRangeTF, 0);
   RenderAllRangeRecords();
   g_lastRangeTfBarTime = iTime(_Symbol, InpRangeTF, 0);
   g_range_history_built = true;
}

void RunRangeLive() {
   if(rangeBars < 2 || !RangeEnoughBars())
      return;
   if(!g_range_history_built) {
      BuildRangeHistory();
      return;
   }
   bool isNewTfBar = DetectNewRangeTfBar();
   if(g_activeRangeIdx != -1)
      AdvanceActiveRangeLive(isNewTfBar);
   if(g_activeRangeIdx == -1 && isNewTfBar) {
      SCandidate c;
      if(BuildRangeCandidateAtOpenShift(0, c)) {
         g_activeRangeIdx = ProcessRangeCandidate(c);
         RenderRangeRecord(g_ranges[g_activeRangeIdx]);
      }
   }
}

void K_Means(int n, int k, int iterations, double &prices[], double &volumes[], int &assignments[]) {
   ArrayResize(assignments, n);
   ArrayInitialize(assignments, -1);
   double centroids[];
   ArrayResize(centroids, k);
   double minP = 1e10, maxP = -1e10;
   for(int i = 0; i < n; i++) {
      if(prices[i] < minP) minP = prices[i];
      if(prices[i] > maxP) maxP = prices[i];
   }
   bool memory_valid = (ArraySize(mem_centroids) == k);
   if(memory_valid) {
      for(int i = 0; i < k; i++) {
         if(mem_centroids[i] < minP - (maxP - minP) || mem_centroids[i] > maxP + (maxP - minP)) {
            memory_valid = false;
            break;
         }
      }
   }
   if(memory_valid)
      ArrayCopy(centroids, mem_centroids);
   else {
      double step = (maxP - minP) / (k + 1);
      for(int i = 0; i < k; i++)
         centroids[i] = minP + (i + 1) * step;
   }
   double sum_pv[], sum_v[];
   ArrayResize(sum_pv, k);
   ArrayResize(sum_v, k);
   for(int iter = 0; iter < iterations; iter++) {
      bool changed = false;
      for(int i = 0; i < n; i++) {
         double p = prices[i];
         int best_k = 0;
         double min_dist = 1e10;
         for(int j = 0; j < k; j++) {
            double dist = MathAbs(p - centroids[j]);
            if(dist < min_dist) {
               min_dist = dist;
               best_k = j;
            }
         }
         if(assignments[i] != best_k) {
            assignments[i] = best_k;
            changed = true;
         }
      }
      if(!changed && iter > 0)
         break;
      ArrayInitialize(sum_pv, 0.0);
      ArrayInitialize(sum_v, 0.0);
      for(int i = 0; i < n; i++) {
         int cluster = assignments[i];
         sum_pv[cluster] += prices[i] * volumes[i];
         sum_v[cluster] += volumes[i];
      }
      for(int j = 0; j < k; j++)
         if(sum_v[j] > 0.0)
            centroids[j] = sum_pv[j] / sum_v[j];
   }
   ArrayResize(mem_centroids, k);
   ArrayCopy(mem_centroids, centroids);
}

bool MatchesMagic(const long magic) {
   return (MagicNumber == 0 || magic == MagicNumber);
}

bool IsManagedPositionSelected() {
   return (PositionGetString(POSITION_SYMBOL) == _Symbol && MatchesMagic(PositionGetInteger(POSITION_MAGIC)));
}

bool Prechecks() {
   if(MaxLotSize < MinLotSize) {
      Print("MaxLotSize cannot be less than MinLotSize");
      return false;
   }
   if(InpRequireHTF && PeriodSeconds(ResolveCalcTF()) < PeriodSeconds((ENUM_TIMEFRAMES)_Period)) {
      Print("Selected calc timeframe must be >= current chart timeframe.");
      return false;
   }
   return true;
}

void ReleaseHandles() {
   if(ATRHandle != INVALID_HANDLE) IndicatorRelease(ATRHandle);
   if(PSARHandle != INVALID_HANDLE) IndicatorRelease(PSARHandle);
   if(AMAHandle != INVALID_HANDLE) IndicatorRelease(AMAHandle);
   if(WiseNetFilterHandle != INVALID_HANDLE) IndicatorRelease(WiseNetFilterHandle);
   if(handleWiseDayLine != INVALID_HANDLE) IndicatorRelease(handleWiseDayLine);
   if(handleVWAPDaily != INVALID_HANDLE) IndicatorRelease(handleVWAPDaily);
   if(handleVWAPWeekly != INVALID_HANDLE) IndicatorRelease(handleVWAPWeekly);
   ATRHandle = INVALID_HANDLE;
   PSARHandle = INVALID_HANDLE;
   AMAHandle = INVALID_HANDLE;
   WiseNetFilterHandle = INVALID_HANDLE;
   handleWiseDayLine = INVALID_HANDLE;
   handleVWAPDaily = INVALID_HANDLE;
   handleVWAPWeekly = INVALID_HANDLE;
}

bool InitializeHandles() {
   ATRHandle = iATR(_Symbol, ATRTimeFrame, ATRPeriod);
   if(ATRHandle == INVALID_HANDLE) return false;

   PSARHandle = iSAR(_Symbol, PERIOD_CURRENT, PSARStep, PSARMaximum);
   if(PSARHandle == INVALID_HANDLE) return false;

   AMAHandle = iAMA(_Symbol, PERIOD_CURRENT, AMATrailingPeriod, AMATrailingFastEMA, AMATrailingSlowEMA, AMATrailingSignal, AMATrailingApplyPrice);
   if(AMAHandle == INVALID_HANDLE) return false;

   if(UseWiseNetFilter || UseWiseNetLocationFilter || EnableTrendFiltering) {
      WiseNetFilterHandle = iMA(_Symbol, PERIOD_CURRENT, WiseNetPeriod, WiseNetShift, WiseNetMethod, WiseNetAppliedPrice);
      if(WiseNetFilterHandle == INVALID_HANDLE) return false;
   }

   if(UseWiseDayLineFilter) {
      handleWiseDayLine = iCustom(_Symbol, PERIOD_CURRENT, "WiseDayLine.ex5", TimeShift);
      if(handleWiseDayLine == INVALID_HANDLE) return false;
   }

   if(UseVWAPDailyFilter || UseVWAPDailyLocationFilter) {
      handleVWAPDaily = iCustom(_Symbol, PERIOD_CURRENT, "\\Indicators\\vwap1");
      if(handleVWAPDaily == INVALID_HANDLE) return false;
   }

   if(UseVWAPWeeklyFilter || UseVWAPWeeklyLocationFilter) {
      handleVWAPWeekly = iCustom(_Symbol, PERIOD_CURRENT, "\\Indicators\\vwap1");
      if(handleVWAPWeekly == INVALID_HANDLE) return false;
   }

   return true;
}

void SetTradeObject() {
   Trade.SetExpertMagicNumber(MagicNumber);
   Trade.SetDeviationInPoints(Slippage);
}

bool GetIndicatorsData() {
   double atrBuf[2];
   if(CopyBuffer(ATRHandle, 0, 0, 2, atrBuf) < 2)
      return false;
   ATR_previous = atrBuf[0];
   ATR_current = atrBuf[1];

   if(WiseNetFilterHandle != INVALID_HANDLE && CopyBuffer(WiseNetFilterHandle, 0, 0, 2, netBuffer) < 2)
      return false;

   if(handleWiseDayLine != INVALID_HANDLE && CopyBuffer(handleWiseDayLine, WiseDayLineBuffer, 0, 2, dayLineBuffer) < 2)
      return false;

   if(handleVWAPDaily != INVALID_HANDLE && CopyBuffer(handleVWAPDaily, 0, 0, 2, vwapDailyBuffer) < 2)
      return false;

   if(handleVWAPWeekly != INVALID_HANDLE && CopyBuffer(handleVWAPWeekly, 1, 0, 2, vwapWeeklyBuffer) < 2)
      return false;

   return true;
}

bool CheckSpreadOK() {
   int spread = (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   return (spread <= MaxSpread || MaxSpread <= 0);
}

bool IsCurrentTimeInInterval(const int startHour, const int endHour) {
   MqlDateTime now;
   TimeToStruct(TimeCurrent(), now);
   int currentHour = now.hour;
   if(startHour == endHour)
      return true;
   if(startHour < endHour)
      return (currentHour >= startHour && currentHour < endHour);
   return (currentHour >= startHour || currentHour < endHour);
}

bool CheckTradingHours() {
   if(!UseTradingHours)
      return true;
   return IsCurrentTimeInInterval(TradingHourStart, TradingHourEnd);
}

int CountManagedPositions() {
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(PositionGetSymbol(i) == "")
         continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol)
         continue;
      if(!MatchesMagic(PositionGetInteger(POSITION_MAGIC)))
         continue;
      count++;
   }
   return count;
}

bool CanOpenNewPosition() {
   return (CountManagedPositions() < MaxPositions && CheckSpreadOK() && CheckTradingHours());
}

bool ModifyOrder(const ulong ticket, const double newSL, const double newTP) {
   if(!PositionSelectByTicket(ticket))
      return false;
   if(!Trade.PositionModify(ticket, newSL, newTP)) {
      Print("PositionModify failed: ", Trade.ResultRetcode(), " ", Trade.ResultRetcodeDescription());
      return false;
   }
   return true;
}

double DynamicStopLossPrice(ENUM_ORDER_TYPE type, double open_price) {
   if(ATR_previous <= 0.0) return 0.0;
   double stopLossPrice = 0.0;
   if(type == ORDER_TYPE_BUY)
      stopLossPrice = open_price - ATR_previous * ATRMultiplierSL;
   else if(type == ORDER_TYPE_SELL)
      stopLossPrice = open_price + ATR_previous * ATRMultiplierSL;
   return NormalizeDouble(stopLossPrice, (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS));
}

double DynamicTakeProfitPrice(ENUM_ORDER_TYPE type, double open_price) {
   if(ATR_previous <= 0.0) return 0.0;
   double takeProfitPrice = 0.0;
   if(type == ORDER_TYPE_BUY)
      takeProfitPrice = open_price + ATR_previous * ATRMultiplierTP;
   else if(type == ORDER_TYPE_SELL)
      takeProfitPrice = open_price - ATR_previous * ATRMultiplierTP;
   return NormalizeDouble(takeProfitPrice, (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS));
}

double StopLoss(ENUM_ORDER_TYPE order_type, double open_price) {
   double stopLossPrice = 0.0;
   if(StopLossMode == SL_FIXED) {
      if(DefaultStopLoss == 0) return 0.0;
      if(order_type == ORDER_TYPE_BUY)
         stopLossPrice = open_price - DefaultStopLoss * _Point;
      else if(order_type == ORDER_TYPE_SELL)
         stopLossPrice = open_price + DefaultStopLoss * _Point;
   } else {
      stopLossPrice = DynamicStopLossPrice(order_type, open_price);
   }
   return NormalizeDouble(stopLossPrice, (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS));
}

double TakeProfit(ENUM_ORDER_TYPE order_type, double open_price) {
   double takeProfitPrice = 0.0;
   if(TakeProfitMode == TP_FIXED) {
      if(DefaultTakeProfit == 0) return 0.0;
      if(order_type == ORDER_TYPE_BUY)
         takeProfitPrice = open_price + DefaultTakeProfit * _Point;
      else if(order_type == ORDER_TYPE_SELL)
         takeProfitPrice = open_price - DefaultTakeProfit * _Point;
   } else {
      takeProfitPrice = DynamicTakeProfitPrice(order_type, open_price);
   }
   return NormalizeDouble(takeProfitPrice, (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS));
}

double LotSize(double stop_loss, double open_price) {
   double size = DefaultLotSize;
   if(RiskDefaultSize == RISK_DEFAULT_AUTO) {
      if(stop_loss != 0.0) {
         double riskBaseAmount = 0.0;
         double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
         if(RiskBase == RISK_BASE_BALANCE) riskBaseAmount = AccountInfoDouble(ACCOUNT_BALANCE);
         else if(RiskBase == RISK_BASE_EQUITY) riskBaseAmount = AccountInfoDouble(ACCOUNT_EQUITY);
         else if(RiskBase == RISK_BASE_FREEMARGIN) riskBaseAmount = AccountInfoDouble(ACCOUNT_FREEMARGIN);
         double slPoints = MathAbs(open_price - stop_loss) / _Point;
         if(slPoints > 0.0 && tickValue > 0.0)
            size = (riskBaseAmount * MaxRiskPerTrade / 100.0) / (slPoints * tickValue);
      }
   }
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double brokerMax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double brokerMin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   size = MathFloor(size / lotStep) * lotStep;
   if(size > MaxLotSize) size = MaxLotSize;
   if(size > brokerMax) size = brokerMax;
   if(size < MinLotSize || size < brokerMin) size = 0.0;
   return size;
}

bool OpenBuy() {
   if(!CanOpenNewPosition()) return false;
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double sl = StopLoss(ORDER_TYPE_BUY, ask);
   double tp = TakeProfit(ORDER_TYPE_BUY, ask);
   double size = LotSize(sl, ask);
   if(size <= 0.0) return false;
   if(!Trade.Buy(size, _Symbol, ask, sl, tp, OrderNote)) {
      Print("Unable to open BUY: ", Trade.ResultRetcodeDescription());
      return false;
   }
   return true;
}

bool OpenSell() {
   if(!CanOpenNewPosition()) return false;
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double sl = StopLoss(ORDER_TYPE_SELL, bid);
   double tp = TakeProfit(ORDER_TYPE_SELL, bid);
   double size = LotSize(sl, bid);
   if(size <= 0.0) return false;
   if(!Trade.Sell(size, _Symbol, bid, sl, tp, OrderNote)) {
      Print("Unable to open SELL: ", Trade.ResultRetcodeDescription());
      return false;
   }
   return true;
}

void CloseAllBuy() {
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(PositionGetSymbol(i) == "") continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_TYPE) != POSITION_TYPE_BUY) continue;
      if(!MatchesMagic(PositionGetInteger(POSITION_MAGIC))) continue;
      Trade.PositionClose(PositionGetInteger(POSITION_TICKET));
   }
}

void CloseAllSell() {
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(PositionGetSymbol(i) == "") continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_TYPE) != POSITION_TYPE_SELL) continue;
      if(!MatchesMagic(PositionGetInteger(POSITION_MAGIC))) continue;
      Trade.PositionClose(PositionGetInteger(POSITION_TICKET));
   }
}

void CloseAllPositions() {
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(PositionGetSymbol(i) == "") continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(!MatchesMagic(PositionGetInteger(POSITION_MAGIC))) continue;
      Trade.PositionClose(PositionGetInteger(POSITION_TICKET));
   }
}

bool PartialClose(const ulong ticket, double percentage) {
   if(!PositionSelectByTicket(ticket)) return false;
   double size = PositionGetDouble(POSITION_VOLUME) * percentage / 100.0;
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double brokerMin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   size = MathFloor(size / lotStep) * lotStep;
   if(size < brokerMin) return false;
   return Trade.PositionClosePartial(ticket, size);
}

void PartialCloseAll() {
   if(!UsePartialClose || ATR_previous <= 0.0) return;
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(PositionGetSymbol(i) == "") continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(!MatchesMagic(PositionGetInteger(POSITION_MAGIC))) continue;
      ulong ticket = (ulong)PositionGetInteger(POSITION_TICKET);
      if(!HistorySelectByPosition(PositionGetInteger(POSITION_IDENTIFIER))) continue;
      bool need_partial_close = true;
      if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) {
         for(int j = HistoryDealsTotal() - 1; j >= 0; j--) {
            ulong deal_ticket = HistoryDealGetTicket(j);
            if(deal_ticket == 0) continue;
            if(HistoryDealGetInteger(deal_ticket, DEAL_TYPE) == DEAL_TYPE_SELL) {
               need_partial_close = false;
               break;
            }
         }
         if(need_partial_close && (SymbolInfoDouble(_Symbol, SYMBOL_BID) - PositionGetDouble(POSITION_PRICE_OPEN) > ATR_previous * ATRMultiplierPC))
            PartialClose(ticket, PartialClosePerc);
      } else if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL) {
         for(int j = HistoryDealsTotal() - 1; j >= 0; j--) {
            ulong deal_ticket = HistoryDealGetTicket(j);
            if(deal_ticket == 0) continue;
            if(HistoryDealGetInteger(deal_ticket, DEAL_TYPE) == DEAL_TYPE_BUY) {
               need_partial_close = false;
               break;
            }
         }
         if(need_partial_close && (PositionGetDouble(POSITION_PRICE_OPEN) - SymbolInfoDouble(_Symbol, SYMBOL_ASK) > ATR_previous * ATRMultiplierPC))
            PartialClose(ticket, PartialClosePerc);
      }
   }
}

void BreakEvenLogic() {
   if(!EnableBreakEven) return;
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(PositionGetSymbol(i) == "") continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(!MatchesMagic(PositionGetInteger(POSITION_MAGIC))) continue;
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double currentStopLoss = PositionGetDouble(POSITION_SL);
      ulong ticket = PositionGetTicket(i);
      if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) {
         double currentPrice = SymbolInfoDouble(_Symbol, SYMBOL_BID);
         if(currentPrice - openPrice >= BreakEvenDistance * _Point && currentStopLoss < openPrice)
            ModifyOrder(ticket, openPrice + 5 * _Point, PositionGetDouble(POSITION_TP));
      } else if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL) {
         double currentPrice = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
         if(openPrice - currentPrice >= BreakEvenDistance * _Point && (currentStopLoss > openPrice || currentStopLoss == 0.0))
            ModifyOrder(ticket, openPrice - 5 * _Point, PositionGetDouble(POSITION_TP));
      }
   }
}

bool CheckTrailingCondition(const ulong ticket) {
   if(!PositionSelectByTicket(ticket)) return false;
   double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
   int type = (int)PositionGetInteger(POSITION_TYPE);
   double current = (type == POSITION_TYPE_BUY) ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double profitPoints = MathAbs(current - openPrice) / _Point;
   return (profitPoints >= TrailingStartProfit);
}

double GetPSARBuy(string symbol) { double buf[1]; if(CopyBuffer(PSARHandle, 0, 0, 1, buf) < 1) return 0.0; return buf[0]; }
double GetPSARSell(string symbol) { return GetPSARBuy(symbol); }
double GetAMAStopLossBuy(string symbol) { double buf[1]; if(CopyBuffer(AMAHandle, 0, AMATrailingShift, 1, buf) < 1) return 0.0; return buf[0]; }
double GetAMAStopLossSell(string symbol) { return GetAMAStopLossBuy(symbol); }

void ApplyTrailingByStopValues(const double slBuy, const double slSell) {
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(ticket <= 0 || !PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(!MatchesMagic(PositionGetInteger(POSITION_MAGIC))) continue;
      if(!CheckTrailingCondition(ticket)) continue;
      int eDigits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
      double slPrice = NormalizeDouble(PositionGetDouble(POSITION_SL), eDigits);
      double tpPrice = NormalizeDouble(PositionGetDouble(POSITION_TP), eDigits);
      double spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) * _Point;
      double stopLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
      double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      double buySl = NormalizeDouble(slBuy, eDigits);
      double sellSl = NormalizeDouble(slSell, eDigits);
      if(tickSize > 0.0) {
         buySl = NormalizeDouble(MathRound(buySl / tickSize) * tickSize, eDigits);
         sellSl = NormalizeDouble(MathRound(sellSl / tickSize) * tickSize, eDigits);
      }
      if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY && buySl < SymbolInfoDouble(_Symbol, SYMBOL_BID) - stopLevel) {
         if((buySl > slPrice) || slPrice == 0.0)
            ModifyOrder(ticket, buySl, tpPrice);
      } else if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL && sellSl > SymbolInfoDouble(_Symbol, SYMBOL_ASK) + stopLevel) {
         double newSL = NormalizeDouble(sellSl + spread, eDigits);
         if((newSL < slPrice) || slPrice == 0.0)
            ModifyOrder(ticket, newSL, tpPrice);
      }
   }
}

void PSARTrailingStop() { double slBuy = GetPSARBuy(_Symbol); double slSell = GetPSARSell(_Symbol); if(slBuy != 0.0 && slSell != 0.0) ApplyTrailingByStopValues(slBuy, slSell); }
void AMATrailingStop() { double slBuy = GetAMAStopLossBuy(_Symbol); double slSell = GetAMAStopLossSell(_Symbol); if(slBuy != 0.0 && slSell != 0.0) ApplyTrailingByStopValues(slBuy, slSell); }

bool IsUsableLocationNumber(const double value) { return (MathIsValidNumber(value) && value != EMPTY_VALUE && value != 0.0); }

void PrintLocationReject(const string side, const string anchorName, const double distATR, const double maxATR) {
   if(DebugLocationFilter)
      Print(side, " location reject: ", anchorName, " distATR=", DoubleToString(distATR, 2), " maxATR=", DoubleToString(maxATR, 2));
}

double GetBuyExtensionATR(const double price, const double anchor, const bool reverseLogic = false) {
   if(ATR_previous <= 0.0) return DBL_MAX;
   double rawDist = reverseLogic ? (anchor - price) : (price - anchor);
   return rawDist / ATR_previous;
}

double GetSellExtensionATR(const double price, const double anchor, const bool reverseLogic = false) {
   if(ATR_previous <= 0.0) return DBL_MAX;
   double rawDist = reverseLogic ? (price - anchor) : (anchor - price);
   return rawDist / ATR_previous;
}

bool IsValidWiseNetBuySignal(double ask) {
   if(!UseWiseNetFilter) return true;
   return (IsUsableLocationNumber(netBuffer[0]) && ask > netBuffer[0]);
}

bool IsValidWiseNetSellSignal(double bid) {
   if(!UseWiseNetFilter) return true;
   return (IsUsableLocationNumber(netBuffer[0]) && bid < netBuffer[0]);
}

bool IsValidWiseDayLineBuySignal(double ask) {
   if(!UseWiseDayLineFilter) return true;
   return (IsUsableLocationNumber(dayLineBuffer[0]) && ask > dayLineBuffer[0]);
}

bool IsValidWiseDayLineSellSignal(double bid) {
   if(!UseWiseDayLineFilter) return true;
   return (IsUsableLocationNumber(dayLineBuffer[0]) && bid < dayLineBuffer[0]);
}

bool IsValidVWAPDailyBuySignal(double ask) {
   if(!UseVWAPDailyFilter) return true;
   if(!IsUsableLocationNumber(vwapDailyBuffer[0])) return false;
   return ReverseVWAPDailyLogic ? (ask < vwapDailyBuffer[0]) : (ask > vwapDailyBuffer[0]);
}

bool IsValidVWAPDailySellSignal(double bid) {
   if(!UseVWAPDailyFilter) return true;
   if(!IsUsableLocationNumber(vwapDailyBuffer[0])) return false;
   return ReverseVWAPDailyLogic ? (bid > vwapDailyBuffer[0]) : (bid < vwapDailyBuffer[0]);
}

bool IsValidVWAPWeeklyBuySignal(double ask) {
   if(!UseVWAPWeeklyFilter) return true;
   if(!IsUsableLocationNumber(vwapWeeklyBuffer[0])) return false;
   return ReverseVWAPWeeklyLogic ? (ask < vwapWeeklyBuffer[0]) : (ask > vwapWeeklyBuffer[0]);
}

bool IsValidVWAPWeeklySellSignal(double bid) {
   if(!UseVWAPWeeklyFilter) return true;
   if(!IsUsableLocationNumber(vwapWeeklyBuffer[0])) return false;
   return ReverseVWAPWeeklyLogic ? (bid > vwapWeeklyBuffer[0]) : (bid < vwapWeeklyBuffer[0]);
}

bool IsValidBuyLocationSignal(double ask) {
   if(!UseLocationFilter) return true;
   if(!MathIsValidNumber(ask) || ATR_previous <= 0.0 || ATR_previous == EMPTY_VALUE) return false;
   if(UseWiseNetLocationFilter) {
      if(!IsUsableLocationNumber(netBuffer[0])) return false;
      double distWiseNetATR = GetBuyExtensionATR(ask, netBuffer[0], false);
      if(distWiseNetATR > MaxBuyWiseNetDistATR) { PrintLocationReject("BUY", "WiseNet", distWiseNetATR, MaxBuyWiseNetDistATR); return false; }
   }
   if(UseVWAPDailyLocationFilter) {
      if(!IsUsableLocationNumber(vwapDailyBuffer[0])) return false;
      double distDailyVWAPATR = GetBuyExtensionATR(ask, vwapDailyBuffer[0], ReverseVWAPDailyLogic);
      if(distDailyVWAPATR > MaxBuyVWAPDailyDistATR) { PrintLocationReject("BUY", "Daily VWAP", distDailyVWAPATR, MaxBuyVWAPDailyDistATR); return false; }
   }
   if(UseVWAPWeeklyLocationFilter) {
      if(!IsUsableLocationNumber(vwapWeeklyBuffer[0])) return false;
      double distWeeklyVWAPATR = GetBuyExtensionATR(ask, vwapWeeklyBuffer[0], ReverseVWAPWeeklyLogic);
      if(distWeeklyVWAPATR > MaxBuyVWAPWeeklyDistATR) { PrintLocationReject("BUY", "Weekly VWAP", distWeeklyVWAPATR, MaxBuyVWAPWeeklyDistATR); return false; }
   }
   return true;
}

bool IsValidSellLocationSignal(double bid) {
   if(!UseLocationFilter) return true;
   if(!MathIsValidNumber(bid) || ATR_previous <= 0.0 || ATR_previous == EMPTY_VALUE) return false;
   if(UseWiseNetLocationFilter) {
      if(!IsUsableLocationNumber(netBuffer[0])) return false;
      double distWiseNetATR = GetSellExtensionATR(bid, netBuffer[0], false);
      if(distWiseNetATR > MaxSellWiseNetDistATR) { PrintLocationReject("SELL", "WiseNet", distWiseNetATR, MaxSellWiseNetDistATR); return false; }
   }
   if(UseVWAPDailyLocationFilter) {
      if(!IsUsableLocationNumber(vwapDailyBuffer[0])) return false;
      double distDailyVWAPATR = GetSellExtensionATR(bid, vwapDailyBuffer[0], ReverseVWAPDailyLogic);
      if(distDailyVWAPATR > MaxSellVWAPDailyDistATR) { PrintLocationReject("SELL", "Daily VWAP", distDailyVWAPATR, MaxSellVWAPDailyDistATR); return false; }
   }
   if(UseVWAPWeeklyLocationFilter) {
      if(!IsUsableLocationNumber(vwapWeeklyBuffer[0])) return false;
      double distWeeklyVWAPATR = GetSellExtensionATR(bid, vwapWeeklyBuffer[0], ReverseVWAPWeeklyLogic);
      if(distWeeklyVWAPATR > MaxSellVWAPWeeklyDistATR) { PrintLocationReject("SELL", "Weekly VWAP", distWeeklyVWAPATR, MaxSellVWAPWeeklyDistATR); return false; }
   }
   return true;
}

bool IsValidBuyMaturitySignal() {
   if(!UseBreakMaturityGate) return true;
   return (BullBreakCount <= MaxBullBreakCount);
}

bool IsValidSellMaturitySignal() {
   if(!UseBreakMaturityGate) return true;
   return (BearBreakCount <= MaxBearBreakCount);
}

bool IsValidBuyPullbackSignal(double ask) {
   if(!UsePullbackGate) return true;
   int hiShift = iHighest(_Symbol, _Period, MODE_HIGH, PullbackLookbackBars, 1);
   int loShift = iLowest(_Symbol, _Period, MODE_LOW, PullbackLookbackBars, 1);
   if(hiShift < 0 || loShift < 0) return true;
   double hi = iHigh(_Symbol, _Period, hiShift);
   double lo = iLow(_Symbol, _Period, loShift);
   double width = MathMax(hi - lo, _Point);
   double pullback = (ask - lo) / width;
   return (pullback >= MinBuyPullbackFraction);
}

bool IsValidSellPullbackSignal(double bid) {
   if(!UsePullbackGate) return true;
   int hiShift = iHighest(_Symbol, _Period, MODE_HIGH, PullbackLookbackBars, 1);
   int loShift = iLowest(_Symbol, _Period, MODE_LOW, PullbackLookbackBars, 1);
   if(hiShift < 0 || loShift < 0) return true;
   double hi = iHigh(_Symbol, _Period, hiShift);
   double lo = iLow(_Symbol, _Period, loShift);
   double width = MathMax(hi - lo, _Point);
   double pullback = (hi - bid) / width;
   return (pullback >= MinSellPullbackFraction);
}

bool IsValidTrendBuySignal(double ask) {
   if(!EnableTrendFiltering) return true;
   return IsValidWiseNetBuySignal(ask) && IsValidWiseDayLineBuySignal(ask) && IsValidVWAPDailyBuySignal(ask) && IsValidVWAPWeeklyBuySignal(ask);
}

bool IsValidTrendSellSignal(double bid) {
   if(!EnableTrendFiltering) return true;
   return IsValidWiseNetSellSignal(bid) && IsValidWiseDayLineSellSignal(bid) && IsValidVWAPDailySellSignal(bid) && IsValidVWAPWeeklySellSignal(bid);
}

bool IsBigFilterBuyPass(double ask) {
   return IsValidTrendBuySignal(ask) && IsValidBuyLocationSignal(ask) && IsValidBuyMaturitySignal() && IsValidBuyPullbackSignal(ask);
}

bool IsBigFilterSellPass(double bid) {
   return IsValidTrendSellSignal(bid) && IsValidSellLocationSignal(bid) && IsValidSellMaturitySignal() && IsValidSellPullbackSignal(bid);
}

bool CanRefreshSignal(const bool isBuy) {
   datetime nowBar = iTime(_Symbol, _Period, 0);
   if(isBuy) {
      if(lastBuySignalTime == 0 || nowBar - lastBuySignalTime >= SignalRefreshPeriod * PeriodSeconds(_Period)) {
         lastBuySignalTime = nowBar;
         return true;
      }
      return false;
   }
   if(lastSellSignalTime == 0 || nowBar - lastSellSignalTime >= SignalRefreshPeriod * PeriodSeconds(_Period)) {
      lastSellSignalTime = nowBar;
      return true;
   }
   return false;
}

bool EntryBuyStub(double &sl, double &tp, double &size) {
   sl = 0.0;
   tp = 0.0;
   size = 0.0;
   return false;
}

bool EntrySellStub(double &sl, double &tp, double &size) {
   sl = 0.0;
   tp = 0.0;
   size = 0.0;
   return false;
}

void EvaluateEntryLogic() {
   if(!CheckTradingHours() || !CheckSpreadOK()) return;
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   bool buyFilterPass = IsBigFilterBuyPass(ask);
   bool sellFilterPass = IsBigFilterSellPass(bid);
   double sl = 0.0, tp = 0.0, size = 0.0;
   if(buyFilterPass && CanRefreshSignal(true)) {
      if(EntryBuyStub(sl, tp, size))
         OpenBuy();
   }
   if(sellFilterPass && CanRefreshSignal(false)) {
      if(EntrySellStub(sl, tp, size))
         OpenSell();
   }
}

void CloseByTime() {
   if(!UseCloseByTime) return;
   MqlDateTime now;
   TimeToStruct(TimeCurrent(), now);
   if(now.hour != CloseHour || now.min != CloseMinute) return;
   CloseAllPositions();
}

void RefreshStateTreeVisuals() {
   uint nowTick = GetTickCount();
   if(nowTick - g_lastVisualRefresh < InpRefreshRate)
      return;
   g_lastVisualRefresh = nowTick;

   MqlRates chart_rates[];
   if(CopyRates(_Symbol, _Period, 0, 2, chart_rates) < 2)
      return;
   ArraySetAsSeries(chart_rates, true);

   MqlRates src_rates[];
   int bars_needed = InpLookback + 2;
   int copied = CopyRates(_Symbol, g_calc_tf, 0, bars_needed, src_rates);
   if(copied < InpLookback + 1)
      return;
   ArraySetAsSeries(src_rates, true);

   int lookback = MathMin(InpLookback, copied - 1);
   if(lookback < 2)
      return;

   double prices[], volumes[], highs[], lows[];
   ArrayResize(prices, lookback);
   ArrayResize(volumes, lookback);
   ArrayResize(highs, lookback);
   ArrayResize(lows, lookback);
   for(int i = 0; i < lookback; i++) {
      prices[i] = (src_rates[i].high + src_rates[i].low) / 2.0;
      highs[i] = src_rates[i].high;
      lows[i] = src_rates[i].low;
      volumes[i] = GetBarVolume(src_rates[i]);
   }

   int activeClusterCount = RequestedClusterCount();
   bool useExtremeZones = CanUseExtremeZones();
   int assignments[];
   K_Means(lookback, activeClusterCount, InpIterations, prices, volumes, assignments);

   datetime calcStartTime = src_rates[lookback - 1].time;
   datetime vpStartTime = chart_rates[0].time + (datetime)(InpVPOffset * g_chart_period_sec);
   int cur_dots = 0, cur_boxes = 0, cur_lines = 0, cur_txt_poc = 0, cur_txt_tot = 0, cur_txt_vel = 0;
   int reservedForMetrics = (activeClusterCount + (useExtremeZones ? 2 : 0)) * 2;
   int maxObjects = 500;

   double clusterPoc[];
   double zonePoc[];
   double zoneRange[];
   double zoneMass[];
   double zoneBinSize[];
   double zonePocVol[];
   datetime zoneEndTime[];
   bool zoneValid[];
   ArrayResize(clusterPoc, MAX_CLUSTERS);
   ArrayResize(zonePoc, MAX_CLUSTERS);
   ArrayResize(zoneRange, MAX_CLUSTERS);
   ArrayResize(zoneMass, MAX_CLUSTERS);
   ArrayResize(zoneBinSize, MAX_CLUSTERS);
   ArrayResize(zonePocVol, MAX_CLUSTERS);
   ArrayResize(zoneEndTime, MAX_CLUSTERS);
   ArrayResize(zoneValid, MAX_CLUSTERS);
   ArrayInitialize(clusterPoc, EMPTY_VALUE);
   ArrayInitialize(zonePoc, 0.0);
   ArrayInitialize(zoneRange, 0.0);
   ArrayInitialize(zoneMass, 0.0);
   ArrayInitialize(zoneBinSize, 0.0);
   ArrayInitialize(zonePocVol, 0.0);
   ArrayInitialize(zoneEndTime, 0);
   for(int i = 0; i < MAX_CLUSTERS; i++) zoneValid[i] = false;

   for(int c_id = 0; c_id < activeClusterCount; c_id++) {
      color clusterColor = PALETTE[c_id % 10];
      color fadedColor = MixColor(clusterColor, 0.85);
      double c_min = 1e10, c_max = -1e10;
      double c_total_vol = 0.0;
      int elementsInCluster = 0;

      for(int i = 0; i < lookback; i++) {
         if(assignments[i] == c_id) {
            if(lows[i] < c_min) c_min = lows[i];
            if(highs[i] > c_max) c_max = highs[i];
            c_total_vol += volumes[i];
            elementsInCluster++;
            if(InpShowDots && cur_dots < (maxObjects - reservedForMetrics))
               DrawDot(cur_dots++, src_rates[i].time, prices[i], clusterColor, (int)InpDotSize);
         }
      }

      if(elementsInCluster <= 0)
         continue;

      double binVols[];
      ArrayResize(binVols, InpRowsPerVP);
      ArrayInitialize(binVols, 0.0);
      double binSize = (c_max - c_min) / InpRowsPerVP;
      if(binSize == 0.0)
         binSize = SymbolInfoDouble(_Symbol, SYMBOL_POINT);

      for(int i = 0; i < lookback; i++) {
         if(assignments[i] != c_id) continue;
         double wickRange = MathMax(highs[i] - lows[i], _Point);
         for(int b_idx = 0; b_idx < InpRowsPerVP; b_idx++) {
            double binB = c_min + b_idx * binSize;
            double binT = binB + binSize;
            double intersectL = MathMax(lows[i], binB);
            double intersectH = MathMin(highs[i], binT);
            if(intersectH > intersectL)
               binVols[b_idx] += volumes[i] * (intersectH - intersectL) / wickRange;
         }
      }

      double maxBinVol = -1.0;
      int pocBinIdx = -1;
      for(int b_idx = 0; b_idx < InpRowsPerVP; b_idx++) {
         if(binVols[b_idx] > maxBinVol) {
            maxBinVol = binVols[b_idx];
            pocBinIdx = b_idx;
         }
      }

      for(int b_idx = 0; b_idx < InpRowsPerVP; b_idx++) {
         double vol = binVols[b_idx];
         if(vol == 0.0) continue;
         double b_bottom = c_min + b_idx * binSize;
         double b_top = b_bottom + binSize;
         int b_width_bars = (maxBinVol > 0.0) ? (int)((vol / maxBinVol) * InpVPWidth) : 0;
         datetime endXTime = vpStartTime + (datetime)(b_width_bars * g_chart_period_sec);
         bool isPoc = (b_idx == pocBinIdx);
         color b_color = isPoc ? clusterColor : fadedColor;
         if(isPoc) {
            double pocY = (b_top + b_bottom) / 2.0;
            double cur_range = c_max - c_min;
            clusterPoc[c_id] = pocY;
            LevelStates[c_id].synthetic = false;
            LevelStates[c_id].activated = true;
            LevelStates[c_id].source_slot = -1;
            UpdateLevelState(LevelStates[c_id], pocY, c_total_vol, cur_range, binSize, src_rates[0].time, g_calc_period_sec, src_rates[0].open, src_rates[0].high, src_rates[0].low, src_rates[0].close, src_rates[1].open, src_rates[1].high, src_rates[1].low, src_rates[1].close);
            zoneValid[c_id] = true;
            zonePoc[c_id] = pocY;
            zoneRange[c_id] = cur_range;
            zoneMass[c_id] = c_total_vol;
            zoneBinSize[c_id] = binSize;
            zonePocVol[c_id] = vol;
            zoneEndTime[c_id] = endXTime;
            int line_style = STYLE_DASH;
            int line_width = 2;
            color state_color = clusterColor;
            color text_color = ReadableTextColor(clusterColor);
            color poc_fill_color = clusterColor;
            color poc_border_color = clusterColor;
            ResolveStateVisuals(LevelStates[c_id].status, clusterColor, state_color, text_color, poc_fill_color, poc_border_color, line_style, line_width);
            DrawBox(cur_boxes++, vpStartTime, b_top, endXTime, b_bottom, poc_fill_color, poc_border_color);
            DrawLine(cur_lines++, calcStartTime, pocY, vpStartTime, state_color, line_style, line_width);
            DrawText("POCTxt_", cur_txt_poc++, calcStartTime, pocY, FormatVolume(vol), text_color, ANCHOR_RIGHT_LOWER);
            string stat_text = "[" + TfLabel(g_calc_tf) + "] Vol: " + FormatVolume(c_total_vol) + " " + GetStateString(LevelStates[c_id]);
            string vel_text = StringFormat("[%s] Velocity: [%s | %s | %s]", TfLabel(g_calc_tf), LevelStates[c_id].regime_dir, LevelStates[c_id].regime_auc, LevelStates[c_id].regime_vol);
            DrawText("TotTxt_", cur_txt_tot++, endXTime, pocY, stat_text, text_color, ANCHOR_LEFT_LOWER);
            DrawText("VelTxt_", cur_txt_vel++, endXTime, pocY, vel_text, text_color, ANCHOR_LEFT_UPPER);
         } else {
            DrawBox(cur_boxes++, vpStartTime, b_top, endXTime, b_bottom, b_color, clrNONE);
         }
      }
   }

   if(useExtremeZones) {
      int lowestIdx = -1, secondLowestIdx = -1, highestIdx = -1, secondHighestIdx = -1;
      for(int i = 0; i < activeClusterCount; i++) {
         if(!zoneValid[i]) continue;
         if(lowestIdx < 0 || zonePoc[i] < zonePoc[lowestIdx]) { secondLowestIdx = lowestIdx; lowestIdx = i; }
         else if(secondLowestIdx < 0 || zonePoc[i] < zonePoc[secondLowestIdx]) { secondLowestIdx = i; }
         if(highestIdx < 0 || zonePoc[i] > zonePoc[highestIdx]) { secondHighestIdx = highestIdx; highestIdx = i; }
         else if(secondHighestIdx < 0 || zonePoc[i] > zonePoc[secondHighestIdx]) { secondHighestIdx = i; }
      }
      int lowerSlot = activeClusterCount;
      int upperSlot = activeClusterCount + 1;
      if(lowerSlot < MAX_CLUSTERS)
         MaybeRenderExtremeZone(false, lowerSlot, lowestIdx, secondLowestIdx, calcStartTime, vpStartTime, src_rates[0].time, src_rates[0].open, src_rates[0].high, src_rates[0].low, src_rates[0].close, src_rates[1].open, src_rates[1].high, src_rates[1].low, src_rates[1].close, zonePoc, zoneRange, zoneMass, zoneBinSize, zonePocVol, zoneEndTime, zoneValid, clusterPoc, cur_boxes, cur_lines, cur_txt_poc, cur_txt_tot, cur_txt_vel);
      if(upperSlot < MAX_CLUSTERS)
         MaybeRenderExtremeZone(true, upperSlot, highestIdx, secondHighestIdx, calcStartTime, vpStartTime, src_rates[0].time, src_rates[0].open, src_rates[0].high, src_rates[0].low, src_rates[0].close, src_rates[1].open, src_rates[1].high, src_rates[1].low, src_rates[1].close, zonePoc, zoneRange, zoneMass, zoneBinSize, zonePocVol, zoneEndTime, zoneValid, clusterPoc, cur_boxes, cur_lines, cur_txt_poc, cur_txt_tot, cur_txt_vel);
   }

   for(int i = cur_dots; i < prev_dots; i++) ObjectDelete(0, g_prefix + "Dot_" + IntegerToString(i));
   for(int i = cur_boxes; i < prev_boxes; i++) ObjectDelete(0, g_prefix + "VPBox_" + IntegerToString(i));
   for(int i = cur_lines; i < prev_lines; i++) ObjectDelete(0, g_prefix + "POCLine_" + IntegerToString(i));
   for(int i = cur_txt_poc; i < prev_txt_poc; i++) ObjectDelete(0, g_prefix + "POCTxt_" + IntegerToString(i));
   for(int i = cur_txt_tot; i < prev_txt_tot; i++) ObjectDelete(0, g_prefix + "TotTxt_" + IntegerToString(i));
   for(int i = cur_txt_vel; i < prev_txt_vel; i++) ObjectDelete(0, g_prefix + "VelTxt_" + IntegerToString(i));
   prev_dots = cur_dots;
   prev_boxes = cur_boxes;
   prev_lines = cur_lines;
   prev_txt_poc = cur_txt_poc;
   prev_txt_tot = cur_txt_tot;
   prev_txt_vel = cur_txt_vel;
   PushPOCBuffers(clusterPoc);
   ChartRedraw(0);
}

void RunTradeManagement() {
   if(!GetIndicatorsData()) return;
   CloseByTime();
   BreakEvenLogic();
   if(EnablePSARTrailing) PSARTrailingStop();
   if(EnableAMATrailing) AMATrailingStop();
   if(UsePartialClose) PartialCloseAll();
}

void RunStateTree() {
   RunRangeLive();
   RefreshStateTreeVisuals();
   RunTradeManagement();
   EvaluateEntryLogic();
}

int OnInit() {
   if(!Prechecks())
      return INIT_FAILED;

   PALETTE[0] = InpColor1; PALETTE[1] = InpColor2; PALETTE[2] = InpColor3; PALETTE[3] = InpColor4;
   PALETTE[4] = InpColor5; PALETTE[5] = InpColor6; PALETTE[6] = InpColor7; PALETTE[7] = InpColor8;
   PALETTE[8] = InpColor9; PALETTE[9] = InpColor10;

   g_calc_tf = ResolveCalcTF();
   g_chart_period_sec = MathMax(PeriodSeconds((ENUM_TIMEFRAMES)_Period), 1);
   g_calc_period_sec = MathMax(PeriodSeconds(g_calc_tf), 1);
   g_prefix = PREFIX_BASE + "VIS_" + TfLabel(g_calc_tf) + "_";
   g_range_prefix = PREFIX_BASE + "RNG_" + TfLabel(g_calc_tf) + "_" + TfLabel(InpRangeTF) + "_";

   for(int i = 0; i < MAX_CLUSTERS; i++) {
      LevelStates[i].price = 0.0;
      LevelStates[i].snap_time = 0;
      LevelStates[i].regime_dir = "Init";
      LevelStates[i].regime_auc = "Init";
      LevelStates[i].regime_vol = "Init";
      LevelStates[i].synthetic = false;
      LevelStates[i].activated = false;
      LevelStates[i].source_slot = -1;
      g_lastClusterPoc[i] = EMPTY_VALUE;
   }

   ResetRangeEngine();
   g_range_history_built = false;
   ReleaseHandles();
   if(!InitializeHandles())
      return INIT_FAILED;
   SetTradeObject();
   EventSetTimer(1);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) {
   EventKillTimer();
   DeleteAllObjects();
   DeleteRangeObjects();
   ReleaseHandles();
}

void OnTick() {
   RunStateTree();
}

void OnTimer() {
   RunRangeLive();
   RefreshStateTreeVisuals();
   CloseByTime();
}
//+------------------------------------------------------------------+

