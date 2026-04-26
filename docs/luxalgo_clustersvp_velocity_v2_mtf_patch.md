# LuxAlgo ClustersVP Velocity v2 MTF Patch

This is a manual patch note for turning your current indicator into a higher-timeframe source indicator while still drawing on the chart you are attached to.

The goal is:

- stay based on your existing code
- keep one selected source timeframe per indicator instance
- allow attaching multiple instances to the same chart without object-name collisions
- calculate clusters, POC state, and velocity from the selected higher timeframe
- draw the result on the current chart

If later you want true multi-stack MTF in one instance, the clean next step is an array of timeframe contexts. For now, this patch is the fastest stable step.

## 1. Replace the prefix constant and add MTF inputs/globals

Replace this:

```mql5
const string PREFIX = "LuxCVP_";
```

With this:

```mql5
const string PREFIX_BASE = "LuxCVP_";
#define MAX_CLUSTERS 10

string g_prefix = PREFIX_BASE;
ENUM_TIMEFRAMES g_calc_tf = PERIOD_CURRENT;
int g_chart_period_sec = 0;
int g_calc_period_sec = 0;
```

Add this new input group after your current velocity settings:

```mql5
input group "MTF Settings"
input ENUM_TIMEFRAMES   InpCalcTF     = PERIOD_CURRENT; // Source TF for clustering/velocity
input bool              InpRequireHTF = true;           // Enforce selected TF >= chart TF
```

## 2. Add these helper functions

Drop these above `OnInit()`:

```mql5
string TfLabel(const ENUM_TIMEFRAMES tf)
{
   switch(tf)
   {
      case PERIOD_M1:   return "M1";
      case PERIOD_M2:   return "M2";
      case PERIOD_M3:   return "M3";
      case PERIOD_M4:   return "M4";
      case PERIOD_M5:   return "M5";
      case PERIOD_M6:   return "M6";
      case PERIOD_M10:  return "M10";
      case PERIOD_M12:  return "M12";
      case PERIOD_M15:  return "M15";
      case PERIOD_M20:  return "M20";
      case PERIOD_M30:  return "M30";
      case PERIOD_H1:   return "H1";
      case PERIOD_H2:   return "H2";
      case PERIOD_H3:   return "H3";
      case PERIOD_H4:   return "H4";
      case PERIOD_H6:   return "H6";
      case PERIOD_H8:   return "H8";
      case PERIOD_H12:  return "H12";
      case PERIOD_D1:   return "D1";
      case PERIOD_W1:   return "W1";
      case PERIOD_MN1:  return "MN1";
      case PERIOD_CURRENT: return "CURRENT";
   }
   return IntegerToString((int)tf);
}

ENUM_TIMEFRAMES ResolveCalcTF()
{
   if(InpCalcTF == PERIOD_CURRENT)
      return (ENUM_TIMEFRAMES)_Period;
   return InpCalcTF;
}

double GetBarVolume(const MqlRates &bar)
{
   return (InpVolumeType == VOL_TICK) ? (double)bar.tick_volume : (double)bar.real_volume;
}
```

## 3. Make `UpdateLevelState()` timeframe-aware

Change the function signature from this:

```mql5
void UpdateLevelState(POC_State &st, double poc_price, double cur_mass, double cur_range, double bin_size, const datetime cur_time, const double o0, const double h0, const double l0, const double c0, const double o1, const double h1, const double l1, const double c1)
```

To this:

```mql5
void UpdateLevelState(POC_State &st, double poc_price, double cur_mass, double cur_range, double bin_size, const datetime cur_time, const int period_sec, const double o0, const double h0, const double l0, const double c0, const double o1, const double h1, const double l1, const double c1)
```

Then inside the function replace this line:

```mql5
long period_sec = PeriodSeconds();
```

With this:

```mql5
int period_sec_safe = MathMax(period_sec, 1);
```

And replace this block:

```mql5
if(cur_time - st.snap_time >= (InpVelocityBars * period_sec)) {
```

With this:

```mql5
if(cur_time - st.snap_time >= (InpVelocityBars * period_sec_safe)) {
```

## 4. Update `OnInit()`

Use this `OnInit()` body:

