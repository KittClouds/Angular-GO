
//+------------------------------------------------------------------+
//|                    LuxAlgo_ClustersVP_Velocity_v2_MTF.mq5        |
//+------------------------------------------------------------------+
#property copyright "CC BY-NC-SA 4.0 - Ported to MQL5"
#property link      "https://creativecommons.org/licenses/by-nc-sa/4.0/"
#property version   "2.30"
#property strict
#property indicator_chart_window
#property indicator_buffers 10
#property indicator_plots   10

enum ENUM_VOLUME_TYPE { VOL_TICK = 0, VOL_REAL = 1 };
enum ENUM_DOT_SIZE { DOT_TINY = 1, DOT_SMALL = 2, DOT_NORMAL = 3, DOT_LARGE = 4, DOT_HUGE = 5 };
enum ENUM_LEVEL_STATE { LEVEL_FRESH, LEVEL_TESTED, LEVEL_ACCEPTED, LEVEL_REJECTED, LEVEL_BROKEN, LEVEL_RECLAIMED };

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
input bool             InpEnableExtremeZones    = true;
input color            InpLowerExtremeColor     = clrDarkOrchid;
input color            InpUpperExtremeColor     = clrTeal;
input double           InpExtremeStepFactor     = 1.0;

input group "Range Detection Core"
input int              rangeBars                 = 10;
input double           maxRangePips              = 50.0;
input double           breakoutBufferPips        = 0.0;
input ENUM_TIMEFRAMES  InpRangeTF                = PERIOD_M3;
input int              breakoutCandles           = 0;

input group "Range Detection Relationships"
input double           relationTolerancePips     = 0.2;
input double           sameOverlapMin            = 0.80;
input double           sameMidpointMaxWidthFrac  = 0.25;
input double           childMaxWidthParentFrac   = 0.85;
input double           siblingOverlapMin         = 0.35;
input double           siblingMidpointMinFrac    = 0.20;
input double           siblingMidpointMaxFrac    = 1.25;

input group "Range Detection Visuals"
input color            activeRootColor           = clrBlue;
input color            activeChildColor          = clrDodgerBlue;
input color            activeSiblingColor        = clrDeepSkyBlue;
input color            brokenRangeColor          = clrSlateBlue;
input bool             fillRectangle             = true;
input ENUM_LINE_STYLE  rectangleStyle            = STYLE_SOLID;
input int              rectangleWidth            = 1;
input bool             drawMidpoint              = true;
input color            midpointColor             = clrYellow;
input ENUM_LINE_STYLE  midpointStyle             = STYLE_SOLID;
input int              midpointWidth             = 1;
input bool             hideObjects               = false;

enum ENUM_RANGE_STATE { RANGE_ACTIVE = 0, RANGE_BROKEN = 1 };
enum ENUM_RANGE_RELATION { RANGE_ROOT = 0, RANGE_CHILD = 1, RANGE_SIBLING = 2 };

const string PREFIX_BASE = "LuxCVP_";
#define MAX_CLUSTERS 10

color PALETTE[MAX_CLUSTERS];
string g_prefix = PREFIX_BASE;
ENUM_TIMEFRAMES g_calc_tf = PERIOD_CURRENT;
int g_chart_period_sec = 0;
int g_calc_period_sec = 0;

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

POC_State LevelStates[MAX_CLUSTERS];
SRange g_ranges[];

int prev_dots = 0, prev_boxes = 0, prev_lines = 0, prev_txt_poc = 0, prev_txt_tot = 0, prev_txt_vel = 0;
int g_nextRangeId = 1;
datetime g_lastRangeTfBarTime = 0;
string g_range_prefix = "";
bool g_range_history_built = false;
int g_activeRangeIdx = -1;
datetime g_lastRangeBreakTime = 0;
const int MAX_RANGE_HISTORY_SCAN = 200;

