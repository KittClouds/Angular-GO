
#property strict
#property indicator_chart_window
#property indicator_plots   2
#property indicator_buffers 7

#property indicator_type1   DRAW_COLOR_LINE
#property indicator_label1  "ML Supertrend"
#property indicator_width1  2
#property indicator_color1  clrLime, clrTomato

#property indicator_type2   DRAW_COLOR_CANDLES
#property indicator_label2  "Gradient Candles"
#property indicator_color2  clrLime, clrTomato

enum ENUM_DASHBOARD_POS
{
   DASH_TOP_RIGHT = 0,
   DASH_BOTTOM_RIGHT = 1,
   DASH_BOTTOM_LEFT = 2
};

enum ENUM_DASHBOARD_SIZE
{
   DASH_TINY = 0,
   DASH_SMALL = 1,
   DASH_NORMAL = 2,
   DASH_LARGE = 3,
   DASH_HUGE = 4
};

input string CommentML = "======== Machine Learning Settings ========";
input int neighborsK = 10;
input int windowSize = 500;

input string CommentST = "======== Supertrend Settings ========";
input int atrLenInput = 10;
input double factorInput = 3.0;

input string CommentNF = "======== Noise Filter Settings ========";
input bool smoothSource = true;
input int smoothLenVal = 10;
input double mlBuffer = 5.0;

input string CommentSIG = "======== Rejection Signal Settings ========";
input bool showBubbles = true;
input double rejMult = 1.5;
input int bubbleGap = 5;

input string CommentVIS = "======== Visual Settings ========";
input color bullColInput = (color)0x819908;
input color bearColInput = (color)0x4536F2;
input int smoothLen = 20;
input double vibrancy = 1.5;
input bool colorCandles = true;

input string CommentDB = "======== Dashboard Settings ========";
input bool showDashboard = true;
input ENUM_DASHBOARD_POS dashboardPos = DASH_TOP_RIGHT;
input ENUM_DASHBOARD_SIZE dashboardSize = DASH_SMALL;

input string CommentPERF = "======== Performance Settings ========";
input bool calculateOnClosedBarsOnly = true;
input bool renderBubblesInTester = false;
input bool renderDashboardInTester = false;
input int historyBarsToProcess = 900;
input int bubbleBarsToRender = 120;

double g_supertrendBuffer[];
double g_supertrendColorIdx[];
double g_candleOpen[];
double g_candleHigh[];
double g_candleLow[];
double g_candleClose[];
double g_candleColorIdx[];

string g_prefix = "";
const int MAX_CALC_BARS = 2200;
const int MAX_RENDER_BARS = 220;
datetime g_lastCalcBarTime = 0;
int g_lastCalcRatesTotal = 0;
int g_lastBubbleStart = -1;
int g_lastBubbleEnd = -1;

struct SDashboardState
{
   bool bullish;
   double probability;
   int barsInTrend;
   double stDistancePct;
   double relVolPct;
};

color RGBx(const int r, const int g, const int b)
{
   return (color)(r | (g << 8) | (b << 16));
}

int ClampInt(const int value, const int minValue, const int maxValue)
{
   return MathMax(minValue, MathMin(maxValue, value));
}

double ClampDouble(const double value, const double minValue, const double maxValue)
{
   return MathMax(minValue, MathMin(maxValue, value));
}

color BlendColor(const color c1, const color c2, const double tRaw)
{
   double t = ClampDouble(tRaw, 0.0, 1.0);
   int r1 = (int)(c1 & 0xFF), g1 = (int)((c1 >> 8) & 0xFF), b1 = (int)((c1 >> 16) & 0xFF);
   int r2 = (int)(c2 & 0xFF), g2 = (int)((c2 >> 8) & 0xFF), b2 = (int)((c2 >> 16) & 0xFF);
   return RGBx((int)MathRound(r1 + (r2 - r1) * t),
               (int)MathRound(g1 + (g2 - g1) * t),
               (int)MathRound(b1 + (b2 - b1) * t));
}

int DashboardCorner()
{
   if(dashboardPos == DASH_BOTTOM_RIGHT) return CORNER_RIGHT_LOWER;
   if(dashboardPos == DASH_BOTTOM_LEFT) return CORNER_LEFT_LOWER;
   return CORNER_RIGHT_UPPER;
}

