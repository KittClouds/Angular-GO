//+------------------------------------------------------------------+
//| Machine Learning RSI | BullVision - compact MQL5 port            |
//| Pine table/barcolor layer omitted for MQL5 speed and simplicity  |
//+------------------------------------------------------------------+
#property strict
#property indicator_separate_window
#property indicator_minimum 0
#property indicator_maximum 100
#property indicator_plots   4
#property indicator_buffers 7
#property indicator_label1  "ML RSI"
#property indicator_type1   DRAW_COLOR_LINE
#property indicator_width1  2
#property indicator_color1  clrLime,clrTomato,clrWhite,clrSilver
#property indicator_label2  "50 Level"
#property indicator_type2   DRAW_LINE
#property indicator_color2  clrSilver
#property indicator_width2  1
#property indicator_label3  "Bull Fill"
#property indicator_type3   DRAW_FILLING
#property indicator_color3  clrLime
#property indicator_label4  "Bear Fill"
#property indicator_type4   DRAW_FILLING
#property indicator_color4  clrTomato

enum ENUM_MA_MODE { MA_SMA, MA_EMA, MA_DEMA, MA_TEMA, MA_WMA, MA_VWMA, MA_SMMA, MA_HMA, MA_LSMA, MA_ALMA };
enum ENUM_FILTER_MODE { FILTER_NONE, FILTER_KALMAN, FILTER_DOUBLEEMA, FILTER_ALMA };
enum ENUM_COLOR_SCHEME { SCHEME_CLASSIC, SCHEME_DEUTERANOPIA, SCHEME_PROTANOPIA, SCHEME_TRITANOPIA, SCHEME_MONOCHROME };
enum ENUM_COLOR_MODE { COLOR_NONE, COLOR_TREND, COLOR_IMPULSE };

input int               InpRsiLength      = 14;
input bool              InpUseSmoothing   = true;
input int               InpSmoothLength   = 3;
input ENUM_MA_MODE      InpMaType         = MA_ALMA;
input int               InpAlmaSigma      = 4;
input int               InpOverbought     = 70;
input int               InpOversold       = 30;
input bool              InpUseKnn         = true;
input int               InpKnnNeighbors   = 5;
input int               InpKnnLookback    = 100;
input double            InpKnnWeight      = 0.4;
input int               InpFeatureCount   = 3;
input bool              InpUseFilter      = true;
input ENUM_FILTER_MODE  InpFilterMethod   = FILTER_KALMAN;
input double            InpFilterStrength = 0.3;
input bool              InpNeonEffect     = true;
input ENUM_COLOR_SCHEME InpColorScheme    = SCHEME_CLASSIC;
input ENUM_COLOR_MODE   InpColorMode      = COLOR_TREND;
input int               InpHistoryBars    = 320;

double RsiBuf[], ClrBuf[], MidBuf[], BullTopBuf[], BullBaseBuf[], BearTopBuf[], BearBaseBuf[];
double gGain[], gLoss[], gAvgGain[], gAvgLoss[], gBaseRsi[], gStdRsi[], gMlRsi[], gFinalRsi[];
double gMa1[], gMa2[], gMa3[], gFilt1[], gFilt2[], gMom[], gVol[], gSlope[], gPriceMom[], gNRsi[], gNMom[], gNVol[], gNSlope[], gNPrice[];
color gBull = clrLime, gBear = clrTomato;
datetime gLastBar = 0;
const int MAX_K = 50;

bool IsTesterMode() { return ((bool)MQLInfoInteger(MQL_TESTER) || (bool)MQLInfoInteger(MQL_OPTIMIZATION)); }
double Clamp01(const double v) { return MathMax(0.0, MathMin(1.0, v)); }
double Clamp100(const double v) { return MathMax(0.0, MathMin(100.0, v)); }

