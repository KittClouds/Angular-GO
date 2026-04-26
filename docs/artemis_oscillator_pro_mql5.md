//+------------------------------------------------------------------+
//| Artemis Oscillator PRO - compact MQL5 port                       |
//| KNN dashboard intentionally omitted for MQL5 simplicity          |
//+------------------------------------------------------------------+
#property strict
#property indicator_separate_window
#property indicator_minimum 0
#property indicator_maximum 100
#property indicator_plots   6
#property indicator_buffers 9
#property indicator_label1  "DRM Oscillator"
#property indicator_type1   DRAW_COLOR_LINE
#property indicator_color1  clrLime,clrTomato,clrLime,clrTomato,clrSilver
#property indicator_width1  2
#property indicator_label2  "Signal"
#property indicator_type2   DRAW_LINE
#property indicator_color2  clrOrange
#property indicator_width2  1
#property indicator_label3  "Bull Cross"
#property indicator_type3   DRAW_ARROW
#property indicator_color3  clrLime
#property indicator_label4  "Bear Cross"
#property indicator_type4   DRAW_ARROW
#property indicator_color4  clrTomato
#property indicator_label5  "VP Bull"
#property indicator_type5   DRAW_FILLING
#property indicator_color5  clrAqua
#property indicator_label6  "VP Bear"
#property indicator_type6   DRAW_FILLING
#property indicator_color6  clrViolet

enum ENUM_THEME { THEME_AURORA, THEME_EMBER, THEME_CYBER, THEME_ARCTIC, THEME_SOLAR, THEME_OBSIDIAN, THEME_CLASSIC, THEME_MONO };
enum ENUM_SMOOTH { SMOOTH_EMA, SMOOTH_SMA, SMOOTH_RMA, SMOOTH_TMA };
enum ENUM_PRICE_MODE { SRC_CLOSE, SRC_HLC3, SRC_HL2, SRC_OHLC4 };
enum ENUM_VOL_MODE { VOL_TICK, VOL_REAL };
enum ENUM_TEXT_SIZE { SIZE_TINY = 8, SIZE_SMALL = 9, SIZE_NORMAL = 10, SIZE_LARGE = 12 };

input ENUM_THEME      InpTheme          = THEME_AURORA;
input int             InpDrmLen         = 14;
input ENUM_SMOOTH     InpDrmMethod      = SMOOTH_RMA;
input ENUM_PRICE_MODE InpDrmSrc         = SRC_CLOSE;
input bool            InpAdaptiveColor  = true;
input int             InpSigLen         = 7;
input ENUM_SMOOTH     InpSigMethod      = SMOOTH_EMA;
input bool            InpSigDots        = true;
input double          InpObLevel        = 80.0;
input double          InpOsLevel        = 20.0;
input bool            InpVpShow         = true;
input ENUM_PRICE_MODE InpVpSrc          = SRC_HLC3;
input ENUM_VOL_MODE   InpVolMode        = VOL_TICK;
input bool            InpDivReg         = true;
input bool            InpDivHidden      = true;
input ENUM_TEXT_SIZE  InpDivSize        = SIZE_TINY;
input bool            InpSmartFilter    = false;
input double          InpSdfMinOsc      = 5.0;
input double          InpSdfMinPct      = 0.3;
input bool            InpSdfVpConfirm   = true;
input bool            InpExhaustion     = true;
input int             InpExhaustConfirm = 4;
input bool            InpAlertCross     = true;
input bool            InpAlertZone      = true;
input bool            InpAlertRegDiv    = true;
input bool            InpAlertHiddenDiv = false;
input bool            InpAlertVp        = true;
input bool            InpAlertExhaust   = true;
input int             InpHistoryBars    = 450;

double OscBuf[], OscClr[], SigBuf[], DotUpBuf[], DotDnBuf[], VpBullBuf[], VpBullBaseBuf[], VpBearBuf[], VpBearBaseBuf[];
double gSrc[], gVpSrc[], gHiBuf[], gLoBuf[], gForce[], gAbsForce[], gSUp[], gSAbs[], gOsc[], gSig[], gVpFast[], gVpSlow[], gVpMid[];
int gMeOb[], gMeOs[];
color gThOb = clrLime, gThOs = clrTomato, gThSig = clrOrange, gThVpBuy = clrAqua, gThVpSell = clrViolet;
string gShort = "Artemis Oscillator PRO";
string gPrefix = "AOP_";
int gWindow = -1;
datetime gLastBar = 0, gLastAlertBar = 0;
bool gRegBullNow = false, gRegBearNow = false, gHidBullNow = false, gHidBearNow = false, gExhObNow = false, gExhOsNow = false;