int DashboardFontSize()
{
   if(dashboardSize == DASH_TINY) return 8;
   if(dashboardSize == DASH_NORMAL) return 11;
   if(dashboardSize == DASH_LARGE) return 13;
   if(dashboardSize == DASH_HUGE) return 15;
   return 9;
}

void ConfigurePlots()
{
   PlotIndexSetInteger(0, PLOT_COLOR_INDEXES, 2);
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 0, bullColInput);
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 1, bearColInput);
   PlotIndexSetDouble(0, PLOT_EMPTY_VALUE, EMPTY_VALUE);

   PlotIndexSetInteger(1, PLOT_COLOR_INDEXES, 64);
   for(int i = 0; i < 32; ++i)
   {
      double t = MathPow((double)i / 31.0, 1.0 / MathMax(vibrancy, 1.0));
      PlotIndexSetInteger(1, PLOT_LINE_COLOR, i, BlendColor(RGBx(230, 245, 236), bullColInput, t));
      PlotIndexSetInteger(1, PLOT_LINE_COLOR, 32 + i, BlendColor(RGBx(250, 233, 235), bearColInput, t));
   }
   PlotIndexSetDouble(1, PLOT_EMPTY_VALUE, EMPTY_VALUE);
}

void DeletePrefixedObjects(const string stem)
{
   for(int i = ObjectsTotal(0, 0, -1) - 1; i >= 0; --i)
   {
      string name = ObjectName(0, i, 0, -1);
      if(StringFind(name, stem) == 0) ObjectDelete(0, name);
   }
}

bool IsTesterMode()
{
   return ((bool)MQLInfoInteger(MQL_TESTER) || (bool)MQLInfoInteger(MQL_OPTIMIZATION));
}

bool ShouldRenderBubbleObjects()
{
   return (showBubbles && (!IsTesterMode() || renderBubblesInTester));
}

bool ShouldRenderDashboardObjects()
{
   return (showDashboard && (!IsTesterMode() || renderDashboardInTester));
}

double WMALast(const double &data[], const int endIndex, const int period)
{
   if(period <= 0 || endIndex < period - 1) return EMPTY_VALUE;
   double weighted = 0.0, weightSum = 0.0;
   for(int i = 0; i < period; ++i)
   {
      double v = data[endIndex - period + 1 + i];
      if(v == EMPTY_VALUE) return EMPTY_VALUE;
      int w = i + 1;
      weighted += v * w;
      weightSum += w;
   }
   return (weightSum == 0.0 ? EMPTY_VALUE : weighted / weightSum);
}

void ComputeHMA(const double &srcData[], const int total, const int period, double &out[])
{
   ArrayResize(out, total);
   ArrayInitialize(out, EMPTY_VALUE);
   if(period <= 1)
   {
      for(int i = 0; i < total; ++i) out[i] = srcData[i];
      return;
   }

   int half = MathMax(1, period / 2);
   int root = MathMax(1, (int)MathRound(MathSqrt(period)));
   double diff[];
   ArrayResize(diff, total);
   ArrayInitialize(diff, EMPTY_VALUE);

   for(int i = 0; i < total; ++i)
   {
      double shortWma = WMALast(srcData, i, half);
      double fullWma = WMALast(srcData, i, period);
      if(shortWma == EMPTY_VALUE || fullWma == EMPTY_VALUE) continue;
      diff[i] = 2.0 * shortWma - fullWma;
      out[i] = WMALast(diff, i, root);
   }
}

void ComputeATR(const double &highs[], const double &lows[], const double &closes[], const int total, const int period, double &out[])
{
   ArrayResize(out, total);
   ArrayInitialize(out, EMPTY_VALUE);
   if(total <= period) return;

   double trSum = 0.0;
   for(int i = 0; i < total; ++i)
   {
      double tr = (i == 0) ? (highs[i] - lows[i])
                           : MathMax(highs[i] - lows[i], MathMax(MathAbs(highs[i] - closes[i - 1]), MathAbs(lows[i] - closes[i - 1])));
      if(i < period)
      {
         trSum += tr;
         if(i == period - 1) out[i] = trSum / period;
      }
      else out[i] = ((out[i - 1] * (period - 1)) + tr) / period;
   }
}