void ApplyPalette()
{
   switch(InpColorScheme)
   {
      case SCHEME_CLASSIC:      gBull = (InpNeonEffect ? C'0,255,187' : C'0,183,18');   gBear = (InpNeonEffect ? C'255,17,0' : C'195,0,16'); break;
      case SCHEME_DEUTERANOPIA: gBull = C'0,170,255';   gBear = C'255,204,0'; break;
      case SCHEME_PROTANOPIA:   gBull = C'0,170,230';   gBear = C'230,175,0'; break;
      case SCHEME_TRITANOPIA:   gBull = C'255,112,0';   gBear = C'0,33,171';  break;
      default:                  gBull = C'222,226,230'; gBear = C'73,80,87';   break;
   }
   PlotIndexSetInteger(0, PLOT_COLOR_INDEXES, 4);
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 0, gBull);
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 1, gBear);
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 2, clrWhite);
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 3, clrSilver);
   PlotIndexSetInteger(2, PLOT_LINE_COLOR, 0, gBull);
   PlotIndexSetInteger(3, PLOT_LINE_COLOR, 0, gBear);
}

void EnsureSize(const int bars)
{
   if(ArraySize(gBaseRsi) == bars) return;
   ArrayResize(gGain, bars); ArraySetAsSeries(gGain, true); ArrayResize(gLoss, bars); ArraySetAsSeries(gLoss, true);
   ArrayResize(gAvgGain, bars); ArraySetAsSeries(gAvgGain, true); ArrayResize(gAvgLoss, bars); ArraySetAsSeries(gAvgLoss, true);
   ArrayResize(gBaseRsi, bars); ArraySetAsSeries(gBaseRsi, true); ArrayResize(gStdRsi, bars); ArraySetAsSeries(gStdRsi, true);
   ArrayResize(gMlRsi, bars); ArraySetAsSeries(gMlRsi, true); ArrayResize(gFinalRsi, bars); ArraySetAsSeries(gFinalRsi, true);
   ArrayResize(gMa1, bars); ArraySetAsSeries(gMa1, true); ArrayResize(gMa2, bars); ArraySetAsSeries(gMa2, true); ArrayResize(gMa3, bars); ArraySetAsSeries(gMa3, true);
   ArrayResize(gFilt1, bars); ArraySetAsSeries(gFilt1, true); ArrayResize(gFilt2, bars); ArraySetAsSeries(gFilt2, true);
   ArrayResize(gMom, bars); ArraySetAsSeries(gMom, true); ArrayResize(gVol, bars); ArraySetAsSeries(gVol, true);
   ArrayResize(gSlope, bars); ArraySetAsSeries(gSlope, true); ArrayResize(gPriceMom, bars); ArraySetAsSeries(gPriceMom, true);
   ArrayResize(gNRsi, bars); ArraySetAsSeries(gNRsi, true); ArrayResize(gNMom, bars); ArraySetAsSeries(gNMom, true);
   ArrayResize(gNVol, bars); ArraySetAsSeries(gNVol, true); ArrayResize(gNSlope, bars); ArraySetAsSeries(gNSlope, true); ArrayResize(gNPrice, bars); ArraySetAsSeries(gNPrice, true);
}

double HighestN(const double &a[], const int total, const int i, const int n) { double v = a[i]; int end = MathMin(total - 1, i + MathMax(n - 1, 0)); for(int j = i + 1; j <= end; ++j) if(a[j] > v) v = a[j]; return v; }
double LowestN(const double &a[], const int total, const int i, const int n) { double v = a[i]; int end = MathMin(total - 1, i + MathMax(n - 1, 0)); for(int j = i + 1; j <= end; ++j) if(a[j] < v) v = a[j]; return v; }
double NormalizeAt(const double &a[], const int total, const int i, const int n) { double hi = HighestN(a, total, i, n), lo = LowestN(a, total, i, n), span = hi - lo; return (span != 0.0 ? Clamp01((a[i] - lo) / span) : 0.5); }

double StdDevAt(const double &a[], const int total, const int i, const int n)
{
   int end = MathMin(total - 1, i + MathMax(n - 1, 0)), count = 0; double mean = 0.0, var = 0.0;
   for(int j = i; j <= end; ++j) { mean += a[j]; count++; }
   if(count <= 1) return 0.0;
   mean /= count;
   for(int j = i; j <= end; ++j) { double d = a[j] - mean; var += d * d; }
   return MathSqrt(var / count);
}