```mql5
int OnInit() {
   PALETTE[0] = InpColor1; PALETTE[1] = InpColor2; PALETTE[2] = InpColor3; PALETTE[3] = InpColor4;
   PALETTE[4] = InpColor5; PALETTE[5] = InpColor6; PALETTE[6] = InpColor7; PALETTE[7] = InpColor8;
   PALETTE[8] = InpColor9; PALETTE[9] = InpColor10;

   g_calc_tf = ResolveCalcTF();
   g_chart_period_sec = MathMax(PeriodSeconds((ENUM_TIMEFRAMES)_Period), 1);
   g_calc_period_sec  = MathMax(PeriodSeconds(g_calc_tf), 1);

   if(InpRequireHTF && g_calc_period_sec < g_chart_period_sec)
   {
      PrintFormat("LuxCVP MTF: selected TF %s must be >= chart TF %s", TfLabel(g_calc_tf), TfLabel((ENUM_TIMEFRAMES)_Period));
      return(INIT_PARAMETERS_INCORRECT);
   }

   g_prefix = PREFIX_BASE + TfLabel(g_calc_tf) + "_";

   for(int i = 0; i < MAX_CLUSTERS; i++) {
      LevelStates[i].price = 0.0;
      LevelStates[i].snap_time = 0;
      LevelStates[i].regime_dir = "Init";
      LevelStates[i].regime_auc = "Init";
      LevelStates[i].regime_vol = "Init";
   }

   IndicatorSetInteger(INDICATOR_DIGITS, _Digits);
   IndicatorSetString(INDICATOR_SHORTNAME, "LuxCVP Velocity v2 [" + TfLabel(g_calc_tf) + "]");

   SetupHiddenPlot(0, POCBuf0, "POC 1"); SetupHiddenPlot(1, POCBuf1, "POC 2"); SetupHiddenPlot(2, POCBuf2, "POC 3"); SetupHiddenPlot(3, POCBuf3, "POC 4");
   SetupHiddenPlot(4, POCBuf4, "POC 5"); SetupHiddenPlot(5, POCBuf5, "POC 6"); SetupHiddenPlot(6, POCBuf6, "POC 7"); SetupHiddenPlot(7, POCBuf7, "POC 8");
   SetupHiddenPlot(8, POCBuf8, "POC 9"); SetupHiddenPlot(9, POCBuf9, "POC 10");
   return(INIT_SUCCEEDED);
}
```

## 5. Change all object helpers to use `g_prefix`

Wherever you currently build names with `PREFIX`, replace it with `g_prefix`.

That includes:

- `DeleteAllObjects()`
- `DrawDot()`
- `DrawBox()`
- `DrawLine()`
- `DrawText()`
- the cleanup section at the end of `OnCalculate()`

Example:

```mql5
string name = g_prefix + "Dot_" + IntegerToString(id);
```

And in `DeleteAllObjects()`:

```mql5
if(StringFind(name, g_prefix) == 0) ObjectDelete(0, name);
```

This matters a lot once you attach multiple instances for different higher timeframes.

## 6. Replace `OnCalculate()` with this MTF version