void ApplyTheme()
{
   switch(InpTheme)
   {
      case THEME_AURORA:   gThOb = C'0,229,255';   gThOs = C'206,147,216'; gThSig = C'255,109,0';  gThVpBuy = C'0,188,212';  gThVpSell = C'123,31,162'; break;
      case THEME_EMBER:    gThOb = C'255,157,0';   gThOs = C'65,159,236';  gThSig = C'255,69,0';   gThVpBuy = C'255,207,166';gThVpSell = C'70,131,180'; break;
      case THEME_CYBER:    gThOb = C'17,207,119';  gThOs = C'209,22,69';   gThSig = clrWhite;      gThVpBuy = C'0,230,118';  gThVpSell = C'255,23,68';  break;
      case THEME_ARCTIC:   gThOb = C'79,195,247';  gThOs = C'179,157,219'; gThSig = C'128,203,196';gThVpBuy = C'41,182,246'; gThVpSell = C'149,117,205';break;
      case THEME_SOLAR:    gThOb = C'255,214,0';   gThOs = C'218,91,82';   gThSig = C'255,143,0';  gThVpBuy = C'255,202,40'; gThVpSell = C'239,83,80';  break;
      case THEME_CLASSIC:  gThOb = C'13,71,161';   gThOs = C'183,28,28';   gThSig = C'84,110,122'; gThVpBuy = C'21,101,192'; gThVpSell = C'198,40,40';  break;
      case THEME_MONO:     gThOb = C'26,26,26';    gThOs = C'117,117,117'; gThSig = C'158,158,158';gThVpBuy = C'66,66,66';   gThVpSell = C'189,189,189';break;
      default:             gThOb = C'8,153,129';   gThOs = C'242,54,69';   gThSig = C'255,93,0';   gThVpBuy = C'8,153,129';  gThVpSell = C'156,39,176'; break;
   }
}

void ApplyPlotColors()
{
   PlotIndexSetInteger(0, PLOT_COLOR_INDEXES, 5);
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 0, gThOb);
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 1, gThOs);
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 2, gThOb);
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 3, gThOs);
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 4, clrSilver);
   PlotIndexSetInteger(1, PLOT_LINE_COLOR, 0, gThSig);
   PlotIndexSetInteger(2, PLOT_LINE_COLOR, 0, gThOb);
   PlotIndexSetInteger(3, PLOT_LINE_COLOR, 0, gThOs);
   PlotIndexSetInteger(4, PLOT_LINE_COLOR, 0, gThVpBuy);
   PlotIndexSetInteger(5, PLOT_LINE_COLOR, 0, gThVpSell);
}

double PriceAt(const int i, const ENUM_PRICE_MODE mode, const double &open[], const double &high[], const double &low[], const double &close[])
{
   if(mode == SRC_HLC3) return (high[i] + low[i] + close[i]) / 3.0;
   if(mode == SRC_HL2) return (high[i] + low[i]) / 2.0;
   if(mode == SRC_OHLC4) return (open[i] + high[i] + low[i] + close[i]) / 4.0;
   return close[i];
}

bool IsTesterMode()
{
   return ((bool)MQLInfoInteger(MQL_TESTER) || (bool)MQLInfoInteger(MQL_OPTIMIZATION));
}

string TimeKey(const datetime t)
{
   return IntegerToString((int)t);
}

void EnsureWorkSize(const int bars)
{
   if(ArraySize(gSrc) == bars) return;
   ArrayResize(gSrc, bars); ArraySetAsSeries(gSrc, true); ArrayResize(gVpSrc, bars); ArraySetAsSeries(gVpSrc, true);
   ArrayResize(gHiBuf, bars); ArraySetAsSeries(gHiBuf, true); ArrayResize(gLoBuf, bars); ArraySetAsSeries(gLoBuf, true);
   ArrayResize(gForce, bars); ArraySetAsSeries(gForce, true); ArrayResize(gAbsForce, bars); ArraySetAsSeries(gAbsForce, true);
   ArrayResize(gSUp, bars); ArraySetAsSeries(gSUp, true); ArrayResize(gSAbs, bars); ArraySetAsSeries(gSAbs, true);
   ArrayResize(gOsc, bars); ArraySetAsSeries(gOsc, true); ArrayResize(gSig, bars); ArraySetAsSeries(gSig, true);
   ArrayResize(gVpFast, bars); ArraySetAsSeries(gVpFast, true); ArrayResize(gVpSlow, bars); ArraySetAsSeries(gVpSlow, true); ArrayResize(gVpMid, bars); ArraySetAsSeries(gVpMid, true);
   ArrayResize(gMeOb, bars); ArraySetAsSeries(gMeOb, true); ArrayResize(gMeOs, bars); ArraySetAsSeries(gMeOs, true);
}