void LinRegAt(const double &a[], const int total, const int i, const int n, double &slope, double &endpoint)
{
   int count = MathMin(n, total - i); if(count <= 1) { slope = 0.0; endpoint = a[i]; return; }
   double sx = 0.0, sy = 0.0, sxx = 0.0, sxy = 0.0;
   for(int k = 0; k < count; ++k) { double x = k, y = a[i + count - 1 - k]; sx += x; sy += y; sxx += x * x; sxy += x * y; }
   double den = count * sxx - sx * sx; slope = (den != 0.0 ? (count * sxy - sx * sy) / den : 0.0); endpoint = (sy - slope * sx) / count + slope * (count - 1);
}

double WmaAt(const double &a[], const int total, const int i, const int n)
{
   int count = MathMin(n, total - i); double sum = 0.0, norm = 0.0;
   for(int k = 0; k < count; ++k) { double w = count - k; sum += a[i + k] * w; norm += w; }
   return (norm != 0.0 ? sum / norm : a[i]);
}

double VwmaAt(const double &a[], const long &tick_volume[], const long &volume[], const int total, const int i, const int n)
{
   int count = MathMin(n, total - i); double num = 0.0, den = 0.0;
   for(int k = 0; k < count; ++k) { double v = (double)((volume[i + k] > 0) ? volume[i + k] : tick_volume[i + k]); num += a[i + k] * v; den += v; }
   return (den != 0.0 ? num / den : a[i]);
}

double AlmaAt(const double &a[], const int total, const int i, const int n, const double offset, const double sigma)
{
   int count = MathMin(n, total - i); if(count <= 1) return a[i];
   double m = offset * (count - 1), s = count / MathMax(sigma, 1.0), sum = 0.0, norm = 0.0;
   for(int k = 0; k < count; ++k) { double pos = count - 1 - k, w = MathExp(-((pos - m) * (pos - m)) / (2.0 * s * s)); sum += a[i + k] * w; norm += w; }
   return (norm != 0.0 ? sum / norm : a[i]);
}

void EmaFull(const double &src[], const int total, const int len, const double alpha, double &out[]) { for(int i = total - 1; i >= 0; --i) out[i] = (i == total - 1 ? src[i] : alpha * src[i] + (1.0 - alpha) * out[i + 1]); }

void ApplyMAFull(const double &src[], const long &tick_volume[], const long &volume[], const int total, const int len, const ENUM_MA_MODE mode, const int sigma, double &out[])
{
   if(len <= 1) { for(int i = 0; i < total; ++i) out[i] = src[i]; return; }
   if(mode == MA_EMA || mode == MA_SMMA) { EmaFull(src, total, len, (mode == MA_EMA ? 2.0 / (len + 1.0) : 1.0 / len), out); return; }
   if(mode == MA_DEMA || mode == MA_TEMA) { EmaFull(src, total, len, 2.0 / (len + 1.0), gMa1); EmaFull(gMa1, total, len, 2.0 / (len + 1.0), gMa2); if(mode == MA_DEMA) { for(int i = 0; i < total; ++i) out[i] = 2.0 * gMa1[i] - gMa2[i]; return; } EmaFull(gMa2, total, len, 2.0 / (len + 1.0), gMa3); for(int i = 0; i < total; ++i) out[i] = 3.0 * (gMa1[i] - gMa2[i]) + gMa3[i]; return; }
   if(mode == MA_HMA) { int half = MathMax(1, len / 2), root = MathMax(1, (int)MathRound(MathSqrt(len))); for(int i = total - 1; i >= 0; --i) gMa1[i] = 2.0 * WmaAt(src, total, i, half) - WmaAt(src, total, i, len); for(int i = total - 1; i >= 0; --i) out[i] = WmaAt(gMa1, total, i, root); return; }
   for(int i = total - 1; i >= 0; --i)
   {
      if(mode == MA_SMA) { double sum = 0.0; int count = MathMin(len, total - i); for(int k = 0; k < count; ++k) sum += src[i + k]; out[i] = sum / count; }
      else if(mode == MA_WMA) out[i] = WmaAt(src, total, i, len);
      else if(mode == MA_VWMA) out[i] = VwmaAt(src, tick_volume, volume, total, i, len);
      else if(mode == MA_LSMA) { double slope = 0.0; LinRegAt(src, total, i, len, slope, out[i]); }
      else if(mode == MA_ALMA) out[i] = AlmaAt(src, total, i, len, 0.85, sigma);
   }
}