double mem_centroids[];
double POCBuf0[], POCBuf1[], POCBuf2[], POCBuf3[], POCBuf4[], POCBuf5[], POCBuf6[], POCBuf7[], POCBuf8[], POCBuf9[];

int RequestedClusterCount() {
   return MathMax(1, MathMin(InpClusters, MAX_CLUSTERS));
}

bool CanUseExtremeZones() {
   return (InpEnableExtremeZones && RequestedClusterCount() <= MAX_CLUSTERS - 2);
}

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

double GetBarVolume(const MqlRates &bar) {
   return (InpVolumeType == VOL_TICK) ? (double)bar.tick_volume : (double)bar.real_volume;
}

void SetupHiddenPlot(const int idx, double &buffer[], const string label) {
   SetIndexBuffer(idx, buffer, INDICATOR_DATA);
   ArraySetAsSeries(buffer, true);
   PlotIndexSetInteger(idx, PLOT_DRAW_TYPE, DRAW_NONE);
   PlotIndexSetInteger(idx, PLOT_SHOW_DATA, true);
   PlotIndexSetDouble(idx, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   PlotIndexSetString(idx, PLOT_LABEL, label);
}

void PushPOCBuffers(double &clusterPoc[]) {
   ArrayInitialize(POCBuf0, clusterPoc[0] != EMPTY_VALUE ? clusterPoc[0] : EMPTY_VALUE);
   ArrayInitialize(POCBuf1, clusterPoc[1] != EMPTY_VALUE ? clusterPoc[1] : EMPTY_VALUE);
   ArrayInitialize(POCBuf2, clusterPoc[2] != EMPTY_VALUE ? clusterPoc[2] : EMPTY_VALUE);
   ArrayInitialize(POCBuf3, clusterPoc[3] != EMPTY_VALUE ? clusterPoc[3] : EMPTY_VALUE);
   ArrayInitialize(POCBuf4, clusterPoc[4] != EMPTY_VALUE ? clusterPoc[4] : EMPTY_VALUE);
   ArrayInitialize(POCBuf5, clusterPoc[5] != EMPTY_VALUE ? clusterPoc[5] : EMPTY_VALUE);
   ArrayInitialize(POCBuf6, clusterPoc[6] != EMPTY_VALUE ? clusterPoc[6] : EMPTY_VALUE);
   ArrayInitialize(POCBuf7, clusterPoc[7] != EMPTY_VALUE ? clusterPoc[7] : EMPTY_VALUE);
   ArrayInitialize(POCBuf8, clusterPoc[8] != EMPTY_VALUE ? clusterPoc[8] : EMPTY_VALUE);
   ArrayInitialize(POCBuf9, clusterPoc[9] != EMPTY_VALUE ? clusterPoc[9] : EMPTY_VALUE);
}

void DeleteAllObjects() {
   int total = ObjectsTotal(0, 0, -1);
   for(int i = total - 1; i >= 0; i--) {
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

int OnInit() {
   PALETTE[0] = InpColor1;  PALETTE[1] = InpColor2;  PALETTE[2] = InpColor3;  PALETTE[3] = InpColor4;
   PALETTE[4] = InpColor5;  PALETTE[5] = InpColor6;  PALETTE[6] = InpColor7;  PALETTE[7] = InpColor8;
   PALETTE[8] = InpColor9;  PALETTE[9] = InpColor10;

   g_calc_tf = ResolveCalcTF();
   g_chart_period_sec = MathMax(PeriodSeconds((ENUM_TIMEFRAMES)_Period), 1);
   g_calc_period_sec = MathMax(PeriodSeconds(g_calc_tf), 1);
   if(InpRequireHTF && g_calc_period_sec < g_chart_period_sec)
      return INIT_PARAMETERS_INCORRECT;

   g_prefix = PREFIX_BASE + TfLabel(g_calc_tf) + "_";
   g_range_prefix = PREFIX_BASE + "RNG_" + TfLabel(g_calc_tf) + "_" + TfLabel(InpRangeTF) + "_";
   g_range_history_built = false;
   ResetRangeEngine();

   for(int i = 0; i < MAX_CLUSTERS; i++) {
      LevelStates[i].price = 0.0;
      LevelStates[i].snap_time = 0;
      LevelStates[i].regime_dir = "Init";
      LevelStates[i].regime_auc = "Init";
      LevelStates[i].regime_vol = "Init";
      LevelStates[i].synthetic = false;
      LevelStates[i].activated = false;
      LevelStates[i].source_slot = -1;
   }

   IndicatorSetInteger(INDICATOR_DIGITS, _Digits);
   IndicatorSetString(INDICATOR_SHORTNAME, "LuxCVP Velocity v2 [" + TfLabel(g_calc_tf) + "]");

   SetupHiddenPlot(0, POCBuf0, "POC 1");
   SetupHiddenPlot(1, POCBuf1, "POC 2");
   SetupHiddenPlot(2, POCBuf2, "POC 3");
   SetupHiddenPlot(3, POCBuf3, "POC 4");
   SetupHiddenPlot(4, POCBuf4, "POC 5");
   SetupHiddenPlot(5, POCBuf5, "POC 6");
   SetupHiddenPlot(6, POCBuf6, "POC 7");
   SetupHiddenPlot(7, POCBuf7, "POC 8");
   SetupHiddenPlot(8, POCBuf8, "POC 9");
   SetupHiddenPlot(9, POCBuf9, "POC 10");

   if(CanUseExtremeZones()) {
      int lowerSlot = RequestedClusterCount();
      int upperSlot = RequestedClusterCount() + 1;
      if(lowerSlot < MAX_CLUSTERS)
         PlotIndexSetString(lowerSlot, PLOT_LABEL, "Lower Extreme");
      if(upperSlot < MAX_CLUSTERS)
         PlotIndexSetString(upperSlot, PLOT_LABEL, "Upper Extreme");
   }
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) {
   DeleteAllObjects();
   DeleteRangeObjects();
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
      poc_fill_color = clusterColor;
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

   UpdateLevelState(
      LevelStates[slot],
      extremePoc,
      zoneMass[edgeIdx],
      zoneRange[edgeIdx],
      extremeBin,
      curTime,
      g_calc_period_sec,
      o0, h0, l0, c0,
      o1, h1, l1, c1
   );

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

double RangePipSize() { return (_Digits == 3 || _Digits == 5) ? _Point * 10.0 : _Point; }
double RangePipsToPrice(const double pips) { return pips * RangePipSize(); }
double RangeNormalizePrice(const double price) { return NormalizeDouble(price, _Digits); }
double RangeBreakBuffer() { return RangePipsToPrice(breakoutBufferPips); }
double RangeTolerancePrice() { return RangePipsToPrice(relationTolerancePips); }
bool RangeEnoughBars() { return (iBars(_Symbol, InpRangeTF) >= rangeBars + 2); }
double RangeWidthFromBounds(const double high, const double low) { return MathMax(high - low, _Point); }
double RangeWidth(const SRange &r) { return RangeWidthFromBounds(r.high, r.low); }
double RangeCandidateWidth(const SCandidate &c) { return RangeWidthFromBounds(c.high, c.low); }
double RangeMidFromBounds(const double high, const double low) { return RangeNormalizePrice((high + low) * 0.5); }

double RangeOverlapSize(const double h1, const double l1, const double h2, const double l2) {
   double top = MathMin(h1, h2);
   double bot = MathMax(l1, l2);
   return MathMax(0.0, top - bot);
}

double RangeOverlapRatioToSmaller(const double h1, const double l1, const double h2, const double l2) {
   double sm = MathMin(RangeWidthFromBounds(h1, l1), RangeWidthFromBounds(h2, l2));
   if(sm <= 0.0)
      return 0.0;
   return RangeOverlapSize(h1, l1, h2, l2) / sm;
}

double RangeWidthSimilarity(const double w1, const double w2) {
   double lg = MathMax(w1, w2);
   if(lg <= 0.0)
      return 0.0;
   return MathMin(w1, w2) / lg;
}

bool RangeIsContained(const double innerHigh, const double innerLow, const double outerHigh, const double outerLow, const double tol) {
   return (innerHigh <= outerHigh + tol && innerLow >= outerLow - tol);
}

string RangeRectName(const int id) { return g_range_prefix + "RECT_" + IntegerToString(id); }
string RangeMidName(const int id) { return g_range_prefix + "MID_" + IntegerToString(id); }

color RangeVisualColor(const SRange &r) {
   if(r.state == RANGE_BROKEN)
      return brokenRangeColor;
   switch(r.relation) {
      case RANGE_CHILD: return activeChildColor;
      case RANGE_SIBLING: return activeSiblingColor;
      default: return activeRootColor;
   }
}

void RangeApplyCommonStyle(const string name) {
   ObjectSetInteger(0, name, OBJPROP_BACK, true);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTED, false);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN, hideObjects);
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

void DrawRangeRectangle(const string name, const datetime t1, const double high, const datetime t2, const double low, const color clr) {
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_RECTANGLE, 0, t1, high, t2, low);
   ObjectMove(0, name, 0, t1, high);
   ObjectMove(0, name, 1, t2, low);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_STYLE, rectangleStyle);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, rectangleWidth);
   ObjectSetInteger(0, name, OBJPROP_FILL, fillRectangle);
   RangeApplyCommonStyle(name);
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
   RangeApplyCommonStyle(name);
}