void ComputeRSI(const double &src[], const int total, const int period, double &out[])
{
   ArrayResize(out, total);
   ArrayInitialize(out, EMPTY_VALUE);
   if(total <= period) return;

   double avgGain = 0.0, avgLoss = 0.0;
   for(int i = 1; i <= period; ++i)
   {
      if(src[i] == EMPTY_VALUE || src[i - 1] == EMPTY_VALUE) return;
      double change = src[i] - src[i - 1];
      avgGain += MathMax(change, 0.0);
      avgLoss += MathMax(-change, 0.0);
   }
   avgGain /= period;
   avgLoss /= period;
   out[period] = (avgLoss == 0.0 ? 100.0 : 100.0 - (100.0 / (1.0 + avgGain / avgLoss)));

   for(int i = period + 1; i < total; ++i)
   {
      if(src[i] == EMPTY_VALUE || src[i - 1] == EMPTY_VALUE) continue;
      double change = src[i] - src[i - 1];
      avgGain = ((avgGain * (period - 1)) + MathMax(change, 0.0)) / period;
      avgLoss = ((avgLoss * (period - 1)) + MathMax(-change, 0.0)) / period;
      out[i] = (avgLoss == 0.0 ? 100.0 : 100.0 - (100.0 / (1.0 + avgGain / avgLoss)));
   }
}

void ComputeEMA(const double &srcData[], const int total, const int period, const double seed, double &out[])
{
   ArrayResize(out, total);
   if(total <= 0) return;
   double alpha = 2.0 / (period + 1.0);
   out[0] = (srcData[0] == EMPTY_VALUE ? seed : srcData[0]);
   for(int i = 1; i < total; ++i)
   {
      double v = (srcData[i] == EMPTY_VALUE ? out[i - 1] : srcData[i]);
      out[i] = out[i - 1] + alpha * (v - out[i - 1]);
   }
}

void ComputeSupertrend(const double &highs[], const double &lows[], const double &closes[], const double &atrVals[], const int total, const double factor, double &stVals[], int &stDir[])
{
   ArrayResize(stVals, total);
   ArrayResize(stDir, total);
   ArrayInitialize(stVals, EMPTY_VALUE);

   double prevFinalUpper = 0.0, prevFinalLower = 0.0, prevSt = 0.0;
   bool seeded = false;
   for(int i = 0; i < total; ++i)
   {
      if(atrVals[i] == EMPTY_VALUE) continue;
      double hl2 = 0.5 * (highs[i] + lows[i]);
      double upper = hl2 + factor * atrVals[i];
      double lower = hl2 - factor * atrVals[i];

      if(!seeded)
      {
         prevFinalUpper = upper;
         prevFinalLower = lower;
         prevSt = upper;
         stVals[i] = prevSt;
         stDir[i] = 1;
         seeded = true;
         continue;
      }

      double finalUpper = (upper < prevFinalUpper || closes[i - 1] > prevFinalUpper) ? upper : prevFinalUpper;
      double finalLower = (lower > prevFinalLower || closes[i - 1] < prevFinalLower) ? lower : prevFinalLower;
      double currentSt = (prevSt == prevFinalUpper) ? ((closes[i] <= finalUpper) ? finalUpper : finalLower)
                                                    : ((closes[i] >= finalLower) ? finalLower : finalUpper);

      stVals[i] = currentSt;
      stDir[i] = (currentSt == finalLower ? -1 : 1);
      prevFinalUpper = finalUpper;
      prevFinalLower = finalLower;
      prevSt = currentSt;
   }
}

double ComputeKnnProbability(const int idx, const int k, const int window, const double &f1[], const double &f2[], const int &trendLabel[])
{
   if(idx <= window || k <= 0 || f1[idx] == EMPTY_VALUE || f2[idx] == EMPTY_VALUE) return 50.0;

   int kk = ClampInt(k, 1, 50);
   double bestDist[50];
   int bestVote[50];
   for(int i = 0; i < kk; ++i) { bestDist[i] = DBL_MAX; bestVote[i] = 0; }

   int start = MathMax(1, idx - window);
   for(int sample = idx - 1; sample >= start; --sample)
   {
      int labelIdx = sample - 1;
      if(labelIdx < 0 || f1[sample] == EMPTY_VALUE || f2[sample] == EMPTY_VALUE) continue;
      double d1 = f1[idx] - f1[sample];
      double d2 = f2[idx] - f2[sample];
      double dist = d1 * d1 + d2 * d2;

      int worst = 0;
      for(int j = 1; j < kk; ++j) if(bestDist[j] > bestDist[worst]) worst = j;
      if(dist < bestDist[worst]) { bestDist[worst] = dist; bestVote[worst] = trendLabel[labelIdx]; }
   }

   double bullVotes = 0.0, bearVotes = 0.0;
   for(int i = 0; i < kk; ++i)
   {
      if(bestDist[i] == DBL_MAX) continue;
      if(bestVote[i] > 0) bullVotes += 1.0; else bearVotes += 1.0;
   }
   return ((bullVotes + bearVotes) == 0.0 ? 50.0 : (bullVotes * 100.0) / (bullVotes + bearVotes));
}