double MAPoint0(const double &src[], const long &tick_volume[], const long &volume[], const int total, const int len, const ENUM_MA_MODE mode, const int sigma, const double &prev[], const double &a1[], const double &a2[])
{
   if(len <= 1) return src[0];
   if(mode == MA_EMA || mode == MA_SMMA) { double alpha = (mode == MA_EMA ? 2.0 / (len + 1.0) : 1.0 / len); return alpha * src[0] + (1.0 - alpha) * prev[1]; }
   if(mode == MA_DEMA) { double alpha = 2.0 / (len + 1.0), e1 = alpha * src[0] + (1.0 - alpha) * a1[1], e2 = alpha * e1 + (1.0 - alpha) * a2[1]; gMa1[0] = e1; gMa2[0] = e2; return 2.0 * e1 - e2; }
   if(mode == MA_TEMA) { double alpha = 2.0 / (len + 1.0), e1 = alpha * src[0] + (1.0 - alpha) * a1[1], e2 = alpha * e1 + (1.0 - alpha) * a2[1], e3 = alpha * e2 + (1.0 - alpha) * gMa3[1]; gMa1[0] = e1; gMa2[0] = e2; gMa3[0] = e3; return 3.0 * (e1 - e2) + e3; }
   if(mode == MA_HMA) { int half = MathMax(1, len / 2), root = MathMax(1, (int)MathRound(MathSqrt(len))); for(int i = 0; i < MathMin(root, total); ++i) gMa1[i] = 2.0 * WmaAt(src, total, i, half) - WmaAt(src, total, i, len); return WmaAt(gMa1, total, 0, root); }
   if(mode == MA_WMA) return WmaAt(src, total, 0, len);
   if(mode == MA_VWMA) return VwmaAt(src, tick_volume, volume, total, 0, len);
   if(mode == MA_LSMA) { double slope = 0.0, endpoint = src[0]; LinRegAt(src, total, 0, len, slope, endpoint); return endpoint; }
   if(mode == MA_ALMA) return AlmaAt(src, total, 0, len, 0.85, sigma);
   double sum = 0.0; int count = MathMin(len, total); for(int i = 0; i < count; ++i) sum += src[i]; return sum / count;
}

double KNNPoint(const int idx, const int total)
{
   if(!InpUseKnn) return gStdRsi[idx];
   int feat = MathMax(1, MathMin(InpFeatureCount, 5));
   double mlWeight = MathMax(0.0, MathMin(InpKnnWeight, 1.0));
   int k = MathMax(1, MathMin(InpKnnNeighbors, MAX_K)), end = MathMin(total - 2, idx + InpKnnLookback), found = 0;
   int bestIdx[]; double bestDist[];
   ArrayResize(bestIdx, MAX_K); ArrayResize(bestDist, MAX_K);
   for(int m = 0; m < MAX_K; ++m) { bestDist[m] = 1.0e100; bestIdx[m] = -1; }
   for(int j = idx + 1; j <= end; ++j)
   {
      double d = (gNRsi[idx] - gNRsi[j]) * (gNRsi[idx] - gNRsi[j]);
      if(feat >= 2) d += (gNMom[idx] - gNMom[j]) * (gNMom[idx] - gNMom[j]);
      if(feat >= 3) d += (gNVol[idx] - gNVol[j]) * (gNVol[idx] - gNVol[j]);
      if(feat >= 4) d += (gNSlope[idx] - gNSlope[j]) * (gNSlope[idx] - gNSlope[j]);
      if(feat >= 5) d += (gNPrice[idx] - gNPrice[j]) * (gNPrice[idx] - gNPrice[j]);
      d = MathSqrt(d);
      int slot = -1;
      if(found < k) slot = found++;
      else { int worst = 0; for(int m = 1; m < k; ++m) if(bestDist[m] > bestDist[worst]) worst = m; if(d < bestDist[worst]) slot = worst; }
      if(slot >= 0) { bestDist[slot] = d; bestIdx[slot] = j; }
   }
   double weighted = 0.0, weights = 0.0;
   for(int m = 0; m < found; ++m) if(bestIdx[m] > idx) { double w = (bestDist[m] < 0.0001 ? 1.0 : 1.0 / bestDist[m]); weighted += gStdRsi[bestIdx[m] - 1] * w; weights += w; }
   return (weights > 0.0 ? Clamp100((1.0 - mlWeight) * gStdRsi[idx] + mlWeight * (weighted / weights)) : gStdRsi[idx]);
}