void RenderRangeRecord(const SRange &r) {
   string rect = RangeRectName(r.id);
   string mid = RangeMidName(r.id);
   DrawRangeRectangle(rect, r.t_start, r.high, r.t_end, r.low, RangeVisualColor(r));
   if(drawMidpoint) {
      double midpoint = RangeMidFromBounds(r.high, r.low);
      DrawRangeMidpointLine(mid, r.t_start, r.t_end, midpoint);
   } else if(ObjectFind(0, mid) >= 0) {
      ObjectDelete(0, mid);
   }
}

void RenderAllRangeRecords() {
   for(int i = 0; i < ArraySize(g_ranges); ++i)
      RenderRangeRecord(g_ranges[i]);
   ChartRedraw();
}

bool RangeCandidateSameAsRange(const SCandidate &c, const SRange &r) {
   double wc = RangeCandidateWidth(c);
   double wr = RangeWidth(r);
   double overlap = RangeOverlapRatioToSmaller(c.high, c.low, r.high, r.low);
   double midDist = MathAbs(RangeMidFromBounds(c.high, c.low) - RangeMidFromBounds(r.high, r.low));
   double widthSim = RangeWidthSimilarity(wc, wr);
   double maxMidDist = MathMax(RangeTolerancePrice(), sameMidpointMaxWidthFrac * MathMax(wc, wr));
   return (overlap >= sameOverlapMin && midDist <= maxMidDist && widthSim >= 0.80);
}