int BubbleFontSizeAt(const long &volumesChrono[], const int idx)
{
   int start = MathMax(0, idx - 99);
   int count = idx - start + 1;
   double sum = 0.0, variance = 0.0;
   for(int i = start; i <= idx; ++i) sum += (double)volumesChrono[i];
   double mean = sum / count;
   for(int i = start; i <= idx; ++i) { double d = (double)volumesChrono[i] - mean; variance += d * d; }
   double stdDev = MathSqrt(variance / count);
   double zScore = (stdDev <= 0.0 ? 0.0 : (((double)volumesChrono[idx] - mean) / stdDev));
   return ClampInt((int)MathRound(14.0 + (zScore * 2.0)), 8, 30);
}

string FormatVolume(const long vol)
{
   double value = (double)vol;
   if(value >= 1000000000.0) return StringFormat("%.2fB", value / 1000000000.0);
   if(value >= 1000000.0) return StringFormat("%.2fM", value / 1000000.0);
   if(value >= 1000.0) return StringFormat("%.1fK", value / 1000.0);
   return StringFormat("%I64d", vol);
}

void EnsureTrendLine(const string name, const datetime t1, const double p1, const datetime t2, const double p2, const color clr)
{
   if(ObjectFind(0, name) < 0) ObjectCreate(0, name, OBJ_TREND, 0, t1, p1, t2, p2);
   ObjectMove(0, name, 0, t1, p1);
   ObjectMove(0, name, 1, t2, p2);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_STYLE, STYLE_DASH);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 1);
   ObjectSetInteger(0, name, OBJPROP_RAY_LEFT, false);
   ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
}

void EnsurePriceText(const string name, const datetime when, const double price, const string text, const color clr, const int fontSize, const ENUM_ANCHOR_POINT anchor)
{
   if(ObjectFind(0, name) < 0) ObjectCreate(0, name, OBJ_TEXT, 0, when, price);
   ObjectMove(0, name, 0, when, price);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetString(0, name, OBJPROP_FONT, "Arial Bold");
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, fontSize);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_ANCHOR, anchor);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
}

void DeleteBubbleObjectsForIndex(const int idx)
{
   ObjectDelete(0, g_prefix + "bubble_stem_" + IntegerToString(idx));
   ObjectDelete(0, g_prefix + "bubble_shadow_" + IntegerToString(idx));
   ObjectDelete(0, g_prefix + "bubble_core_" + IntegerToString(idx));
   ObjectDelete(0, g_prefix + "bubble_txt_" + IntegerToString(idx));
}