double FilterPoint0(const int total)
{
   if(!InpUseFilter || InpFilterMethod == FILTER_NONE) return gMlRsi[0];
   if(InpFilterMethod == FILTER_KALMAN) { gFilt1[0] = gFilt1[1] + InpFilterStrength * (gMlRsi[0] - gFilt1[1]); return gFilt1[0]; }
   if(InpFilterMethod == FILTER_DOUBLEEMA) { int p1 = MathMax(1, (int)MathRound(InpFilterStrength * 10.0)), p2 = MathMax(1, (int)MathRound(InpFilterStrength * 5.0)); double a1 = 2.0 / (p1 + 1.0), a2 = 2.0 / (p2 + 1.0); gFilt1[0] = a1 * gMlRsi[0] + (1.0 - a1) * gFilt1[1]; gFilt2[0] = a2 * gFilt1[0] + (1.0 - a2) * gFilt2[1]; return gFilt2[0]; }
   return AlmaAt(gMlRsi, total, 0, MathMax(1, (int)MathRound(InpFilterStrength * 20.0)), 0.0, 6.0);
}

void ApplyFilterFull(const int total)
{
   if(!InpUseFilter || InpFilterMethod == FILTER_NONE) { for(int i = 0; i < total; ++i) gFinalRsi[i] = gMlRsi[i]; return; }
   if(InpFilterMethod == FILTER_KALMAN) { for(int i = total - 1; i >= 0; --i) gFilt1[i] = (i == total - 1 ? gMlRsi[i] : gFilt1[i + 1] + InpFilterStrength * (gMlRsi[i] - gFilt1[i + 1])); for(int i = 0; i < total; ++i) gFinalRsi[i] = gFilt1[i]; return; }
   if(InpFilterMethod == FILTER_DOUBLEEMA) { EmaFull(gMlRsi, total, MathMax(1, (int)MathRound(InpFilterStrength * 10.0)), 2.0 / (MathMax(1, (int)MathRound(InpFilterStrength * 10.0)) + 1.0), gFilt1); EmaFull(gFilt1, total, MathMax(1, (int)MathRound(InpFilterStrength * 5.0)), 2.0 / (MathMax(1, (int)MathRound(InpFilterStrength * 5.0)) + 1.0), gFilt2); for(int i = 0; i < total; ++i) gFinalRsi[i] = gFilt2[i]; return; }
   for(int i = total - 1; i >= 0; --i) gFinalRsi[i] = AlmaAt(gMlRsi, total, i, MathMax(1, (int)MathRound(InpFilterStrength * 20.0)), 0.0, 6.0);
}

int ColorIndex(const double v)
{
   if(InpColorMode == COLOR_NONE) return 3;
   if(InpColorMode == COLOR_TREND) return (v > 50.0 ? 0 : 1);
   if(v > InpOverbought) return 0;
   if(v < InpOversold) return 1;
   if(v > 45.0 && v < 55.0) return 2;
   return 3;
}

void UpdatePlots(const int i)
{
   RsiBuf[i] = gFinalRsi[i];
   MidBuf[i] = 50.0;
   ClrBuf[i] = ColorIndex(gFinalRsi[i]);
   BullTopBuf[i] = (gFinalRsi[i] > 50.0 ? gFinalRsi[i] : EMPTY_VALUE);
   BullBaseBuf[i] = (gFinalRsi[i] > 50.0 ? 50.0 : EMPTY_VALUE);
   BearTopBuf[i] = (gFinalRsi[i] < 50.0 ? gFinalRsi[i] : EMPTY_VALUE);
   BearBaseBuf[i] = (gFinalRsi[i] < 50.0 ? 50.0 : EMPTY_VALUE);
}