```mql5
int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[], const double &high[], const double &low[], const double &close[], const long &tick_volume[], const long &volume[], const int &spread[]) {
   if(rates_total < 2) return 0;

   static uint last_update_time = 0;
   uint current_time = GetTickCount();
   if(rates_total == prev_calculated && (current_time - last_update_time) < InpRefreshRate)
      return rates_total;
   last_update_time = current_time;

   ArraySetAsSeries(time, true);
   ArraySetAsSeries(open, true);
   ArraySetAsSeries(high, true);
   ArraySetAsSeries(low, true);
   ArraySetAsSeries(close, true);

   MqlRates src_rates[];
   int bars_needed = InpLookback + 2;
   int copied = CopyRates(_Symbol, g_calc_tf, 0, bars_needed, src_rates);
   if(copied < InpLookback + 1)
      return prev_calculated;

   ArraySetAsSeries(src_rates, true);

   int lookback = MathMin(InpLookback, copied - 1);
   if(lookback < 2)
      return prev_calculated;

   double prices[], volumes[], highs[], lows[];
   ArrayResize(prices, lookback);
   ArrayResize(volumes, lookback);
   ArrayResize(highs, lookback);
   ArrayResize(lows, lookback);

   for(int i = 0; i < lookback; i++) {
      prices[i]  = (src_rates[i].high + src_rates[i].low) / 2.0;
      highs[i]   = src_rates[i].high;
      lows[i]    = src_rates[i].low;
      volumes[i] = GetBarVolume(src_rates[i]);
   }

   int assignments[];
   K_Means(lookback, InpClusters, InpIterations, prices, volumes, assignments);

   datetime calcStartTime = src_rates[lookback - 1].time;
   datetime vpStartTime = time[0] + (datetime)(InpVPOffset * g_chart_period_sec);

   int cur_dots = 0, cur_boxes = 0, cur_lines = 0, cur_txt_poc = 0, cur_txt_tot = 0, cur_txt_vel = 0;
   int reservedForMetrics = InpClusters * 2;
   int maxObjects = 500;

   double clusterPoc[MAX_CLUSTERS];
   ArrayInitialize(clusterPoc, EMPTY_VALUE);

   for(int c_id = 0; c_id < InpClusters; c_id++) {
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
         if(assignments[i] != c_id)
            continue;

         double b_h = highs[i], b_l = lows[i], b_v = volumes[i];
         double wickRange = MathMax(b_h - b_l, SymbolInfoDouble(_Symbol, SYMBOL_POINT));

         for(int b_idx = 0; b_idx < InpRowsPerVP; b_idx++) {
            double binB = c_min + b_idx * binSize;
            double binT = binB + binSize;
            double intersectL = MathMax(b_l, binB);
            double intersectH = MathMin(b_h, binT);
            if(intersectH > intersectL)
               binVols[b_idx] += b_v * (intersectH - intersectL) / wickRange;
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
         if(vol == 0.0)
            continue;

         double b_bottom = c_min + b_idx * binSize;
         double b_top = b_bottom + binSize;
         int b_width_bars = (maxBinVol > 0.0) ? (int)((vol / maxBinVol) * InpVPWidth) : 0;
         datetime endXTime = vpStartTime + (datetime)(b_width_bars * g_chart_period_sec);

         bool isPoc = (b_idx == pocBinIdx);
         color b_color = isPoc ? clusterColor : fadedColor;
         DrawBox(cur_boxes++, vpStartTime, b_top, endXTime, b_bottom, b_color, isPoc ? clusterColor : clrNONE);

         if(!isPoc)
            continue;

         double pocY = (b_top + b_bottom) / 2.0;
         clusterPoc[c_id] = pocY;
         double cur_range = c_max - c_min;

         UpdateLevelState(
            LevelStates[c_id],
            pocY,
            c_total_vol,
            cur_range,
            binSize,
            src_rates[0].time,
            g_calc_period_sec,
            src_rates[0].open, src_rates[0].high, src_rates[0].low, src_rates[0].close,
            src_rates[1].open, src_rates[1].high, src_rates[1].low, src_rates[1].close
         );

         ENUM_LEVEL_STATE status = LevelStates[c_id].status;

         int line_style = STYLE_DASH;
         int line_width = 1;
         color state_color = clusterColor;
         if(status == LEVEL_FRESH) { line_style = STYLE_SOLID; line_width = 2; }
         else if(status == LEVEL_REJECTED) { line_style = STYLE_DASHDOT; line_width = 2; }
         else if(status == LEVEL_ACCEPTED) { line_style = STYLE_SOLID; line_width = 3; }
         else if(status == LEVEL_BROKEN) { line_style = STYLE_DOT; state_color = fadedColor; }
         else if(status == LEVEL_RECLAIMED) { line_style = STYLE_DASHDOTDOT; line_width = 2; }

         DrawLine(cur_lines++, calcStartTime, pocY, vpStartTime, state_color, line_style, line_width);
         DrawText("POCTxt_", cur_txt_poc++, calcStartTime, pocY, FormatVolume(vol), state_color, ANCHOR_RIGHT_LOWER);

         string stat_text = " [" + TfLabel(g_calc_tf) + "] Vol: " + FormatVolume(c_total_vol) + " " + GetStateString(LevelStates[c_id]);
         string vel_text  = StringFormat(" [%s] Velocity: [%s | %s | %s]", TfLabel(g_calc_tf), LevelStates[c_id].regime_dir, LevelStates[c_id].regime_auc, LevelStates[c_id].regime_vol);

         DrawText("TotTxt_", cur_txt_tot++, endXTime, pocY, stat_text, state_color, ANCHOR_LEFT_LOWER);
         DrawText("VelTxt_", cur_txt_vel++, endXTime, pocY, vel_text, state_color, ANCHOR_LEFT_UPPER);
      }
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
   ChartRedraw();
   return(rates_total);
}
```

## 7. Tiny cleanup patch

Your current `DeleteAllObjects()` should become:

```mql5
void DeleteAllObjects() {
   int total = ObjectsTotal(0, 0, -1);
   for(int i = total - 1; i >= 0; i--) {
      string name = ObjectName(0, i, 0, -1);
      if(StringFind(name, g_prefix) == 0)
         ObjectDelete(0, name);
   }
   prev_dots = 0; prev_boxes = 0; prev_lines = 0; prev_txt_poc = 0; prev_txt_tot = 0; prev_txt_vel = 0;
   ArrayResize(mem_centroids, 0);
}
```

## 8. How this behaves

- If `InpCalcTF = PERIOD_CURRENT`, the indicator behaves like the old version.
- If `InpCalcTF = PERIOD_H1` on an `M5` chart, clustering and velocity are computed from `H1` candles.
- The drawing still happens on the `M5` chart, so you can see HTF structure in lower-timeframe execution.
- If `InpRequireHTF = true`, selecting a lower timeframe than the current chart will fail initialization on purpose.
- Because object names include the source timeframe now, you can attach one `H1`, one `H4`, and one `D1` instance to the same chart.

## 9. Manual test checklist in MetaEditor

1. Compile once with `InpCalcTF = PERIOD_CURRENT` and confirm baseline behavior still matches your current build.
2. Attach to `M5`, set `InpCalcTF = PERIOD_H1`, and confirm:
   - dots line up on hourly timestamps
   - POC state text shows `[H1]`
   - velocity changes only when the H1 bar context changes
3. Attach a second instance with `InpCalcTF = PERIOD_H4` and confirm both instances coexist without deleting each other.
4. Flip `InpRequireHTF = true` and try `InpCalcTF = PERIOD_M1` on an `H1` chart to confirm init rejection works.

## 10. Best next upgrade

If you want the real monster version after this, build a small `TFContext` struct and loop over an array of selected higher timeframes in one indicator instance. The object-prefix change in this patch is already the right foundation for that move.