bool RangeCandidateChildOfRange(const SCandidate &c, const SRange &r) {
   double wc = RangeCandidateWidth(c);
   double wr = RangeWidth(r);
   double overlap = RangeOverlapRatioToSmaller(c.high, c.low, r.high, r.low);
   if(!RangeIsContained(c.high, c.low, r.high, r.low, RangeTolerancePrice()))
      return false;
   if(wc > wr * childMaxWidthParentFrac)
      return false;
   return (overlap >= 0.95);
}

bool RangeCandidateSiblingOfRange(const SCandidate &c, const SRange &r) {
   double wc = RangeCandidateWidth(c);
   double wr = RangeWidth(r);
   double overlap = RangeOverlapRatioToSmaller(c.high, c.low, r.high, r.low);
   double midDist = MathAbs(RangeMidFromBounds(c.high, c.low) - RangeMidFromBounds(r.high, r.low));
   double maxWidth = MathMax(wc, wr);
   double minMidDist = siblingMidpointMinFrac * maxWidth;
   double maxMidDist = siblingMidpointMaxFrac * maxWidth;
   if(RangeIsContained(c.high, c.low, r.high, r.low, RangeTolerancePrice()) || RangeIsContained(r.high, r.low, c.high, c.low, RangeTolerancePrice()))
      return false;
   return (overlap >= siblingOverlapMin && overlap < sameOverlapMin && midDist >= minMidDist && midDist <= maxMidDist);
}