void DeleteByPrefix(const string stem)
{
   for(int i = ObjectsTotal(0, 0, -1) - 1; i >= 0; --i)
   {
      string name = ObjectName(0, i, 0, -1);
      if(StringFind(name, stem) == 0) ObjectDelete(0, name);
   }
}

void RefreshWindow()
{
   if(gWindow < 0) gWindow = ChartWindowFind(0, gShort);
   if(gWindow < 0) gWindow = 1;
}

void PutTrend(const string name, const datetime t1, const double y1, const datetime t2, const double y2, const color clr, const ENUM_LINE_STYLE style)
{
   if(ObjectFind(0, name) >= 0) return;
   ObjectCreate(0, name, OBJ_TREND, gWindow, t1, y1, t2, y2);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_STYLE, style);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 2);
   ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
}

void PutText(const string name, const datetime t, const double y, const string text, const color clr, const int size)
{
   if(ObjectFind(0, name) >= 0) return;
   ObjectCreate(0, name, OBJ_TEXT, gWindow, t, y);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, size);
   ObjectSetString(0, name, OBJPROP_FONT, "Consolas");
   ObjectSetInteger(0, name, OBJPROP_ANCHOR, ANCHOR_CENTER);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
}

double HighestN(const double &a[], const int total, const int i, const int n)
{
   double v = a[i];
   int end = MathMin(total - 1, i + MathMax(n - 1, 0));
   for(int j = i + 1; j <= end; ++j) if(a[j] > v) v = a[j];
   return v;
}

double LowestN(const double &a[], const int total, const int i, const int n)
{
   double v = a[i];
   int end = MathMin(total - 1, i + MathMax(n - 1, 0));
   for(int j = i + 1; j <= end; ++j) if(a[j] < v) v = a[j];
   return v;
}

double WindowRange(const double &high[], const double &low[], const int total, const int i, const int n)
{
   return HighestN(high, total, i, n) - LowestN(low, total, i, n);
}

bool IsPivotHigh(const double &a[], const int total, const int i, const int span)
{
   if(i - span < 0 || i + span >= total) return false;
   double v = a[i];
   for(int k = 1; k <= span; ++k) if(v <= a[i - k] || v < a[i + k]) return false;
   return true;
}

bool IsPivotLow(const double &a[], const int total, const int i, const int span)
{
   if(i - span < 0 || i + span >= total) return false;
   double v = a[i];
   for(int k = 1; k <= span; ++k) if(v >= a[i - k] || v > a[i + k]) return false;
   return true;
}

double CompressVP(const double x, const double k)
{
   double n = (x / 100.0 - 0.5) * 2.0;
   if(n == 0.0) return 0.0;
   return k * 100.0 * (n > 0.0 ? 1.0 : -1.0) * MathPow(MathAbs(n), 0.75);
}

double SMA0(const double &src[], const int total, const int period)
{
   double sum = 0.0; int end = MathMin(total - 1, period - 1), count = 0;
   for(int i = 0; i <= end; ++i) { sum += src[i]; count++; }
   return (count > 0 ? sum / count : src[0]);
}

double TMA0(const double &src[], const int total, const int period)
{
   double sum = 0.0; int end = MathMin(total - 1, period - 1), count = 0;
   for(int i = 0; i <= end; ++i) { double inner = 0.0; int innerEnd = MathMin(total - 1, i + period - 1), innerCount = 0; for(int j = i; j <= innerEnd; ++j) { inner += src[j]; innerCount++; } sum += (innerCount > 0 ? inner / innerCount : src[i]); count++; }
   return (count > 0 ? sum / count : src[0]);
}

double SmoothPoint0(const double &src[], const double &smoothed[], const int total, const int period, const ENUM_SMOOTH method)
{
   if(period <= 1) return src[0];
   if(method == SMOOTH_SMA) return SMA0(src, total, period);
   if(method == SMOOTH_TMA) return TMA0(src, total, period);
   double alpha = (method == SMOOTH_EMA ? 2.0 / (period + 1.0) : 1.0 / period);
   return alpha * src[0] + (1.0 - alpha) * (total > 1 ? smoothed[1] : src[0]);
}