void RenderBubbles(const datetime &timesChrono[], const double &highsChrono[], const double &lowsChrono[], const long &volumesChrono[], const double &atrChrono[], const bool &bullRej[], const bool &bearRej[], const int total)
{
   if(!ShouldRenderBubbleObjects())
   {
      if(g_lastBubbleStart >= 0)
      {
         for(int i = g_lastBubbleStart; i <= g_lastBubbleEnd; ++i) DeleteBubbleObjectsForIndex(i);
      }
      g_lastBubbleStart = -1;
      g_lastBubbleEnd = -1;
      return;
   }

   int renderBars = ClampInt(bubbleBarsToRender, 0, MAX_RENDER_BARS);
   int start = MathMax(0, total - renderBars);
   if(g_lastBubbleStart >= 0 && start > g_lastBubbleStart)
   {
      for(int i = g_lastBubbleStart; i < start && i <= g_lastBubbleEnd; ++i) DeleteBubbleObjectsForIndex(i);
   }
   g_lastBubbleStart = start;
   g_lastBubbleEnd = total - 1;

   for(int i = start; i < total; ++i)
   {
      if(!bullRej[i] && !bearRej[i])
      {
         DeleteBubbleObjectsForIndex(i);
         continue;
      }
      bool isBull = bullRej[i];
      double atr = (atrChrono[i] == EMPTY_VALUE ? (highsChrono[i] - lowsChrono[i]) : atrChrono[i]);
      double stemOffset = atr * 1.5;
      double orbGap = atr * 0.05;
      double center = isBull ? (lowsChrono[i] - stemOffset) : (highsChrono[i] + stemOffset);
      color theme = isBull ? bullColInput : bearColInput;
      string stem = g_prefix + "bubble_stem_" + IntegerToString(i);
      string orb1 = g_prefix + "bubble_shadow_" + IntegerToString(i);
      string orb2 = g_prefix + "bubble_core_" + IntegerToString(i);
      string txt = g_prefix + "bubble_txt_" + IntegerToString(i);
      int bubbleFont = BubbleFontSizeAt(volumesChrono, i);

      EnsureTrendLine(stem, timesChrono[i], isBull ? lowsChrono[i] : highsChrono[i], timesChrono[i], center, BlendColor(theme, RGBx(255, 255, 255), 0.35));
      EnsurePriceText(orb1, timesChrono[i], center - (orbGap * 1.5), "O", RGBx(20, 20, 20), bubbleFont + 4, ANCHOR_CENTER);
      EnsurePriceText(orb2, timesChrono[i], center, "O", theme, bubbleFont + 2, ANCHOR_CENTER);
      EnsurePriceText(txt, timesChrono[i], center + (isBull ? (-orbGap * 8.0) : (orbGap * 8.0)), FormatVolume(volumesChrono[i]), RGBx(255, 255, 255), 9, isBull ? ANCHOR_LOWER : ANCHOR_UPPER);
   }
}

void RenderDashboard(const SDashboardState &state)
{
   string bg = g_prefix + "dashboard_bg";
   string txt = g_prefix + "dashboard_txt";
   if(!ShouldRenderDashboardObjects())
   {
      ObjectDelete(0, bg);
      ObjectDelete(0, txt);
      return;
   }

   int corner = DashboardCorner();
   int fontSize = DashboardFontSize();
   int x = 18, y = 18;
   int w = 240 + fontSize * 3;
   int h = 112 + fontSize * 3;

   if(ObjectFind(0, bg) < 0) ObjectCreate(0, bg, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, bg, OBJPROP_CORNER, corner);
   ObjectSetInteger(0, bg, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, bg, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, bg, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, bg, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, bg, OBJPROP_BGCOLOR, RGBx(22, 22, 22));
   ObjectSetInteger(0, bg, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, bg, OBJPROP_COLOR, RGBx(46, 46, 46));
   ObjectSetInteger(0, bg, OBJPROP_HIDDEN, true);

   if(ObjectFind(0, txt) < 0) ObjectCreate(0, txt, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, txt, OBJPROP_CORNER, corner);
   ObjectSetInteger(0, txt, OBJPROP_XDISTANCE, x + 10);
   ObjectSetInteger(0, txt, OBJPROP_YDISTANCE, y + 8);
   ObjectSetInteger(0, txt, OBJPROP_FONTSIZE, fontSize);
   ObjectSetInteger(0, txt, OBJPROP_COLOR, RGBx(219, 219, 219));
   ObjectSetString(0, txt, OBJPROP_FONT, "Consolas");
   ObjectSetInteger(0, txt, OBJPROP_HIDDEN, true);
   ObjectSetString(0, txt, OBJPROP_TEXT,
      "KNN Supertrend Horizon [LuxAlgo]\n" +
      "-------------------------------\n" +
      "Trend Direction : " + (state.bullish ? "Bullish" : "Bearish") + "\n" +
      "ML Confidence   : " + DoubleToString(state.probability, 1) + "%\n" +
      "Bars In Trend   : " + IntegerToString(state.barsInTrend) + "\n" +
      "ST Distance     : " + DoubleToString(state.stDistancePct, 2) + "%\n" +
      "Rel. Volatility : " + DoubleToString(state.relVolPct, 2) + "%");
}