int FindBestSameRange(const SCandidate &c) {
   int best = -1;
   double bestScore = -1e100;
   int total = ArraySize(g_ranges);
   int limit = MathMax(0, total - MAX_RANGE_HISTORY_SCAN);
   for(int i = total - 1; i >= limit; --i) {
      if(!RangeCandidateSameAsRange(c, g_ranges[i]))
         continue;
      double wc = RangeCandidateWidth(c);
      double wr = RangeWidth(g_ranges[i]);
      double overlap = RangeOverlapRatioToSmaller(c.high, c.low, g_ranges[i].high, g_ranges[i].low);
      double midDist = MathAbs(RangeMidFromBounds(c.high, c.low) - RangeMidFromBounds(g_ranges[i].high, g_ranges[i].low));
      double score = overlap * 10.0 + RangeWidthSimilarity(wc, wr) - (midDist / MathMax(wc, wr));
      if(score > bestScore) {
         bestScore = score;
         best = i;
      }
   }
   return best;
}

int FindBestChildParentRange(const SCandidate &c) {
   int best = -1;
   double narrowestW = DBL_MAX;
   int total = ArraySize(g_ranges);
   int limit = MathMax(0, total - MAX_RANGE_HISTORY_SCAN);
   for(int i = total - 1; i >= limit; --i) {
      if(!RangeCandidateChildOfRange(c, g_ranges[i]))
         continue;
      double wr = RangeWidth(g_ranges[i]);
      if(wr < narrowestW) {
         narrowestW = wr;
         best = i;
      }
   }
   return best;
}