void SmoothSeries(const double &src[], const int total, const int period, const ENUM_SMOOTH method, double &out[])
{
   ArrayResize(out, total);
   ArraySetAsSeries(out, true);
   ArrayInitialize(out, 0.0);
   if(period <= 1)
   {
      for(int i = 0; i < total; ++i) out[i] = src[i];
      return;
   }
   if(method == SMOOTH_TMA)
   {
      double mid[];
      SmoothSeries(src, total, period, SMOOTH_SMA, mid);
      SmoothSeries(mid, total, period, SMOOTH_SMA, out);
      return;
   }
   double alpha = (method == SMOOTH_EMA ? 2.0 / (period + 1.0) : 1.0 / period);
   for(int i = total - 1; i >= 0; --i)
   {
      if(method == SMOOTH_SMA)
      {
         double sum = 0.0;
         int count = 0, end = MathMin(total - 1, i + period - 1);
         for(int j = i; j <= end; ++j) { sum += src[j]; count++; }
         out[i] = (count > 0 ? sum / count : src[i]);
      }
      else out[i] = (i == total - 1 ? src[i] : alpha * src[i] + (1.0 - alpha) * out[i + 1]);
   }
}

int OnInit()
{
   DeleteByPrefix(gPrefix);
   ApplyTheme();
   IndicatorSetString(INDICATOR_SHORTNAME, gShort);
   SetIndexBuffer(0, OscBuf, INDICATOR_DATA);            ArraySetAsSeries(OscBuf, true);
   SetIndexBuffer(1, OscClr, INDICATOR_COLOR_INDEX);     ArraySetAsSeries(OscClr, true);
   SetIndexBuffer(2, SigBuf, INDICATOR_DATA);            ArraySetAsSeries(SigBuf, true);
   SetIndexBuffer(3, DotUpBuf, INDICATOR_DATA);          ArraySetAsSeries(DotUpBuf, true);
   SetIndexBuffer(4, DotDnBuf, INDICATOR_DATA);          ArraySetAsSeries(DotDnBuf, true);
   SetIndexBuffer(5, VpBullBuf, INDICATOR_DATA);         ArraySetAsSeries(VpBullBuf, true);
   SetIndexBuffer(6, VpBullBaseBuf, INDICATOR_DATA);     ArraySetAsSeries(VpBullBaseBuf, true);
   SetIndexBuffer(7, VpBearBuf, INDICATOR_DATA);         ArraySetAsSeries(VpBearBuf, true);
   SetIndexBuffer(8, VpBearBaseBuf, INDICATOR_DATA);     ArraySetAsSeries(VpBearBaseBuf, true);
   for(int p = 0; p < 6; ++p) PlotIndexSetDouble(p, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   PlotIndexSetInteger(2, PLOT_ARROW, 159);
   PlotIndexSetInteger(3, PLOT_ARROW, 159);
   IndicatorSetInteger(INDICATOR_LEVELS, 3);
   IndicatorSetDouble(INDICATOR_LEVELVALUE, 0, InpObLevel);
   IndicatorSetDouble(INDICATOR_LEVELVALUE, 1, 50.0);
   IndicatorSetDouble(INDICATOR_LEVELVALUE, 2, InpOsLevel);
   IndicatorSetInteger(INDICATOR_LEVELCOLOR, 0, gThOb);
   IndicatorSetInteger(INDICATOR_LEVELCOLOR, 1, clrSilver);
   IndicatorSetInteger(INDICATOR_LEVELCOLOR, 2, gThOs);
   IndicatorSetInteger(INDICATOR_LEVELSTYLE, 0, STYLE_DASH);
   IndicatorSetInteger(INDICATOR_LEVELSTYLE, 1, STYLE_DOT);
   IndicatorSetInteger(INDICATOR_LEVELSTYLE, 2, STYLE_DASH);
   ApplyPlotColors();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   DeleteByPrefix(gPrefix);
}

void RenderSignals(const datetime &time[], const double &high[], const double &low[], const double &osc[], const double &vp[], const int &meOb[], const int &meOs[], const int total)
{
   RefreshWindow();
   gRegBullNow = gRegBearNow = gHidBullNow = gHidBearNow = gExhObNow = gExhOsNow = false;
   int span = MathMax(InpDrmLen / 2, 2), alertShift = span + 1;
   int drawBars = MathMin(InpHistoryBars, IsTesterMode() ? 140 : InpHistoryBars);
   int oldest = MathMin(total - span - 1, drawBars + span);
   double prevHiPx = 0.0, prevHiOsc = 0.0, prevLoPx = 0.0, prevLoOsc = 0.0;
   int prevHiIdx = -1, prevLoIdx = -1;
   for(int i = oldest; i >= span; --i)
   {
      if(IsPivotHigh(high, total, i, span))
      {
         if(prevHiIdx >= 0)
         {
            bool reg = high[i] > prevHiPx && osc[i] < prevHiOsc;
            bool hid = high[i] < prevHiPx && osc[i] > prevHiOsc;
            double minAbs = WindowRange(high, low, total, i, InpDrmLen * 4) * (InpSdfMinPct / 100.0);
            bool pass = !InpSmartFilter || (MathAbs(osc[i] - prevHiOsc) >= InpSdfMinOsc && MathAbs(high[i] - prevHiPx) >= minAbs && (!InpSdfVpConfirm || vp[i] < 50.0));
            if(InpDivReg && reg && pass)
            {
               string tag = gPrefix + "SIG_RB_" + TimeKey(time[prevHiIdx]) + "_" + TimeKey(time[i]);
               PutTrend(tag, time[prevHiIdx], prevHiOsc, time[i], osc[i], gThOs, STYLE_SOLID);
               PutText(tag + "_T", time[i], osc[i] + 4.0, "Dv", gThOs, (int)InpDivSize);
               if(i == alertShift) gRegBearNow = true;
            }
            if(InpDivHidden && hid && pass)
            {
               string tag = gPrefix + "SIG_HB_" + TimeKey(time[prevHiIdx]) + "_" + TimeKey(time[i]);
               PutTrend(tag, time[prevHiIdx], prevHiOsc, time[i], osc[i], gThOs, STYLE_DASH);
               PutText(tag + "_T", time[i], osc[i] + 4.0, "Hv", gThOs, (int)InpDivSize);
               if(i == alertShift) gHidBearNow = true;
            }
         }
         prevHiPx = high[i]; prevHiOsc = osc[i]; prevHiIdx = i;
      }
      if(IsPivotLow(low, total, i, span))
      {
         if(prevLoIdx >= 0)
         {
            bool reg = low[i] < prevLoPx && osc[i] > prevLoOsc;
            bool hid = low[i] > prevLoPx && osc[i] < prevLoOsc;
            double minAbs = WindowRange(high, low, total, i, InpDrmLen * 4) * (InpSdfMinPct / 100.0);
            bool pass = !InpSmartFilter || (MathAbs(osc[i] - prevLoOsc) >= InpSdfMinOsc && MathAbs(low[i] - prevLoPx) >= minAbs && (!InpSdfVpConfirm || vp[i] > 50.0));
            if(InpDivReg && reg && pass)
            {
               string tag = gPrefix + "SIG_RG_" + TimeKey(time[prevLoIdx]) + "_" + TimeKey(time[i]);
               PutTrend(tag, time[prevLoIdx], prevLoOsc, time[i], osc[i], gThOb, STYLE_SOLID);
               PutText(tag + "_T", time[i], osc[i] - 4.0, "D^", gThOb, (int)InpDivSize);
               if(i == alertShift) gRegBullNow = true;
            }
            if(InpDivHidden && hid && pass)
            {
               string tag = gPrefix + "SIG_HG_" + TimeKey(time[prevLoIdx]) + "_" + TimeKey(time[i]);
               PutTrend(tag, time[prevLoIdx], prevLoOsc, time[i], osc[i], gThOb, STYLE_DASH);
               PutText(tag + "_T", time[i], osc[i] - 4.0, "H^", gThOb, (int)InpDivSize);
               if(i == alertShift) gHidBullNow = true;
            }
         }
         prevLoPx = low[i]; prevLoOsc = osc[i]; prevLoIdx = i;
      }
   }
   if(InpExhaustion)
   {
      for(int i = MathMin(total - 2, drawBars); i >= 1; --i)
      {
         if(meOb[i] == InpExhaustConfirm) { PutText(gPrefix + "SIG_EOB_" + TimeKey(time[i]), time[i], osc[i] + 6.0, "*OB", gThOb, 8); if(i == 1) gExhObNow = true; }
         if(meOs[i] == InpExhaustConfirm) { PutText(gPrefix + "SIG_EOS_" + TimeKey(time[i]), time[i], osc[i] - 6.0, "*OS", gThOs, 8); if(i == 1) gExhOsNow = true; }
      }
   }
}

void FireAlerts(const datetime &time[], const double &osc[], const double &sig[], const double &vp[], const int total)
{
   if(total < 3 || gLastAlertBar == time[1]) return;
   gLastAlertBar = time[1];
   bool crossUp = osc[1] > sig[1] && osc[2] <= sig[2], crossDn = osc[1] < sig[1] && osc[2] >= sig[2];
   bool exitOs = osc[1] > InpOsLevel && osc[2] <= InpOsLevel, exitOb = osc[1] < InpObLevel && osc[2] >= InpObLevel;
   bool vpIn = vp[1] > 50.0 && vp[2] <= 50.0, vpOut = vp[1] < 50.0 && vp[2] >= 50.0;
   if(InpAlertCross && crossUp && osc[1] < 50.0) Alert(gShort + ": Bullish Cross below midline");
   if(InpAlertCross && crossDn && osc[1] > 50.0) Alert(gShort + ": Bearish Cross above midline");
   if(InpAlertZone && exitOs) Alert(gShort + ": Exiting Oversold");
   if(InpAlertZone && exitOb) Alert(gShort + ": Exiting Overbought");
   if(InpAlertRegDiv && gRegBullNow) Alert(gShort + ": Regular Bullish Divergence");
   if(InpAlertRegDiv && gRegBearNow) Alert(gShort + ": Regular Bearish Divergence");
   if(InpAlertHiddenDiv && gHidBullNow) Alert(gShort + ": Hidden Bullish Divergence");
   if(InpAlertHiddenDiv && gHidBearNow) Alert(gShort + ": Hidden Bearish Divergence");
   if(InpAlertVp && vpIn) Alert(gShort + ": Volume Pressure Inflow");
   if(InpAlertVp && vpOut) Alert(gShort + ": Volume Pressure Outflow");
   if(InpAlertExhaust && gExhObNow) Alert(gShort + ": Momentum Exhaustion OB");
   if(InpAlertExhaust && gExhOsNow) Alert(gShort + ": Momentum Exhaustion OS");
}

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[], const double &high[], const double &low[], const double &close[], const long &tick_volume[], const long &volume[], const int &spread[])
{
   if(rates_total < MathMax(InpDrmLen * 3, 50)) return 0;
   ArraySetAsSeries(time, true);
   ArraySetAsSeries(open, true);
   ArraySetAsSeries(high, true);
   ArraySetAsSeries(low, true);
   ArraySetAsSeries(close, true);
   ArraySetAsSeries(tick_volume, true);
   ArraySetAsSeries(volume, true);
   ArraySetAsSeries(spread, true);
   int bars = MathMin(rates_total, MathMax(InpHistoryBars + InpDrmLen * 2, InpDrmLen * 8));
   bool newBar = (gLastBar != time[0]), fullCalc = (prev_calculated == 0 || newBar || ArraySize(gSrc) != bars);
   EnsureWorkSize(bars);
   if(prev_calculated == 0)
   {
      ArrayInitialize(OscBuf, EMPTY_VALUE);     ArrayInitialize(OscClr, 4.0);       ArrayInitialize(SigBuf, EMPTY_VALUE);
      ArrayInitialize(DotUpBuf, EMPTY_VALUE);   ArrayInitialize(DotDnBuf, EMPTY_VALUE);
      ArrayInitialize(VpBullBuf, EMPTY_VALUE);  ArrayInitialize(VpBullBaseBuf, EMPTY_VALUE);
      ArrayInitialize(VpBearBuf, EMPTY_VALUE);  ArrayInitialize(VpBearBaseBuf, EMPTY_VALUE);
   }
   if(!fullCalc)
   {
      gSrc[0] = PriceAt(0, InpDrmSrc, open, high, low, close);
      gVpSrc[0] = PriceAt(0, InpVpSrc, open, high, low, close);
      gHiBuf[0] = HighestN(gSrc, bars, 0, InpDrmLen);
      gLoBuf[0] = LowestN(gSrc, bars, 0, InpDrmLen);
      gForce[0] = (gHiBuf[0] > gHiBuf[1] ? gHiBuf[0] - gLoBuf[0] : gLoBuf[0] < gLoBuf[1] ? -(gHiBuf[0] - gLoBuf[0]) : gSrc[0] - gSrc[1]);
      gAbsForce[0] = MathAbs(gForce[0]);
      gSUp[0] = SmoothPoint0(gForce, gSUp, bars, InpDrmLen, InpDrmMethod);
      gSAbs[0] = SmoothPoint0(gAbsForce, gSAbs, bars, InpDrmLen, InpDrmMethod);
      gOsc[0] = (gSAbs[0] != 0.0 ? (gSUp[0] / gSAbs[0]) * 50.0 + 50.0 : 50.0);
      gSig[0] = SmoothPoint0(gOsc, gSig, bars, InpSigLen, InpSigMethod);
      int fastLen = MathMax((int)MathRound((double)InpDrmLen / 1.33), 2), slowLen = MathMax((int)MathRound((double)InpDrmLen * 1.33), 2);
      double posF = 0.0, negF = 0.0, posS = 0.0, negS = 0.0;
      for(int j = 0; j <= MathMin(bars - 2, fastLen - 1); ++j) { double flow = gVpSrc[j] * (double)((InpVolMode == VOL_REAL && volume[j] > 0) ? volume[j] : tick_volume[j]); if(gVpSrc[j] > gVpSrc[j + 1]) posF += flow; else if(gVpSrc[j] < gVpSrc[j + 1]) negF += flow; }
      for(int j = 0; j <= MathMin(bars - 2, slowLen - 1); ++j) { double flow = gVpSrc[j] * (double)((InpVolMode == VOL_REAL && volume[j] > 0) ? volume[j] : tick_volume[j]); if(gVpSrc[j] > gVpSrc[j + 1]) posS += flow; else if(gVpSrc[j] < gVpSrc[j + 1]) negS += flow; }
      gVpFast[0] = (negF == 0.0 ? 100.0 : posF == 0.0 ? 0.0 : 100.0 - 100.0 / (1.0 + posF / negF));
      gVpSlow[0] = (negS == 0.0 ? 100.0 : posS == 0.0 ? 0.0 : 100.0 - 100.0 / (1.0 + posS / negS));
      gVpMid[0] = CompressVP((gVpFast[0] + gVpSlow[0] + gVpFast[1] + gVpSlow[1]) * 0.25, 0.7) * 0.5 + 50.0;
      bool weak = (gOsc[0] >= InpObLevel && gOsc[0] < gOsc[1]), strong = (gOsc[0] <= InpOsLevel && gOsc[0] > gOsc[1]);
      gMeOb[0] = (weak ? gMeOb[1] + 1 : 0); gMeOs[0] = (strong ? gMeOs[1] + 1 : 0);
      OscBuf[0] = gOsc[0]; SigBuf[0] = gSig[0];
      OscClr[0] = (gOsc[0] >= InpObLevel ? 0 : gOsc[0] <= InpOsLevel ? 1 : InpAdaptiveColor ? (gOsc[0] >= 50.0 ? 2 : 3) : 4);
      DotUpBuf[0] = (InpSigDots && gOsc[0] > gSig[0] && gOsc[1] <= gSig[1] ? gSig[0] : EMPTY_VALUE);
      DotDnBuf[0] = (InpSigDots && gOsc[0] < gSig[0] && gOsc[1] >= gSig[1] ? gSig[0] : EMPTY_VALUE);
      VpBullBuf[0] = (InpVpShow ? MathMax(gVpMid[0], 50.0) : EMPTY_VALUE); VpBullBaseBuf[0] = (InpVpShow ? 50.0 : EMPTY_VALUE);
      VpBearBuf[0] = (InpVpShow ? MathMin(gVpMid[0], 50.0) : EMPTY_VALUE); VpBearBaseBuf[0] = (InpVpShow ? 50.0 : EMPTY_VALUE);
      return rates_total;
   }

   for(int i = bars - 1; i >= 0; --i)
   {
      gSrc[i] = PriceAt(i, InpDrmSrc, open, high, low, close);
      gVpSrc[i] = PriceAt(i, InpVpSrc, open, high, low, close);
      gHiBuf[i] = HighestN(gSrc, bars, i, InpDrmLen);
      gLoBuf[i] = LowestN(gSrc, bars, i, InpDrmLen);
   }
   for(int i = bars - 1; i >= 0; --i)
   {
      double delta = (i == bars - 1 ? 0.0 : gSrc[i] - gSrc[i + 1]);
      double hiPrev = (i == bars - 1 ? gHiBuf[i] : gHiBuf[i + 1]);
      double loPrev = (i == bars - 1 ? gLoBuf[i] : gLoBuf[i + 1]);
      gForce[i] = (gHiBuf[i] > hiPrev ? gHiBuf[i] - gLoBuf[i] : gLoBuf[i] < loPrev ? -(gHiBuf[i] - gLoBuf[i]) : delta);
      gAbsForce[i] = MathAbs(gForce[i]);
   }
   SmoothSeries(gForce, bars, InpDrmLen, InpDrmMethod, gSUp);
   SmoothSeries(gAbsForce, bars, InpDrmLen, InpDrmMethod, gSAbs);
   for(int i = bars - 1; i >= 0; --i) gOsc[i] = (gSAbs[i] != 0.0 ? (gSUp[i] / gSAbs[i]) * 50.0 + 50.0 : 50.0);
   SmoothSeries(gOsc, bars, InpSigLen, InpSigMethod, gSig);

   int fastLen = MathMax((int)MathRound((double)InpDrmLen / 1.33), 2), slowLen = MathMax((int)MathRound((double)InpDrmLen * 1.33), 2);
   for(int i = bars - 1; i >= 0; --i)
   {
      double posF = 0.0, negF = 0.0, posS = 0.0, negS = 0.0;
      for(int j = i; j <= MathMin(bars - 2, i + fastLen - 1); ++j) { double flow = gVpSrc[j] * (double)((InpVolMode == VOL_REAL && volume[j] > 0) ? volume[j] : tick_volume[j]); if(gVpSrc[j] > gVpSrc[j + 1]) posF += flow; else if(gVpSrc[j] < gVpSrc[j + 1]) negF += flow; }
      for(int j = i; j <= MathMin(bars - 2, i + slowLen - 1); ++j) { double flow = gVpSrc[j] * (double)((InpVolMode == VOL_REAL && volume[j] > 0) ? volume[j] : tick_volume[j]); if(gVpSrc[j] > gVpSrc[j + 1]) posS += flow; else if(gVpSrc[j] < gVpSrc[j + 1]) negS += flow; }
      gVpFast[i] = (negF == 0.0 ? 100.0 : posF == 0.0 ? 0.0 : 100.0 - 100.0 / (1.0 + posF / negF));
      gVpSlow[i] = (negS == 0.0 ? 100.0 : posS == 0.0 ? 0.0 : 100.0 - 100.0 / (1.0 + posS / negS));
      double mix0 = 0.5 * (gVpFast[i] + gVpSlow[i]);
      double mix1 = (i == bars - 1 ? mix0 : 0.5 * (gVpFast[i + 1] + gVpSlow[i + 1]));
      gVpMid[i] = CompressVP((mix0 + mix1) * 0.5, 0.7) * 0.5 + 50.0;
   }
   for(int i = bars - 1; i >= 0; --i)
   {
      bool weak = (i < bars - 1 && gOsc[i] >= InpObLevel && gOsc[i] < gOsc[i + 1]);
      bool strong = (i < bars - 1 && gOsc[i] <= InpOsLevel && gOsc[i] > gOsc[i + 1]);
      gMeOb[i] = (weak ? (i == bars - 1 ? 1 : gMeOb[i + 1] + 1) : 0);
      gMeOs[i] = (strong ? (i == bars - 1 ? 1 : gMeOs[i + 1] + 1) : 0);
      OscBuf[i] = gOsc[i];
      SigBuf[i] = gSig[i];
      OscClr[i] = (gOsc[i] >= InpObLevel ? 0 : gOsc[i] <= InpOsLevel ? 1 : InpAdaptiveColor ? (gOsc[i] >= 50.0 ? 2 : 3) : 4);
      bool crossUp = (i < bars - 1 && gOsc[i] > gSig[i] && gOsc[i + 1] <= gSig[i + 1]);
      bool crossDn = (i < bars - 1 && gOsc[i] < gSig[i] && gOsc[i + 1] >= gSig[i + 1]);
      DotUpBuf[i] = (InpSigDots && crossUp ? gSig[i] : EMPTY_VALUE);
      DotDnBuf[i] = (InpSigDots && crossDn ? gSig[i] : EMPTY_VALUE);
      VpBullBuf[i] = (InpVpShow ? MathMax(gVpMid[i], 50.0) : EMPTY_VALUE);
      VpBullBaseBuf[i] = (InpVpShow ? 50.0 : EMPTY_VALUE);
      VpBearBuf[i] = (InpVpShow ? MathMin(gVpMid[i], 50.0) : EMPTY_VALUE);
      VpBearBaseBuf[i] = (InpVpShow ? 50.0 : EMPTY_VALUE);
   }
   gLastBar = time[0];
   if(newBar && prev_calculated > 0)
   {
      RenderSignals(time, high, low, gOsc, gVpMid, gMeOb, gMeOs, bars);
      FireAlerts(time, gOsc, gSig, gVpMid, bars);
   }
   else if(prev_calculated == 0) RenderSignals(time, high, low, gOsc, gVpMid, gMeOb, gMeOs, bars);
   return rates_total;
}