int OnInit()
{
   SetIndexBuffer(0, g_supertrendBuffer, INDICATOR_DATA);
   SetIndexBuffer(1, g_supertrendColorIdx, INDICATOR_COLOR_INDEX);
   SetIndexBuffer(2, g_candleOpen, INDICATOR_DATA);
   SetIndexBuffer(3, g_candleHigh, INDICATOR_DATA);
   SetIndexBuffer(4, g_candleLow, INDICATOR_DATA);
   SetIndexBuffer(5, g_candleClose, INDICATOR_DATA);
   SetIndexBuffer(6, g_candleColorIdx, INDICATOR_COLOR_INDEX);

   ArraySetAsSeries(g_supertrendBuffer, true);
   ArraySetAsSeries(g_supertrendColorIdx, true);
   ArraySetAsSeries(g_candleOpen, true);
   ArraySetAsSeries(g_candleHigh, true);
   ArraySetAsSeries(g_candleLow, true);
   ArraySetAsSeries(g_candleClose, true);
   ArraySetAsSeries(g_candleColorIdx, true);

   IndicatorSetString(INDICATOR_SHORTNAME, "KNN Supertrend Horizon [MQL5]");
   ConfigurePlots();
   g_prefix = "KNNST_" + IntegerToString((int)ChartID()) + "_";
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   DeletePrefixedObjects(g_prefix);
}

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[], const double &high[], const double &low[], const double &close[], const long &tick_volume[], const long &volume[], const int &spread[])
{
   int minBars = MathMax(windowSize + 5, 120);
   if(rates_total < minBars) return rates_total;

   if(calculateOnClosedBarsOnly && prev_calculated > 0 && g_lastCalcRatesTotal == rates_total && g_lastCalcBarTime == time[0])
      return rates_total;

   if(prev_calculated == 0)
   {
      ArrayInitialize(g_supertrendBuffer, EMPTY_VALUE);
      ArrayInitialize(g_supertrendColorIdx, 0.0);
      ArrayInitialize(g_candleOpen, EMPTY_VALUE);
      ArrayInitialize(g_candleHigh, EMPTY_VALUE);
      ArrayInitialize(g_candleLow, EMPTY_VALUE);
      ArrayInitialize(g_candleClose, EMPTY_VALUE);
      ArrayInitialize(g_candleColorIdx, 0.0);
   }

   int desiredBars = MathMax(windowSize + 80, historyBarsToProcess);
   int calcBars = MathMin(rates_total, MathMin(MAX_CALC_BARS, desiredBars));
   datetime timesChrono[];
   double openChrono[], highChrono[], lowChrono[], closeChrono[];
   long volChrono[];
   ArrayResize(timesChrono, calcBars);
   ArrayResize(openChrono, calcBars);
   ArrayResize(highChrono, calcBars);
   ArrayResize(lowChrono, calcBars);
   ArrayResize(closeChrono, calcBars);
   ArrayResize(volChrono, calcBars);

   for(int i = 0; i < calcBars; ++i)
   {
      int s = calcBars - 1 - i;
      timesChrono[i] = time[s];
      openChrono[i] = open[s];
      highChrono[i] = high[s];
      lowChrono[i] = low[s];
      closeChrono[i] = close[s];
      volChrono[i] = (tick_volume[s] > 0 ? tick_volume[s] : volume[s]);
   }

   double srcChrono[];
   if(smoothSource) ComputeHMA(closeChrono, calcBars, smoothLenVal, srcChrono);
   else
   {
      ArrayResize(srcChrono, calcBars);
      for(int i = 0; i < calcBars; ++i) srcChrono[i] = closeChrono[i];
   }

   double atr14Chrono[], atrStChrono[], rsiChrono[], stChrono[], f2Chrono[], mlProbChrono[], smoothedProbChrono[];
   int stDirChrono[], trendLabelChrono[], barsInTrendChrono[];
   bool mlBullChrono[], bullRejChrono[], bearRejChrono[];

   ComputeATR(highChrono, lowChrono, closeChrono, calcBars, 14, atr14Chrono);
   ComputeATR(highChrono, lowChrono, closeChrono, calcBars, atrLenInput, atrStChrono);
   ComputeRSI(srcChrono, calcBars, 14, rsiChrono);
   ComputeSupertrend(highChrono, lowChrono, closeChrono, atrStChrono, calcBars, factorInput, stChrono, stDirChrono);

   ArrayResize(f2Chrono, calcBars);
   ArrayResize(trendLabelChrono, calcBars);
   ArrayResize(mlProbChrono, calcBars);
   for(int i = 0; i < calcBars; ++i)
   {
      f2Chrono[i] = (srcChrono[i] == 0.0 || atr14Chrono[i] == EMPTY_VALUE) ? EMPTY_VALUE : (atr14Chrono[i] / srcChrono[i]) * 100.0;
      trendLabelChrono[i] = (stChrono[i] == EMPTY_VALUE ? 0 : (stDirChrono[i] < 0 ? 1 : -1));
      mlProbChrono[i] = ComputeKnnProbability(i, neighborsK, windowSize, rsiChrono, f2Chrono, trendLabelChrono);
   }

   ComputeEMA(mlProbChrono, calcBars, smoothLen, 50.0, smoothedProbChrono);
   ArrayResize(mlBullChrono, calcBars);
   ArrayResize(barsInTrendChrono, calcBars);
   bool currentBull = false;
   for(int i = 0; i < calcBars; ++i)
   {
      double prob = smoothedProbChrono[i];
      if(prob > 50.0 + mlBuffer) currentBull = true;
      else if(prob < 50.0 - mlBuffer) currentBull = false;
      mlBullChrono[i] = currentBull;
      barsInTrendChrono[i] = (i == 0 || mlBullChrono[i] != mlBullChrono[i - 1]) ? 0 : (barsInTrendChrono[i - 1] + 1);
   }

   ArrayResize(bullRejChrono, calcBars);
   ArrayResize(bearRejChrono, calcBars);
   for(int i = 0; i < calcBars; ++i) { bullRejChrono[i] = false; bearRejChrono[i] = false; }
   int lastBubbleIndex = -bubbleGap;
   for(int i = 0; i < calcBars; ++i)
   {
      if(stChrono[i] == EMPTY_VALUE) continue;
      double body = MathAbs(closeChrono[i] - openChrono[i]);
      double upperWick = highChrono[i] - MathMax(openChrono[i], closeChrono[i]);
      double lowerWick = MathMin(openChrono[i], closeChrono[i]) - lowChrono[i];
      bool canPlace = (i - lastBubbleIndex >= bubbleGap);
      bool bearRej = (!mlBullChrono[i] && highChrono[i] > stChrono[i] && closeChrono[i] < stChrono[i] && upperWick > body * rejMult && canPlace);
      bool bullRej = (mlBullChrono[i] && lowChrono[i] < stChrono[i] && closeChrono[i] > stChrono[i] && lowerWick > body * rejMult && canPlace);
      if(bullRej || bearRej) lastBubbleIndex = i;
      bullRejChrono[i] = bullRej;
      bearRejChrono[i] = bearRej;
   }

   for(int i = 0; i < calcBars; ++i)
   {
      int s = calcBars - 1 - i;
      if(stChrono[i] != EMPTY_VALUE)
      {
         g_supertrendBuffer[s] = stChrono[i];
         g_supertrendColorIdx[s] = (mlBullChrono[i] ? 0.0 : 1.0);
      }

      if(colorCandles && stChrono[i] != EMPTY_VALUE)
      {
         double intensity = mlBullChrono[i] ? ((smoothedProbChrono[i] - 50.0) * 2.0) : ((50.0 - smoothedProbChrono[i]) * 2.0);
         double glowPower = MathPow(ClampDouble(intensity, 0.0, 100.0) / 100.0, vibrancy) * 100.0;
         int tone = ClampInt((int)MathRound((glowPower / 100.0) * 31.0), 0, 31);
         g_candleOpen[s] = openChrono[i];
         g_candleHigh[s] = highChrono[i];
         g_candleLow[s] = lowChrono[i];
         g_candleClose[s] = closeChrono[i];
         g_candleColorIdx[s] = (double)(mlBullChrono[i] ? tone : (32 + tone));
      }
   }

   RenderBubbles(timesChrono, highChrono, lowChrono, volChrono, atr14Chrono, bullRejChrono, bearRejChrono, calcBars);

   SDashboardState state;
   int last = calcBars - 1;
   state.bullish = mlBullChrono[last];
   state.probability = smoothedProbChrono[last];
   state.barsInTrend = barsInTrendChrono[last];
   state.stDistancePct = (closeChrono[last] == 0.0 || stChrono[last] == EMPTY_VALUE) ? 0.0 : (MathAbs(closeChrono[last] - stChrono[last]) / closeChrono[last]) * 100.0;
   state.relVolPct = (f2Chrono[last] == EMPTY_VALUE ? 0.0 : f2Chrono[last]);
   RenderDashboard(state);

   g_lastCalcRatesTotal = rates_total;
   g_lastCalcBarTime = time[0];

   bool needsObjectRedraw = ShouldRenderBubbleObjects() || ShouldRenderDashboardObjects();
   if(!IsTesterMode() || needsObjectRedraw) ChartRedraw(0);
   return rates_total;
}