int FindBestSiblingAnchorRange(const SCandidate &c) {
   int best = -1;
   double bestScore = -1e100;
   int total = ArraySize(g_ranges);
   int limit = MathMax(0, total - MAX_RANGE_HISTORY_SCAN);
   for(int i = total - 1; i >= limit; --i) {
      if(!RangeCandidateSiblingOfRange(c, g_ranges[i]))
         continue;
      double overlap = RangeOverlapRatioToSmaller(c.high, c.low, g_ranges[i].high, g_ranges[i].low);
      double midDist = MathAbs(RangeMidFromBounds(c.high, c.low) - RangeMidFromBounds(g_ranges[i].high, g_ranges[i].low));
      double score = overlap * 10.0 - (midDist / MathMax(RangeCandidateWidth(c), RangeWidth(g_ranges[i])));
      if(score > bestScore) {
         bestScore = score;
         best = i;
      }
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
   g_ranges[n].high = RangeNormalizePrice(c.high);
   g_ranges[n].low = RangeNormalizePrice(c.low);
   g_ranges[n].consec_above = 0;
   g_ranges[n].consec_below = 0;
   return n;
}

int ProcessRangeCandidate(const SCandidate &c) {
   int sameIdx = FindBestSameRange(c);
   if(sameIdx >= 0) {
      int parent_id = (g_ranges[sameIdx].parent_id > 0 ? g_ranges[sameIdx].parent_id : g_ranges[sameIdx].id);
      return AddRangeRecord(c, RANGE_SIBLING, parent_id);
   }
   int childIdx = FindBestChildParentRange(c);
   if(childIdx >= 0)
      return AddRangeRecord(c, RANGE_CHILD, g_ranges[childIdx].id);
   int siblingIdx = FindBestSiblingAnchorRange(c);
   if(siblingIdx >= 0) {
      int parent_id = (g_ranges[siblingIdx].parent_id > 0 ? g_ranges[siblingIdx].parent_id : g_ranges[siblingIdx].id);
      return AddRangeRecord(c, RANGE_SIBLING, parent_id);
   }
   return AddRangeRecord(c, RANGE_ROOT, -1);
}

bool BuildRangeCandidateAtOpenShift(const int openShift, SCandidate &c) {
   int bars = iBars(_Symbol, InpRangeTF);
   if(openShift + rangeBars >= bars)
      return false;
   c.t_start = iTime(_Symbol, InpRangeTF, openShift + rangeBars);
   if(g_lastRangeBreakTime != 0 && c.t_start <= g_lastRangeBreakTime)
      return false;
   int highShift = iHighest(_Symbol, InpRangeTF, MODE_HIGH, rangeBars, openShift + 1);
   int lowShift = iLowest(_Symbol, InpRangeTF, MODE_LOW, rangeBars, openShift + 1);
   if(highShift < 0 || lowShift < 0)
      return false;
   double hi = RangeNormalizePrice(iHigh(_Symbol, InpRangeTF, highShift));
   double lo = RangeNormalizePrice(iLow(_Symbol, InpRangeTF, lowShift));
   if((hi - lo) > RangePipsToPrice(maxRangePips))
      return false;
   c.t_end = iTime(_Symbol, InpRangeTF, openShift);
   c.born_bar_time = iTime(_Symbol, InpRangeTF, openShift);
   c.high = hi;
   c.low = lo;
   return true;
}

void AdvanceActiveRangeHistorical(const int barShift) {
   if(g_activeRangeIdx < 0)
      return;
   datetime barTime = iTime(_Symbol, InpRangeTF, barShift);
   if(g_ranges[g_activeRangeIdx].t_end != barTime)
      g_ranges[g_activeRangeIdx].t_end = barTime;
   double upper = g_ranges[g_activeRangeIdx].high + RangeBreakBuffer();
   double lower = g_ranges[g_activeRangeIdx].low - RangeBreakBuffer();
   bool broken = false;
   if(breakoutCandles <= 0) {
      double barHigh = RangeNormalizePrice(iHigh(_Symbol, InpRangeTF, barShift));
      double barLow = RangeNormalizePrice(iLow(_Symbol, InpRangeTF, barShift));
      if(barHigh > upper || barLow < lower)
         broken = true;
   } else {
      double barClose = RangeNormalizePrice(iClose(_Symbol, InpRangeTF, barShift));
      if(barClose > upper) {
         g_ranges[g_activeRangeIdx].consec_above++;
         g_ranges[g_activeRangeIdx].consec_below = 0;
      } else if(barClose < lower) {
         g_ranges[g_activeRangeIdx].consec_below++;
         g_ranges[g_activeRangeIdx].consec_above = 0;
      } else {
         g_ranges[g_activeRangeIdx].consec_above = 0;
         g_ranges[g_activeRangeIdx].consec_below = 0;
      }
      if(g_ranges[g_activeRangeIdx].consec_above >= breakoutCandles || g_ranges[g_activeRangeIdx].consec_below >= breakoutCandles)
         broken = true;
   }
   if(broken) {
      g_ranges[g_activeRangeIdx].state = RANGE_BROKEN;
      g_ranges[g_activeRangeIdx].t_end = barTime;
      g_lastRangeBreakTime = barTime;
      g_activeRangeIdx = -1;
   }
}

void AdvanceActiveRangeLive(const bool isNewTfBar) {
   if(g_activeRangeIdx < 0)
      return;
   bool changed = false;
   datetime currentOpen = iTime(_Symbol, InpRangeTF, 0);
   if(g_ranges[g_activeRangeIdx].t_end != currentOpen) {
      g_ranges[g_activeRangeIdx].t_end = currentOpen;
      changed = true;
   }
   double upper = g_ranges[g_activeRangeIdx].high + RangeBreakBuffer();
   double lower = g_ranges[g_activeRangeIdx].low - RangeBreakBuffer();
   bool broken = false;
   if(breakoutCandles <= 0) {
      double ask = RangeNormalizePrice(SymbolInfoDouble(_Symbol, SYMBOL_ASK));
      double bid = RangeNormalizePrice(SymbolInfoDouble(_Symbol, SYMBOL_BID));
      if(ask > upper || bid < lower) {
         g_ranges[g_activeRangeIdx].state = RANGE_BROKEN;
         g_ranges[g_activeRangeIdx].t_end = TimeCurrent();
         g_lastRangeBreakTime = g_ranges[g_activeRangeIdx].t_end;
         broken = true;
      }
   } else if(isNewTfBar) {
      double close1 = RangeNormalizePrice(iClose(_Symbol, InpRangeTF, 1));
      if(close1 > upper) {
         g_ranges[g_activeRangeIdx].consec_above++;
         g_ranges[g_activeRangeIdx].consec_below = 0;
      } else if(close1 < lower) {
         g_ranges[g_activeRangeIdx].consec_below++;
         g_ranges[g_activeRangeIdx].consec_above = 0;
      } else {
         g_ranges[g_activeRangeIdx].consec_above = 0;
         g_ranges[g_activeRangeIdx].consec_below = 0;
      }
      if(g_ranges[g_activeRangeIdx].consec_above >= breakoutCandles || g_ranges[g_activeRangeIdx].consec_below >= breakoutCandles) {
         g_ranges[g_activeRangeIdx].state = RANGE_BROKEN;
         g_ranges[g_activeRangeIdx].t_end = currentOpen;
         g_lastRangeBreakTime = currentOpen;
         broken = true;
      }
      changed = true;
   }
   if(broken) {
      RenderRangeRecord(g_ranges[g_activeRangeIdx]);
      ChartRedraw();
      g_activeRangeIdx = -1;
   } else if(changed) {
      RenderRangeRecord(g_ranges[g_activeRangeIdx]);
      ChartRedraw();
   }
}

bool DetectNewRangeTfBar() {
   datetime currentBar = iTime(_Symbol, InpRangeTF, 0);
   if(currentBar == 0)
      return false;
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

void BuildRangeHistory() {
   DeleteRangeObjects();
   ResetRangeEngine();
   if(!RangeEnoughBars())
      return;
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
      for(int j = 0; j < k; j++) {
         if(sum_v[j] > 0.0)
            centroids[j] = sum_pv[j] / sum_v[j];
      }
   }

   ArrayResize(mem_centroids, k);
   ArrayCopy(mem_centroids, centroids);
}

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[], const double &high[], const double &low[], const double &close[], const long &tick_volume[], const long &volume[], const int &spread[]) {
   if(rangeBars >= 2 && RangeEnoughBars()) {
      if(!g_range_history_built || prev_calculated == 0) {
         BuildRangeHistory();
      } else {
         bool isNewRangeTfBar = DetectNewRangeTfBar();
         if(g_activeRangeIdx != -1)
            AdvanceActiveRangeLive(isNewRangeTfBar);
         if(g_activeRangeIdx == -1 && isNewRangeTfBar) {
            SCandidate c;
            if(BuildRangeCandidateAtOpenShift(0, c)) {
               g_activeRangeIdx = ProcessRangeCandidate(c);
               RenderRangeRecord(g_ranges[g_activeRangeIdx]);
               ChartRedraw();
            }
         }
      }
   }

   if(rates_total < 2)
      return 0;

   static uint last_update_time = 0;
   uint current_time = GetTickCount();
   if(rates_total == prev_calculated && (current_time - last_update_time) < InpRefreshRate)
      return rates_total;
   last_update_time = current_time;

   MqlRates src_rates[];
   int bars_needed = InpLookback + 2;
   int copied = CopyRates(_Symbol, g_calc_tf, 0, bars_needed, src_rates);
   if(copied < InpLookback + 1)
      return prev_calculated;

   ArraySetAsSeries(time, true);
   ArraySetAsSeries(src_rates, true);

   int lookback = MathMin(InpLookback, copied - 1);
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
   datetime vpStartTime = time[0] + (datetime)(InpVPOffset * g_chart_period_sec);

   int cur_dots = 0, cur_boxes = 0, cur_lines = 0, cur_txt_poc = 0, cur_txt_tot = 0, cur_txt_vel = 0;
   int reservedForMetrics = (activeClusterCount + (useExtremeZones ? 2 : 0)) * 2;
   int maxObjects = 500;

   double clusterPoc[];
   ArrayResize(clusterPoc, MAX_CLUSTERS);
   ArrayInitialize(clusterPoc, EMPTY_VALUE);

   double zonePoc[];
   double zoneRange[];
   double zoneMass[];
   double zoneBinSize[];
   double zonePocVol[];
   datetime zoneEndTime[];
   bool zoneValid[];
   ArrayResize(zonePoc, MAX_CLUSTERS);
   ArrayResize(zoneRange, MAX_CLUSTERS);
   ArrayResize(zoneMass, MAX_CLUSTERS);
   ArrayResize(zoneBinSize, MAX_CLUSTERS);
   ArrayResize(zonePocVol, MAX_CLUSTERS);
   ArrayResize(zoneEndTime, MAX_CLUSTERS);
   ArrayResize(zoneValid, MAX_CLUSTERS);
   ArrayInitialize(zonePoc, 0.0);
   ArrayInitialize(zoneRange, 0.0);
   ArrayInitialize(zoneMass, 0.0);
   ArrayInitialize(zoneBinSize, 0.0);
   ArrayInitialize(zonePocVol, 0.0);
   ArrayInitialize(zoneEndTime, 0);
   for(int i = 0; i < MAX_CLUSTERS; i++)
      zoneValid[i] = false;

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
         if(assignments[i] == c_id) {
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

         if(isPoc) {
            double pocY = (b_top + b_bottom) / 2.0;
            clusterPoc[c_id] = pocY;
            double cur_range = c_max - c_min;

            LevelStates[c_id].synthetic = false;
            LevelStates[c_id].activated = true;
            LevelStates[c_id].source_slot = -1;

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

            zoneValid[c_id] = true;
            zonePoc[c_id] = pocY;
            zoneRange[c_id] = cur_range;
            zoneMass[c_id] = c_total_vol;
            zoneBinSize[c_id] = binSize;
            zonePocVol[c_id] = vol;
            zoneEndTime[c_id] = endXTime;

            ENUM_LEVEL_STATE status = LevelStates[c_id].status;
            int line_style = STYLE_DASH;
            int line_width = 2;
            color state_color = clusterColor;
            color text_color = ReadableTextColor(clusterColor);
            color poc_fill_color = clusterColor;
            color poc_border_color = clusterColor;

            ResolveStateVisuals(status, clusterColor, state_color, text_color, poc_fill_color, poc_border_color, line_style, line_width);

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
         if(!zoneValid[i])
            continue;

         if(lowestIdx < 0 || zonePoc[i] < zonePoc[lowestIdx]) {
            secondLowestIdx = lowestIdx;
            lowestIdx = i;
         } else if(secondLowestIdx < 0 || zonePoc[i] < zonePoc[secondLowestIdx]) {
            secondLowestIdx = i;
         }

         if(highestIdx < 0 || zonePoc[i] > zonePoc[highestIdx]) {
            secondHighestIdx = highestIdx;
            highestIdx = i;
         } else if(secondHighestIdx < 0 || zonePoc[i] > zonePoc[secondHighestIdx]) {
            secondHighestIdx = i;
         }
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
   ChartRedraw();
   return rates_total;
}
//+------------------------------------------------------------------+