int OnInit()
{
   ApplyPalette();
   IndicatorSetString(INDICATOR_SHORTNAME, "Machine Learning RSI | BullVision");
   SetIndexBuffer(0, RsiBuf, INDICATOR_DATA); ArraySetAsSeries(RsiBuf, true);
   SetIndexBuffer(1, ClrBuf, INDICATOR_COLOR_INDEX); ArraySetAsSeries(ClrBuf, true);
   SetIndexBuffer(2, MidBuf, INDICATOR_DATA); ArraySetAsSeries(MidBuf, true);
   SetIndexBuffer(3, BullTopBuf, INDICATOR_DATA); ArraySetAsSeries(BullTopBuf, true);
   SetIndexBuffer(4, BullBaseBuf, INDICATOR_DATA); ArraySetAsSeries(BullBaseBuf, true);
   SetIndexBuffer(5, BearTopBuf, INDICATOR_DATA); ArraySetAsSeries(BearTopBuf, true);
   SetIndexBuffer(6, BearBaseBuf, INDICATOR_DATA); ArraySetAsSeries(BearBaseBuf, true);
   for(int p = 0; p < 4; ++p) PlotIndexSetDouble(p, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   IndicatorSetInteger(INDICATOR_LEVELS, 3);
   IndicatorSetDouble(INDICATOR_LEVELVALUE, 0, InpOverbought);
   IndicatorSetDouble(INDICATOR_LEVELVALUE, 1, 50.0);
   IndicatorSetDouble(INDICATOR_LEVELVALUE, 2, InpOversold);
   IndicatorSetInteger(INDICATOR_LEVELCOLOR, 0, gBear);
   IndicatorSetInteger(INDICATOR_LEVELCOLOR, 1, clrSilver);
   IndicatorSetInteger(INDICATOR_LEVELCOLOR, 2, gBull);
   IndicatorSetInteger(INDICATOR_LEVELSTYLE, 0, STYLE_DASH);
   IndicatorSetInteger(INDICATOR_LEVELSTYLE, 1, STYLE_DOT);
   IndicatorSetInteger(INDICATOR_LEVELSTYLE, 2, STYLE_DASH);
   return INIT_SUCCEEDED;
}

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[], const double &high[], const double &low[], const double &close[], const long &tick_volume[], const long &volume[], const int &spread[])
{
   if(rates_total < MathMax(MathMax(InpRsiLength * 3, InpKnnLookback + 20), 60)) return 0;
   ArraySetAsSeries(time, true); ArraySetAsSeries(close, true); ArraySetAsSeries(tick_volume, true); ArraySetAsSeries(volume, true);
   int bars = MathMin(rates_total, MathMax(InpHistoryBars, InpKnnLookback + InpRsiLength + 40));
   bool newBar = (gLastBar != time[0]), full = (prev_calculated == 0 || newBar || ArraySize(gBaseRsi) != bars);
   EnsureSize(bars);
   if(prev_calculated == 0) { ArrayInitialize(RsiBuf, EMPTY_VALUE); ArrayInitialize(ClrBuf, 3.0); ArrayInitialize(MidBuf, 50.0); ArrayInitialize(BullTopBuf, EMPTY_VALUE); ArrayInitialize(BullBaseBuf, EMPTY_VALUE); ArrayInitialize(BearTopBuf, EMPTY_VALUE); ArrayInitialize(BearBaseBuf, EMPTY_VALUE); }

   if(!full)
   {
      double diff = close[0] - close[1]; gGain[0] = MathMax(diff, 0.0); gLoss[0] = MathMax(-diff, 0.0);
      gAvgGain[0] = (gAvgGain[1] * (InpRsiLength - 1) + gGain[0]) / InpRsiLength; gAvgLoss[0] = (gAvgLoss[1] * (InpRsiLength - 1) + gLoss[0]) / InpRsiLength;
      gBaseRsi[0] = (gAvgLoss[0] == 0.0 ? 100.0 : gAvgGain[0] == 0.0 ? 0.0 : 100.0 - 100.0 / (1.0 + gAvgGain[0] / gAvgLoss[0]));
      gStdRsi[0] = (InpUseSmoothing ? MAPoint0(gBaseRsi, tick_volume, volume, bars, InpSmoothLength, InpMaType, InpAlmaSigma, gStdRsi, gMa1, gMa2) : gBaseRsi[0]);
      gMom[0] = (bars > 3 ? gStdRsi[0] - gStdRsi[3] : 0.0); gVol[0] = StdDevAt(gStdRsi, bars, 0, 10); double slope = 0.0, endpoint = 0.0; LinRegAt(gStdRsi, bars, 0, 5, slope, endpoint); gSlope[0] = slope; gPriceMom[0] = (bars > 5 ? close[0] - close[5] : 0.0);
      gNRsi[0] = NormalizeAt(gStdRsi, bars, 0, InpKnnLookback); gNMom[0] = NormalizeAt(gMom, bars, 0, InpKnnLookback); gNVol[0] = NormalizeAt(gVol, bars, 0, InpKnnLookback); gNSlope[0] = NormalizeAt(gSlope, bars, 0, InpKnnLookback); gNPrice[0] = NormalizeAt(gPriceMom, bars, 0, InpKnnLookback);
      gMlRsi[0] = KNNPoint(0, bars); gFinalRsi[0] = Clamp100(FilterPoint0(bars)); UpdatePlots(0); return rates_total;
   }

   for(int i = bars - 1; i >= 0; --i)
   {
      double diff = (i == bars - 1 ? 0.0 : close[i] - close[i + 1]);
      gGain[i] = MathMax(diff, 0.0); gLoss[i] = MathMax(-diff, 0.0);
      gAvgGain[i] = (i == bars - 1 ? gGain[i] : (gAvgGain[i + 1] * (InpRsiLength - 1) + gGain[i]) / InpRsiLength);
      gAvgLoss[i] = (i == bars - 1 ? gLoss[i] : (gAvgLoss[i + 1] * (InpRsiLength - 1) + gLoss[i]) / InpRsiLength);
      gBaseRsi[i] = (gAvgLoss[i] == 0.0 ? 100.0 : gAvgGain[i] == 0.0 ? 0.0 : 100.0 - 100.0 / (1.0 + gAvgGain[i] / gAvgLoss[i]));
   }

   if(InpUseSmoothing) ApplyMAFull(gBaseRsi, tick_volume, volume, bars, InpSmoothLength, InpMaType, InpAlmaSigma, gStdRsi); else for(int i = 0; i < bars; ++i) gStdRsi[i] = gBaseRsi[i];

   for(int i = bars - 1; i >= 0; --i)
   {
      gMom[i] = (i + 3 < bars ? gStdRsi[i] - gStdRsi[i + 3] : 0.0);
      gVol[i] = StdDevAt(gStdRsi, bars, i, 10);
      double slope = 0.0, endpoint = 0.0; LinRegAt(gStdRsi, bars, i, 5, slope, endpoint); gSlope[i] = slope;
      gPriceMom[i] = (i + 5 < bars ? close[i] - close[i + 5] : 0.0);
   }
   for(int i = bars - 1; i >= 0; --i)
   {
      gNRsi[i] = NormalizeAt(gStdRsi, bars, i, InpKnnLookback);
      gNMom[i] = NormalizeAt(gMom, bars, i, InpKnnLookback);
      gNVol[i] = NormalizeAt(gVol, bars, i, InpKnnLookback);
      gNSlope[i] = NormalizeAt(gSlope, bars, i, InpKnnLookback);
      gNPrice[i] = NormalizeAt(gPriceMom, bars, i, InpKnnLookback);
   }
   for(int i = bars - 1; i >= 0; --i) gMlRsi[i] = KNNPoint(i, bars);
   ApplyFilterFull(bars);
   for(int i = bars - 1; i >= 0; --i) { gFinalRsi[i] = Clamp100(gFinalRsi[i]); UpdatePlots(i); }

   gLastBar = time[0];
   return rates_total;
}
