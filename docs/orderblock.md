//+------------------------------------------------------------------+
//|                Order Block Retouch Strategy EA.mq5               |
//|                 (Integrated with MQLTA Template)                 |
//|                      Copyright 2025, Allan Munene Mutiiria & MQLTA.                       |
//|                         https://t.me/Forex_Algo_Trader           |
//+------------------------------------------------------------------+
#property copyright "Forex Algo-Trader, Allan & MQLTA"
#property link      "https://t.me/Forex_Algo_Trader"
#property version   "2.1" // Version reflects VWAP integration
#property strict

//-INCLUDES-//
// '#include' allows to import code from other files.
// In the following instance the file has to be placed in the MQL5\Include folder.
#include <Trade\Trade.mqh> // This file is required to easily manage orders and positions.
#include <MQLTA ErrorHandling.mqh> // This file contains useful descriptions for errors.
#include <MQLTA Utils.mqh> // This file contains some useful functions.

//-COMMENTS-//
/* This EA is a combination of the Order Block Retouch Strategy and the MQLTA EA Template. */

enum ENUM_RISK_BASE
{
    RISK_BASE_EQUITY = 1,     // EQUITY
    RISK_BASE_BALANCE = 2,    // BALANCE
    RISK_BASE_FREEMARGIN = 3, // FREE MARGIN
};

enum ENUM_RISK_DEFAULT_SIZE
{
    RISK_DEFAULT_FIXED = 1,   // FIXED SIZE
    RISK_DEFAULT_AUTO = 2,    // AUTOMATIC SIZE BASED ON RISK
};

enum ENUM_MODE_SL
{
    SL_FIXED = 0,             // FIXED STOP LOSS
    SL_AUTO = 1,              // AUTOMATIC STOP LOSS
};

enum ENUM_MODE_TP
{
    TP_FIXED = 0,             // FIXED TAKE PROFIT
    TP_AUTO = 1,              // AUTOMATIC TAKE PROFIT
};

// In "Invalidation options"
input bool enableBreakerFlip = true;  // Flip OB to opposite regime on invalidation

// EA Parameters
input string Comment_0 = "======== Order Block Strategy Parameters ========";
input int    consolidationBars        = 7;      // Number of bars to define a consolidation range
input double maxConsolidationSpread   = 50;     // Maximum range in points for a valid consolidation
input int    barsToWaitAfterBreakout  = 3;      // Bars to wait after breakout to confirm impulse
input double impulseMultiplier        = 1.0;    // How strong the impulse move must be (Range * Multiplier)
input double relationTolerancePips    = 0.2;    // Price tolerance used in overlap logic
input double sameOverlapMin           = 0.80;   // SAME if overlap/min(width) >= this
input double sameMidpointMaxWidthFrac = 0.25;   // SAME if midpoint distance <= this * max(width)
input double childMaxWidthParentFrac  = 0.85;   // CHILD if narrower than parent by this ratio
input double siblingOverlapMin        = 0.35;   // SIBLING if overlap/min(width) >= this
input double siblingMidpointMinFrac   = 0.20;   // SIBLING if midpoint shift >= this * max(width)
input double siblingMidpointMaxFrac   = 1.25;   // SIBLING if midpoint shift <= this * max(width)

// Visualization
input color  bullishColor             = clrGreen;   // Color for bullish order blocks
input color  bearishColor             = clrRed;     // Color for bearish order blocks
input color  labelTextColor           = clrBlack;   // Color for block labels

// Invalidation options
input bool   enableInvalidationFilter = true;      // Invalidate if price closes on the opposite side of the block
input color  invalidationFlagColor    = clrOrange;  // Color for the 'Invalidated' text flag
input bool   enableAgeInvalidation    = false;     // Enable N-candle age invalidation
input int    maxZoneAgeCandles        = 50;        // Invalidate zone after this many candles from its creation

// Trade control
input bool   allowMultipleEntries     = false;     // Allow a zone to trigger multiple trades (otherwise one per zone)

input string Comment_1 = "======== Trading Hours Settings ========";
input bool UseTradingHours = false;     // Limit trading hours
input ENUM_HOUR TradingHourStart = h07; // Trading start hour (Broker server hour)
input ENUM_HOUR TradingHourEnd = h19;   // Trading end hour (Broker server hour)

input string Comment_2 = "======== ATR Settings (for Auto SL/TP) ========";
input int ATRPeriod = 100;              // ATR period
input ENUM_TIMEFRAMES ATRTimeFrame = PERIOD_CURRENT; // ATR timeframe
input double ATRMultiplierSL = 2;       // ATR multiplier for stop-loss
input double ATRMultiplierTP = 3;       // ATR multiplier for take-profit

// General input parameters
input string Comment_a = "======== Risk Management Settings ========";
input ENUM_RISK_DEFAULT_SIZE RiskDefaultSize = RISK_DEFAULT_FIXED; // Position size mode
input double DefaultLotSize = 0.01;                                // Position size (if fixed or if no stop loss defined)
input ENUM_RISK_BASE RiskBase = RISK_BASE_BALANCE;                 // Risk base
input int MaxRiskPerTrade = 2;                                     // Percentage to risk each trade
input double MinLotSize = 0.01;                                    // Minimum position size allowed
input double MaxLotSize = 100;                                     // Maximum position size allowed
input int MaxPositions = 1;                                        // Maximum number of positions for this EA
input bool EnableBreakEven = false;     // Enable/disable Break Even
input double BreakEvenDistance = 100;  // Break even in pips

input string Comment_b = "======== Stop-Loss and Take-Profit Settings ========";
input ENUM_MODE_SL StopLossMode = SL_FIXED;                        // Stop-loss mode
input int DefaultStopLoss = 1500;                                  // Default stop-loss in points (Strategy default = 1500)
input int MinStopLoss = 0;                                         // Minimum allowed stop-loss in points
input int MaxStopLoss = 5000;                                      // Maximum allowed stop-loss in points
input ENUM_MODE_TP TakeProfitMode = TP_FIXED;                      // Take-profit mode
input int DefaultTakeProfit = 1500;                                // Default take-profit in points (Strategy default = 1500)
input int MinTakeProfit = 0;                                       // Minimum allowed take-profit in points
input int MaxTakeProfit = 5000;                                      // Maximum allowed take-profit in points

input string Comment_c = "======== Partial Close Settings ========";
input bool UsePartialClose = false;                                // Use partial close
input double PartialClosePerc = 50;                                // Partial close percentage
input double ATRMultiplierPC = 1;                                  // ATR multiplier for partial close

input string Comment_d = "======== Additional Settings ========";
input int MagicNumber = 12345;                                     // Magic number (Strategy default = 12345)
input string OrderNote = "Order Block";                            // Comment for orders
input int Slippage = 5;                                            // Slippage in points
input int MaxSpread = 50;                                          // Maximum allowed spread to trade, in points

input string Comment_e = "======== Simple Trailing Stop Settings ========";
input bool   EnableSimpleTrailingStop = true;    // Enable/disable simple point-based trailing stop
input double TrailingStopPoints       = 30;      // Distance in points to trail the price
input double MinProfitToTrail         = 50;      // Minimum profit in points before trailing begins

// Indicator-based Trailing Stop Settings (Optional, can be used instead of or with simple trailing)
input string Comment_f = "======== MA Trailing Stop Settings ========";
input bool EnableTrailing = false;                // Enable Trailing Stop
input int MAPeriod = 14;                          // MA Period
input ENUM_MA_METHOD MAMethod = MODE_SMA;         // MA Method
input ENUM_APPLIED_PRICE MAApplyPrice = PRICE_CLOSE; // MA Applied Price
input int Shift = 0;                              // Shift In The MA Value (0=Current Candle)

input string Comment_g = "======== PSAR Trailing Stop Settings ========";
input bool EnablePSARTrailing = false; // Enable PSAR Trailing Stop
input double PSARStep = 0.02;          // PSAR Step
input double PSARMaximum = 0.2;        // PSAR Maximum

input string Comment_k = "======== AMA Trailing Stop Settings ========";
input bool EnableAMATrailing = false;        // Enable AMA Trailing Stop
input int AMATrailingPeriod = 14;            // AMA Period
input int AMATrailingFastEMA = 2;            // AMA Fast EMA
input int AMATrailingSlowEMA = 30;           // AMA Slow EMA
input int AMATrailingSignal = 2;             // AMA Signal Smoothing
input int AMATrailingApplyPrice = PRICE_CLOSE; // AMA Applied Price
input int AMATrailingShift = 0;              // Shift In The AMA Value (0=Current Candle)

input string Comment_l = "======== Fractal Trailing Stop Settings ========";
input bool EnableFractalTrailing = false; // Enable Fractal Trailing Stop
input int BarsToScan = 10; // Bars To Scan (10=Last Ten Candles)
input int FractalToUse = 1; // Fractal Number to Use (1 = First, 2 = Second, ...)
input int FractalTrailingShift = 0; // Shift In The Fractal Value (0=Current Candle)
input int FractalApplyPrice = PRICE_CLOSE; // Applied Price

input int TrailingStartProfit = 0; // Start indicator trailing after this many points in profit

// --- VWAP FILTER SETTINGS ---
input string Comment_h = "======== VWAP Filter Settings ========";
input bool    UseDailyVWAPFilter  = true; // Enable/Disable Daily VWAP Filter (Buffer 0)
input bool    UseWeeklyVWAPFilter = true; // Enable/Disable Weekly VWAP Filter (Buffer 1)

// --- DeMarker Filter SETTINGS ---
input string Comment_i = "======== DeMarker Filter Settings ========";
input bool    UseDeMarkerFilter    = true;       // Enable/Disable DeMarker Filter
input int     DeMarkerPeriod       = 14;         // DeMarker Period
input double  DeMarkerOverbought   = 0.70;       // DeMarker Overbought Level
input double  DeMarkerOversold     = 0.30;       // DeMarker Oversold Level
input bool    InvertDeMarkerLogic  = true;       // Invert: Only longs in oversold, only shorts in overbought

// Global Variables
CTrade Trade; // Trade object.
int ATRHandle; // Indicator handle for ATR.
int IndicatorHandle = -1; // Global indicator handle for the EA's main signal indicator (not used by this strategy).
int MAHandle;  // Handle for the Moving Average indicator
int PSARHandle;  // Handle for the PSAR indicator
int AMAHandle; // Handle for the Adaptive Moving Average (AMA) indicator
int FractalHandle; // Handle for the Fractal indicator
double ATR_current, ATR_previous; // ATR values.
double Indicator_current, Indicator_previous; // Indicator values (not used by this strategy).

// --- VWAP Filter Globals ---
int    g_dailyVWAPHandle  = INVALID_HANDLE;
int    g_weeklyVWAPHandle = INVALID_HANDLE;
double g_dailyVWAPBuffer[];
double g_weeklyVWAPBuffer[];

// --- DeMarker Filter Globals ---
int    g_deMarkerHandle = INVALID_HANDLE;
double g_deMarkerBuffer[];

// --- Order Block Strategy Globals ---
bool  flippedStatus[];        // true if this block has been flipped once (breaker)

struct PriceAndIndex
{
   double price;
   int    index;
};

PriceAndIndex rangeHighestHigh = {0,0};
PriceAndIndex rangeLowestLow   = {0,0};

bool     isBreakoutDetected   = false;
double   lastImpulseLow       = 0.0;
double   lastImpulseHigh      = 0.0;
int      breakoutBarNumber    = -1;
datetime breakoutTimestamp    = 0;

string   blockNames[];          // rectangle object names
string   blockTypes[];          // "OB-bullish" | "OB-bearish"
string   blockLabels[];         // label object names
datetime creationTimes[];

bool     confirmedStatus[];     // set true when price returns into zone
int      entryCount[];          // count of entries taken from this zone
bool     invalidatedStatus[];   // set true when zone is invalidated (by close or age)

#define OB_Prefix "OB REC "
// --- End Order Block Strategy Globals ---


//+------------------------------------------------------------------+
//| Expert initialization handler                                    |
//+------------------------------------------------------------------+
int OnInit()
{
    if (!Prechecks()) // Check if everything is OK with input parameters.
    {
        return INIT_FAILED; // Don't initialize the EA if checks fail.
    }

    if (!InitializeHandles()) // Initialize indicator handles.
    {
        PrintFormat("Error initializing indicator handles - %s - %d", GetLastErrorText(GetLastError()), GetLastError());
        return INIT_FAILED;
    }
    
    // --- Initialize VWAP Filters ---
    if(!InitializeVWAPFilters())
    {
        Print("Failed to initialize VWAP filters.");
        return INIT_FAILED;
    }

    // --- Initialize DeMarker Filter ---
    if(!InitializeDeMarkerFilter())
    {
        Print("Failed to initialize DeMarker filter.");
        return INIT_FAILED;
    }

     // Initialize the Moving Average handle for trailing stop
    MAHandle = iMA(_Symbol, PERIOD_CURRENT, MAPeriod, 0, MAMethod, MAApplyPrice);
    
    // Initialize the PSAR handle for trailing stop
    PSARHandle = iSAR(_Symbol, PERIOD_CURRENT, PSARStep, PSARMaximum);

    // Initialize the AMA handle for trailing stop
    AMAHandle = iAMA(_Symbol, PERIOD_CURRENT, AMATrailingPeriod, AMATrailingFastEMA, AMATrailingSlowEMA, AMATrailingSignal, AMATrailingApplyPrice);

    // Initialize the Fractal handle for trailing stop
    FractalHandle = iFractals(_Symbol, PERIOD_CURRENT);

    SetTradeObject();

    return INIT_SUCCEEDED; // Successful initialization.
}

//+---------------------------------------------------------------------+
//| Expert deinitialization handler                                     |
//+---------------------------------------------------------------------+
void OnDeinit(const int reason)
{
    // Clean up all order block objects from the chart
    ObjectsDeleteAll(0, OB_Prefix);
    ChartRedraw(0);
    
    // Deinitialize VWAP filter handles
    DeinitializeVWAPFilters();
    
    // Deinitialize DeMarker filter
    DeinitializeDeMarkerFilter();
}

//+------------------------------------------------------------------+
//| Expert tick handler                                              |
//+------------------------------------------------------------------+
void OnTick()
{
    // --- Trade Management ---
    BreakEvenLogic();

    if (EnableSimpleTrailingStop)
    {
       SimpleTrailingStop();
    }
    if (EnableTrailing)
    {
        TrailingStop();
    }
    if (EnablePSARTrailing)
    {
        PSARTrailingStop();
    }
    if (EnableAMATrailing)
    {
        AMATrailingStop();
    }
    if (EnableFractalTrailing)
    {
        FractalTrailingStop();
    }

    // --- Core Strategy Logic ---
    ProcessTick();
}

//+------------------------------------------------------------------+
//| Timer event handler                                              |
//+------------------------------------------------------------------+
void OnTimer()
{
    // Not used by this strategy.
}

//+------------------------------------------------------------------------------+
//| Trade event handler                                                          |
//+------------------------------------------------------------------------------+
void OnTrade()
{
    // Not used by this strategy.
}

//+--------------------------------------------------------------------------------+
//| Backtest end handler                                                           |
//+--------------------------------------------------------------------------------+
double OnTester()
{
    double NetProfit = TesterStatistics(STAT_PROFIT);
    double InitialDeposit = TesterStatistics(STAT_INITIAL_DEPOSIT);
    double MaxDrawDownPerc = TesterStatistics(STAT_EQUITYDD_PERCENT);
    double TotalTrades = TesterStatistics(STAT_TRADES);
    if (InitialDeposit == 0) return 0; // Avoiding division by zero.
    if (TotalTrades == 0) return -100; // Discard a backtest with zero trades.
    if ((TotalTrades > 0) && (MaxDrawDownPerc == 0)) MaxDrawDownPerc = 0.01; // Avoiding division by zero.
    
    double NetProfitPerc = NetProfit / InitialDeposit * 100;

    double Max = 0;
    if (NetProfitPerc > 0) Max = NetProfitPerc / MaxDrawDownPerc; // Adjust net profit by maximum drawdown.
    if (NetProfitPerc < 0) Max = NetProfitPerc;

    return Max; // Return the value as a custom optimization criterion.
}

//+------------------------------------------------------------------+
//|                   CORE STRATEGY LOGIC                            |
//+------------------------------------------------------------------+
void ProcessTick()
{
    // New bar check to run logic only once per bar
    static int prevBars = 0;
    int barsNow = iBars(_Symbol, _Period);
    if(barsNow == prevBars) return;
    prevBars = barsNow;
    
    // Manage existing positions before checking for new entries
    if (CountPositions())
    {
        if (UsePartialClose) PartialCloseAll();
        // This strategy does not have a signal-based exit, it relies on SL/TP.
        // CheckExitSignal(); 
    }

    //--- The following is the Order Block Retouch Strategy logic ---

    int startBarIndex = 1;
    int chartScale = (int)ChartGetInteger(0, CHART_SCALE);
    int dynamicFontSize = 8 + (chartScale * 2);

    // 1) Build consolidation range if none is active
    if(rangeHighestHigh.price == 0 && rangeLowestLow.price == 0)
    {
       bool consolidated = true;
       for(int i = startBarIndex; i < startBarIndex + consolidationBars - 1; i++)
       {
          if(MathAbs(high(i) - high(i+1)) > maxConsolidationSpread * _Point ||
             MathAbs(low(i)  - low(i+1))  > maxConsolidationSpread * _Point)
          {
             consolidated = false;
             break;
          }
       }

       if(consolidated)
       {
          rangeHighestHigh.price = high(startBarIndex);
          rangeHighestHigh.index = startBarIndex;
          for(int i = startBarIndex + 1; i < startBarIndex + consolidationBars; i++)
          {
             if(high(i) > rangeHighestHigh.price)
             {
                rangeHighestHigh.price = high(i);
                rangeHighestHigh.index = i;
             }
          }

          rangeLowestLow.price = low(startBarIndex);
          rangeLowestLow.index = startBarIndex;
          for(int i = startBarIndex + 1; i < startBarIndex + consolidationBars; i++)
          {
             if(low(i) < rangeLowestLow.price)
             {
                rangeLowestLow.price = low(i);
                rangeLowestLow.index = i;
             }
          }
       }
    }

    // 2) Detect breakout from the built range
    if(rangeHighestHigh.price > 0 && rangeLowestLow.price > 0)
    {
       double c1 = close(1);
       if(c1 > rangeHighestHigh.price || c1 < rangeLowestLow.price)
       {
          isBreakoutDetected = true;
       }
    }

    // 3) Register breakout window and set impulse anchors
    if(isBreakoutDetected)
    {
       breakoutBarNumber = 1;
       breakoutTimestamp = TimeCurrent();
       lastImpulseHigh   = rangeHighestHigh.price;
       lastImpulseLow    = rangeLowestLow.price;

       // reset range so a new one can form later
       isBreakoutDetected        = false;
       rangeHighestHigh.price    = 0;
       rangeHighestHigh.index    = 0;
       rangeLowestLow.price      = 0;
       rangeLowestLow.index      = 0;
    }

    // 4) After waiting window, decide if an impulsive move occurred and draw OB
    if(breakoutBarNumber >= 0 && TimeCurrent() > breakoutTimestamp + barsToWaitAfterBreakout * PeriodSeconds())
    {
       double impulseRange          = lastImpulseHigh - lastImpulseLow;
       double impulseThresholdPrice = impulseRange * impulseMultiplier;

       bool bullishImpulse = false;
       bool bearishImpulse = false;

       for(int i=1; i<=barsToWaitAfterBreakout; i++)
       {
          double c = close(i);
          if(c >= lastImpulseHigh + impulseThresholdPrice) { bullishImpulse = true; break; }
          if(c <= lastImpulseLow  - impulseThresholdPrice) { bearishImpulse = true; break; }
       }

       if(bullishImpulse || bearishImpulse)
       {
          datetime blockStartTime  = iTime(_Symbol, _Period, consolidationBars + barsToWaitAfterBreakout + 1);
          datetime blockEndTime    = iTime(_Symbol, _Period, 0) + PeriodSeconds(); // Extend to end of current bar

          double blockTopPrice     = OBNormalizePrice(MathMax(lastImpulseHigh, lastImpulseLow));
          double blockBottomPrice  = OBNormalizePrice(MathMin(lastImpulseHigh, lastImpulseLow));

          string blockName         = OB_Prefix + "(" + TimeToString(blockStartTime) + ")";
          string blockType         = bullishImpulse ? "OB-bullish" : "OB-bearish";
          color  baseColor         = bullishImpulse ? bullishColor : bearishColor;
          string baseLabel         = bullishImpulse ? "Bullish Order Block" : "Bearish Order Block";
          string blockingBlockName = "";

          if(ObjectFind(0, blockName) < 0 && !FindBlockingOrderBlock(blockTopPrice, blockBottomPrice, blockingBlockName))
          {
             ObjectCreate(0, blockName, OBJ_RECTANGLE, 0, blockStartTime, blockTopPrice, blockEndTime, blockBottomPrice);
             ObjectSetInteger(0, blockName, OBJPROP_TIME, 0, blockStartTime);
             ObjectSetDouble (0, blockName, OBJPROP_PRICE, 0, blockTopPrice);
             ObjectSetInteger(0, blockName, OBJPROP_TIME, 1, blockEndTime);
             ObjectSetDouble (0, blockName, OBJPROP_PRICE, 1, blockBottomPrice);
             ObjectSetInteger(0, blockName, OBJPROP_FILL, true);
             ObjectSetInteger(0, blockName, OBJPROP_COLOR, baseColor);
             ObjectSetInteger(0, blockName, OBJPROP_BACK,  true);

             datetime labelTime  = blockStartTime + (blockEndTime - blockStartTime)/2;
             double   labelPrice = (blockTopPrice + blockBottomPrice)/2.0;
             string   labelName  = blockName + " Label";
             ObjectCreate(0, labelName, OBJ_TEXT, 0, labelTime, labelPrice);
             ObjectSetString (0, labelName, OBJPROP_TEXT, baseLabel);
             ObjectSetInteger(0, labelName, OBJPROP_COLOR, labelTextColor);
             ObjectSetInteger(0, labelName, OBJPROP_FONTSIZE, dynamicFontSize);
             ObjectSetInteger(0, labelName, OBJPROP_ANCHOR, ANCHOR_CENTER);

             // … after creating the rectangle and label …
             ArrayResize(blockNames,         ArraySize(blockNames)+1);
             ArrayResize(blockTypes,         ArraySize(blockTypes)+1);
             ArrayResize(blockLabels,        ArraySize(blockLabels)+1);
             ArrayResize(creationTimes,      ArraySize(creationTimes)+1);
             ArrayResize(confirmedStatus,    ArraySize(confirmedStatus)+1);
             ArrayResize(entryCount,         ArraySize(entryCount)+1);
             ArrayResize(invalidatedStatus,  ArraySize(invalidatedStatus)+1);
             ArrayResize(flippedStatus,      ArraySize(flippedStatus)+1);

             int idx = ArraySize(blockNames)-1;
             blockNames[idx]        = blockName;
             blockTypes[idx]        = blockType;
             blockLabels[idx]       = labelName;
             creationTimes[idx]     = time(1);
             confirmedStatus[idx]   = false;
             entryCount[idx]        = 0;
             invalidatedStatus[idx] = false;
             flippedStatus[idx]     = false;

             ChartRedraw(0);
          }
          else if(blockingBlockName != "")
          {
             PrintFormat("Skipped order block %s because it overlaps existing block %s.", blockName, blockingBlockName);
          }
       }

       // reset impulse anchors
       breakoutBarNumber = -1;
       breakoutTimestamp = 0;
       lastImpulseHigh   = 0;
       lastImpulseLow    = 0;
    }

    // 5) Per-block maintenance: age invalidation, opposite-side invalidation, confirmation, then entry
    for(int j = ArraySize(blockNames)-1; j >= 0; j--)
    {
       string   name         = blockNames[j];

       // --- NEW: Check for manual deletion and extend active zones ---
       if(ObjectFind(0, name) < 0)
       {
          // Object was likely deleted manually. Clean up tracking arrays.
          ObjectDelete(0, blockLabels[j]); // Ensure label is also gone
          ArrayRemove(blockNames,         j, 1);
          ArrayRemove(blockTypes,         j, 1);
          ArrayRemove(blockLabels,        j, 1);
          ArrayRemove(creationTimes,      j, 1);
          ArrayRemove(confirmedStatus,    j, 1);
          ArrayRemove(entryCount,         j, 1);
          ArrayRemove(invalidatedStatus,  j, 1);
          ArrayRemove(flippedStatus,      j, 1);
          continue; // Skip to the next block in the array
       }

       // Extend the zone to the current bar
       datetime new_right_edge = iTime(_Symbol, _Period, 0) + PeriodSeconds();
       ObjectSetInteger(0, name, OBJPROP_TIME, 1, new_right_edge);

       // Also reposition the label to stay centered horizontally
       string labelName = blockLabels[j];
       if(ObjectFind(0, labelName) >= 0)
       {
          datetime blockStart = (datetime)ObjectGetInteger(0, name, OBJPROP_TIME, 0);
          datetime labelTime = blockStart + (new_right_edge - blockStart) / 2;
          ObjectSetInteger(0, labelName, OBJPROP_TIME, 0, labelTime);
       }
       // --- END NEW LOGIC ---
       
       // Get current block properties for further processing
       double   blockHigh    = ObjectGetDouble(0, name, OBJPROP_PRICE, 0);
       double   blockLow     = ObjectGetDouble(0, name, OBJPROP_PRICE, 1);


       // A) Age-based invalidation (if enabled)
       if(enableAgeInvalidation && !invalidatedStatus[j])
       {
          int barsElapsed = iBarShift(_Symbol, _Period, creationTimes[j], false);
          if(barsElapsed > maxZoneAgeCandles)
          {
             invalidatedStatus[j] = true;

             string invName = name + "_age_invalid_flag";
             double mid = (blockHigh + blockLow)/2.0;
             if(ObjectFind(0, invName) < 0)
             {
                ObjectCreate(0, invName, OBJ_TEXT, 0, time(1), mid);
                ObjectSetString (0, invName, OBJPROP_TEXT, "Age Invalidated");
                ObjectSetInteger(0, invName, OBJPROP_COLOR, invalidationFlagColor);
                ObjectSetInteger(0, invName, OBJPROP_FONTSIZE, dynamicFontSize);
                ObjectSetInteger(0, invName, OBJPROP_ANCHOR, ANCHOR_CENTER);
             }

             string lblText = (blockTypes[j]=="OB-bullish") ? "Bullish Block Age Inv" : "Bearish Block Age Inv";
             ObjectSetString(0, blockLabels[j], OBJPROP_TEXT, lblText);
             ChartRedraw(0);
          }
       }

       // === DELETE INVALIDATED BLOCKS (NEW SECTION) ===
       if(invalidatedStatus[j] && ObjectFind(0, blockNames[j]) >= 0)
       {
          ObjectDelete(0, blockNames[j]);
          ObjectDelete(0, blockLabels[j]);
          ObjectDelete(0, blockNames[j] + "_invalidflag");
          ObjectDelete(0, blockNames[j] + "_age_invalid_flag");
          ObjectDelete(0, blockNames[j] + "_flipflag");
          ObjectDelete(0, blockNames[j] + "_confirm_flag");
          
          ArrayRemove(blockNames,         j, 1);
          ArrayRemove(blockTypes,         j, 1);
          ArrayRemove(blockLabels,        j, 1);
          ArrayRemove(creationTimes,      j, 1);
          ArrayRemove(confirmedStatus,    j, 1);
          ArrayRemove(entryCount,         j, 1);
          ArrayRemove(invalidatedStatus,  j, 1);
          ArrayRemove(flippedStatus,      j, 1);
          
          ChartRedraw(0);
          continue;
       }

       // B) Opposite-side close invalidation (flip-first if enabled)
       if (enableInvalidationFilter && !invalidatedStatus[j])
       {
          bool invalid = false;
          if (blockTypes[j] == "OB-bearish" && close(1) > blockHigh) invalid = true;
          if (blockTypes[j] == "OB-bullish" && close(1) < blockLow)  invalid = true;

          if (invalid)
          {
             if (enableBreakerFlip && !flippedStatus[j])
             {
                // Flip once to opposite regime (breaker)
                string newType = (blockTypes[j] == "OB-bullish") ? "OB-bearish" : "OB-bullish";
                blockTypes[j]     = newType;
                flippedStatus[j]  = true;
                confirmedStatus[j]= false;       // require new retouch confirmation
                entryCount[j]     = 0;           // reset entries for the new regime

                color newColor = (newType == "OB-bullish") ? bullishColor : bearishColor;
                ObjectSetInteger(0, name, OBJPROP_COLOR, newColor);

                // Update label to show breaker status
                string breakerText = (newType == "OB-bullish") ? "Bullish Breaker" : "Bearish Breaker";
                ObjectSetString(0, blockLabels[j], OBJPROP_TEXT, breakerText);

                // Optional flip flag
                string flipFlag = name + "_flipflag";
                double mid = (blockHigh + blockLow) / 2.0;
                if (ObjectFind(0, flipFlag) < 0)
                {
                   ObjectCreate(0, flipFlag, OBJ_TEXT, 0, time(1), mid);
                   ObjectSetString(0, flipFlag, OBJPROP_TEXT, "Flipped");
                   ObjectSetInteger(0, flipFlag, OBJPROP_COLOR, invalidationFlagColor);
                   ObjectSetInteger(0, flipFlag, OBJPROP_FONTSIZE, dynamicFontSize);
                   ObjectSetInteger(0, flipFlag, OBJPROP_ANCHOR, ANCHOR_CENTER);
                }
                ChartRedraw(0);
             }
             else
             {
                // Final invalidation (dead zone)
                invalidatedStatus[j] = true;

                string invName = name + "_invalidflag";
                double mid = (blockHigh + blockLow) / 2.0;
                if (ObjectFind(0, invName) < 0)
                {
                   ObjectCreate(0, invName, OBJ_TEXT, 0, time(1), mid);
                   ObjectSetString(0, invName, OBJPROP_TEXT, flippedStatus[j] ? "Final Invalidated" : "Invalidated");
                   ObjectSetInteger(0, invName, OBJPROP_COLOR, invalidationFlagColor);
                   ObjectSetInteger(0, invName, OBJPROP_FONTSIZE, dynamicFontSize);
                   ObjectSetInteger(0, invName, OBJPROP_ANCHOR, ANCHOR_CENTER);
                }

                string lblText = (blockTypes[j] == "OB-bullish") ? "Bullish Block Invalidated" : "Bearish Block Invalidated";
                ObjectSetString(0, blockLabels[j], OBJPROP_TEXT, lblText);
                ChartRedraw(0);
             }
          }
       }

       // C) Confirmation: first return into zone sets the flag
       if(!confirmedStatus[j] && !invalidatedStatus[j])
       {
          bool insideNow = (close(1) <= blockHigh && close(1) >= blockLow);
          if(insideNow)
          {
             confirmedStatus[j] = true;

             string flagName = name + "_confirm_flag";
             if(ObjectFind(0, flagName) < 0)
             {
                double mid = (blockHigh + blockLow)/2.0;
                ObjectCreate(0, flagName, OBJ_ARROW, 0, time(1), mid);
                int code = (blockTypes[j] == "OB-bullish") ? 233 : 234;
                ObjectSetInteger(0, flagName, OBJPROP_ARROWCODE, code);
                ObjectSetInteger(0, flagName, OBJPROP_COLOR, DarkenColor((blockTypes[j]=="OB-bullish")?bullishColor:bearishColor, 0.6));
                ObjectSetInteger(0, flagName, OBJPROP_ANCHOR, ANCHOR_CENTER);
             }

             string newText = (blockTypes[j]=="OB-bullish") ? "Bullish Block Confirmed" : "Bearish Block Confirmed";
             ObjectSetString(0, blockLabels[j], OBJPROP_TEXT, newText);
             ChartRedraw(0);
          }
       }
       
       // D) Entry: after confirmed, in original direction, on correct close, not invalid, respecting single/multi entry setting
       // Trading hours restrictions for entry.
       if ((UseTradingHours) && (!IsCurrentTimeInInterval(TradingHourStart, TradingHourEnd))) continue;

       bool canTrade = confirmedStatus[j] && !invalidatedStatus[j];
       if(!allowMultipleEntries && entryCount[j] > 0) canTrade = false;
       
       // Final check: Don't open new trades if we are at the position limit
       if (CountPositions() >= MaxPositions) canTrade = false;

       if(canTrade)
       {
          if(blockTypes[j] == "OB-bearish" && close(1) < blockLow)
          {
             // --- Combined VWAP + DeMarker FILTER CHECK FOR SELL ---
             if(IsVWAPFilterPassed(POSITION_TYPE_SELL) && IsDeMarkerFilterPassed(POSITION_TYPE_SELL))
             {
                OpenSell(); // Use template's function for risk management
                entryCount[j]++;

                string lbl = blockLabels[j];
                string txt = "Bearish Block Sell (" + IntegerToString(entryCount[j]) + ")";
                ObjectSetString(0, lbl, OBJPROP_TEXT, txt);
             }
          }
          else if(blockTypes[j] == "OB-bullish" && close(1) > blockHigh)
          {
             // --- Combined VWAP + DeMarker FILTER CHECK FOR BUY ---
             if(IsVWAPFilterPassed(POSITION_TYPE_BUY) && IsDeMarkerFilterPassed(POSITION_TYPE_BUY))
             {
                OpenBuy(); // Use template's function for risk management
                entryCount[j]++;
                
                string lbl = blockLabels[j];
                string txt = "Bullish Block Buy (" + IntegerToString(entryCount[j]) + ")";
                ObjectSetString(0, lbl, OBJPROP_TEXT, txt);
             }
          }
       }
    }
}


//+------------------------------------------------------------------+
//|                        HELPER FUNCTIONS                          |
//+------------------------------------------------------------------+

// --- VWAP Filter Functions ---
//+------------------------------------------------------------------+
//| Initializes the VWAP Filter indicator handles.                   |
//+------------------------------------------------------------------+
bool InitializeVWAPFilters()
{
   // --- Initialize Daily VWAP Filter (Instance 1) ---
   if(UseDailyVWAPFilter)
   {
      // Create the handle for the first instance of the custom indicator.
      // NOTE: Indicator must be named "vwap1.ex5" and located in MQL5/Indicators
      g_dailyVWAPHandle = iCustom(_Symbol, PERIOD_CURRENT, "vwap1.ex5");

      if(g_dailyVWAPHandle == INVALID_HANDLE)
      {
         PrintFormat("Error creating Daily VWAP Filter (iCustom) handle for 'vwap1.ex5' - %s", GetLastErrorText(GetLastError()));
         return false;
      }
      
      ArraySetAsSeries(g_dailyVWAPBuffer, true);
      Print("Daily VWAP Filter (Instance 1) initialized successfully.");
   }

   // --- Initialize Weekly VWAP Filter (Instance 2) ---
   if(UseWeeklyVWAPFilter)
   {
      // Create a separate handle for the second instance of the same indicator.
      g_weeklyVWAPHandle = iCustom(_Symbol, PERIOD_CURRENT, "vwap1.ex5");

      if(g_weeklyVWAPHandle == INVALID_HANDLE)
      {
         PrintFormat("Error creating Weekly VWAP Filter (iCustom) handle for 'vwap1.ex5' - %s", GetLastErrorText(GetLastError()));
         return false;
      }
      
      ArraySetAsSeries(g_weeklyVWAPBuffer, true);
      Print("Weekly VWAP Filter (Instance 2) initialized successfully.");
   }

   return true;
}

//+------------------------------------------------------------------+
//| Deinitializes the VWAP Filters.                                  |
//+------------------------------------------------------------------+
void DeinitializeVWAPFilters()
{
   if(g_dailyVWAPHandle != INVALID_HANDLE)
   {
      IndicatorRelease(g_dailyVWAPHandle);
      g_dailyVWAPHandle = INVALID_HANDLE;
   }
   
   if(g_weeklyVWAPHandle != INVALID_HANDLE)
   {
      IndicatorRelease(g_weeklyVWAPHandle);
      g_weeklyVWAPHandle = INVALID_HANDLE;
   }
}

//+------------------------------------------------------------------+
//| Checks if a trade is allowed based on the enabled VWAP filters.  |
//+------------------------------------------------------------------+
bool IsVWAPFilterPassed(ENUM_POSITION_TYPE trade_type)
{
    // --- Check Daily VWAP Filter (Buffer 0) ---
    if(UseDailyVWAPFilter)
    {
        if(g_dailyVWAPHandle == INVALID_HANDLE)
        {
           Print("Daily VWAP Filter handle is invalid. Trade blocked as a precaution.");
           return false;
        }

        // Copy the latest value from the indicator's buffer #0
        if(CopyBuffer(g_dailyVWAPHandle, 0, 0, 1, g_dailyVWAPBuffer) < 1)
        {
            Print("Error copying Daily VWAP Filter buffer data. Trade blocked.");
            return false;
        }

        double dailyVWAPValue = g_dailyVWAPBuffer[0];
        
        if(dailyVWAPValue == EMPTY_VALUE || dailyVWAPValue == 0)
        {
           Print("Daily VWAP Filter returned an empty or zero value. Trade blocked.");
           return false;
        }
        
        if(trade_type == POSITION_TYPE_BUY)
        {
            // For a BUY, the current ASK price must be ABOVE the VWAP line.
            if(SymbolInfoDouble(_Symbol, SYMBOL_ASK) <= dailyVWAPValue)
               return false; // Filter failed, block the trade.
        }
        else if(trade_type == POSITION_TYPE_SELL)
        {
            // For a SELL, the current BID price must be BELOW the VWAP line.
            if(SymbolInfoDouble(_Symbol, SYMBOL_BID) >= dailyVWAPValue)
               return false; // Filter failed, block the trade.
        }
    }
    
    // --- Check Weekly VWAP Filter (Buffer 1) ---
    if(UseWeeklyVWAPFilter)
    {
        if(g_weeklyVWAPHandle == INVALID_HANDLE)
        {
           Print("Weekly VWAP Filter handle is invalid. Trade blocked as a precaution.");
           return false;
        }

        // Copy the latest value from the indicator's buffer #1
        if(CopyBuffer(g_weeklyVWAPHandle, 1, 0, 1, g_weeklyVWAPBuffer) < 1)
        {
            Print("Error copying Weekly VWAP Filter buffer data. Trade blocked.");
            return false;
        }

        double weeklyVWAPValue = g_weeklyVWAPBuffer[0];
        
        if(weeklyVWAPValue == EMPTY_VALUE || weeklyVWAPValue == 0)
        {
           Print("Weekly VWAP Filter returned an empty or zero value. Trade blocked.");
           return false;
        }

        if(trade_type == POSITION_TYPE_BUY)
        {
            // For a BUY, the current ASK price must be ABOVE the VWAP line.
            if(SymbolInfoDouble(_Symbol, SYMBOL_ASK) <= weeklyVWAPValue)
               return false; // Filter failed, block the trade.
        }
        else if(trade_type == POSITION_TYPE_SELL)
        {
            // For a SELL, the current BID price must be BELOW the VWAP line.
            if(SymbolInfoDouble(_Symbol, SYMBOL_BID) >= weeklyVWAPValue)
               return false; // Filter failed, block the trade.
        }
    }

    // If the code reaches this point, it means all enabled filters have passed.
    return true;
}

//+------------------------------------------------------------------+
//| Initialize DeMarker Filter                                       |
//+------------------------------------------------------------------+
bool InitializeDeMarkerFilter()
{
    if(!UseDeMarkerFilter) return true;
    
    g_deMarkerHandle = iDeMarker(_Symbol, _Period, DeMarkerPeriod);
    
    if(g_deMarkerHandle == INVALID_HANDLE)
    {
        PrintFormat("Error creating DeMarker handle - %s", GetLastErrorText(GetLastError()));
        return false;
    }
    
    ArraySetAsSeries(g_deMarkerBuffer, true);
    Print("DeMarker Filter initialized successfully.");
    return true;
}

//+------------------------------------------------------------------+
//| Deinitialize DeMarker Filter (call in OnDeinit)                  |
//+------------------------------------------------------------------+
void DeinitializeDeMarkerFilter()
{
    if(g_deMarkerHandle != INVALID_HANDLE)
    {
        IndicatorRelease(g_deMarkerHandle);
        g_deMarkerHandle = INVALID_HANDLE;
    }
}

//+------------------------------------------------------------------+
//| DeMarker Filter Function                                         |
//| Returns: true = trade allowed, false = trade blocked             |
//+------------------------------------------------------------------+
bool IsDeMarkerFilterPassed(ENUM_POSITION_TYPE trade_type)
{
    if(!UseDeMarkerFilter) return true;  // Filter disabled
    
    if(g_deMarkerHandle == INVALID_HANDLE)
    {
        Print("DeMarker Filter handle is invalid. Trade blocked.");
        return false;
    }
    
    // Copy the latest DeMarker value
    if(CopyBuffer(g_deMarkerHandle, 0, 0, 1, g_deMarkerBuffer) < 1)
    {
        Print("Error copying DeMarker buffer data. Trade blocked.");
        return false;
    }
    
    double deMarkerValue = g_deMarkerBuffer[0];
    
    if(deMarkerValue == EMPTY_VALUE || deMarkerValue < 0 || deMarkerValue > 1)
    {
        Print("DeMarker returned an invalid value. Trade blocked.");
        return false;
    }
    
    // --- INVERTED LOGIC: Longs only when oversold, Shorts only when overbought ---
    if(InvertDeMarkerLogic)
    {
        if(trade_type == POSITION_TYPE_BUY)
        {
            // Allow BUY only when DeMarker is OVERSOLD (below threshold)
            if(deMarkerValue >= DeMarkerOversold)
            {
                return false;  // DeMarker not oversold, block the trade
            }
        }
        else if(trade_type == POSITION_TYPE_SELL)
        {
            // Allow SELL only when DeMarker is OVERBOUGHT (above threshold)
            if(deMarkerValue <= DeMarkerOverbought)
            {
                return false;  // DeMarker not overbought, block the trade
            }
        }
    }
    else
    {
        // --- NORMAL LOGIC: Longs only when overbought filtered out, Shorts only when oversold filtered out ---
        if(trade_type == POSITION_TYPE_BUY)
        {
            // Block BUY if DeMarker is OVERBOUGHT
            if(deMarkerValue >= DeMarkerOverbought)
            {
                return false;
            }
        }
        else if(trade_type == POSITION_TYPE_SELL)
        {
            // Block SELL if DeMarker is OVERSOLD
            if(deMarkerValue <= DeMarkerOversold)
            {
                return false;
            }
        }
    }
    
    return true;  // Filter passed
}

// --- Order Block Strategy Helpers ---
color DarkenColor(color c, double f=0.8)
{
   int r = int((c & 0xFF) * f);
   int g = int(((c >> 8) & 0xFF) * f);
   int b = int(((c >> 16) & 0xFF) * f);
   return (color)(r | (g << 8) | (b << 16));
}

double OBPipSize() { return (_Digits == 3 || _Digits == 5) ? _Point * 10.0 : _Point; }
double OBPipsToPrice(const double pips) { return pips * OBPipSize(); }
double OBNormalizePrice(const double price) { return NormalizeDouble(price, _Digits); }
double OBRelationTolerancePrice() { return OBPipsToPrice(relationTolerancePips); }
double OBWidthFromBounds(const double highPrice, const double lowPrice) { return MathMax(MathAbs(highPrice - lowPrice), _Point); }
double OBMidFromBounds(const double highPrice, const double lowPrice) { return OBNormalizePrice((highPrice + lowPrice) * 0.5); }

double OBOverlapSize(const double h1, const double l1, const double h2, const double l2)
{
   double top = MathMin(h1, h2);
   double bot = MathMax(l1, l2);
   return MathMax(0.0, top - bot);
}

double OBOverlapRatioToSmaller(const double h1, const double l1, const double h2, const double l2)
{
   double smallerWidth = MathMin(OBWidthFromBounds(h1, l1), OBWidthFromBounds(h2, l2));
   if(smallerWidth <= 0.0) return 0.0;
   return OBOverlapSize(h1, l1, h2, l2) / smallerWidth;
}

double OBWidthSimilarity(const double w1, const double w2)
{
   double largerWidth = MathMax(w1, w2);
   if(largerWidth <= 0.0) return 0.0;
   return MathMin(w1, w2) / largerWidth;
}

bool OBIsContained(const double innerHigh, const double innerLow, const double outerHigh, const double outerLow, const double tolerance)
{
   return (innerHigh <= outerHigh + tolerance && innerLow >= outerLow - tolerance);
}

bool CandidateSameAsBlock(const double candidateHigh, const double candidateLow, const double blockHigh, const double blockLow)
{
   double candidateWidth = OBWidthFromBounds(candidateHigh, candidateLow);
   double blockWidth = OBWidthFromBounds(blockHigh, blockLow);
   double overlap = OBOverlapRatioToSmaller(candidateHigh, candidateLow, blockHigh, blockLow);
   double midpointDistance = MathAbs(OBMidFromBounds(candidateHigh, candidateLow) - OBMidFromBounds(blockHigh, blockLow));
   double widthSimilarity = OBWidthSimilarity(candidateWidth, blockWidth);
   double maxMidpointDistance = MathMax(OBRelationTolerancePrice(), sameMidpointMaxWidthFrac * MathMax(candidateWidth, blockWidth));

   return (overlap >= sameOverlapMin && midpointDistance <= maxMidpointDistance && widthSimilarity >= 0.80);
}

bool CandidateChildOfBlock(const double candidateHigh, const double candidateLow, const double blockHigh, const double blockLow)
{
   double candidateWidth = OBWidthFromBounds(candidateHigh, candidateLow);
   double blockWidth = OBWidthFromBounds(blockHigh, blockLow);
   double overlap = OBOverlapRatioToSmaller(candidateHigh, candidateLow, blockHigh, blockLow);

   if(!OBIsContained(candidateHigh, candidateLow, blockHigh, blockLow, OBRelationTolerancePrice())) return false;
   if(candidateWidth > blockWidth * childMaxWidthParentFrac) return false;
   return (overlap >= 0.95);
}

bool CandidateSiblingOfBlock(const double candidateHigh, const double candidateLow, const double blockHigh, const double blockLow)
{
   double candidateWidth = OBWidthFromBounds(candidateHigh, candidateLow);
   double blockWidth = OBWidthFromBounds(blockHigh, blockLow);
   double overlap = OBOverlapRatioToSmaller(candidateHigh, candidateLow, blockHigh, blockLow);
   double midpointDistance = MathAbs(OBMidFromBounds(candidateHigh, candidateLow) - OBMidFromBounds(blockHigh, blockLow));
   double maxWidth = MathMax(candidateWidth, blockWidth);
   double minMidpointDistance = siblingMidpointMinFrac * maxWidth;
   double maxMidpointDistance = siblingMidpointMaxFrac * maxWidth;

   if(OBIsContained(candidateHigh, candidateLow, blockHigh, blockLow, OBRelationTolerancePrice()) ||
      OBIsContained(blockHigh, blockLow, candidateHigh, candidateLow, OBRelationTolerancePrice()))
   {
      return false;
   }

   return (overlap >= siblingOverlapMin &&
           overlap < sameOverlapMin &&
           midpointDistance >= minMidpointDistance &&
           midpointDistance <= maxMidpointDistance);
}

bool BlocksOverlapHeuristically(const double candidateHigh, const double candidateLow, const double blockHigh, const double blockLow)
{
   if(CandidateSameAsBlock(candidateHigh, candidateLow, blockHigh, blockLow)) return true;
   if(CandidateChildOfBlock(candidateHigh, candidateLow, blockHigh, blockLow)) return true;
   if(CandidateChildOfBlock(blockHigh, blockLow, candidateHigh, candidateLow)) return true;
   if(CandidateSiblingOfBlock(candidateHigh, candidateLow, blockHigh, blockLow)) return true;
   return false;
}

bool FindBlockingOrderBlock(const double candidateHigh, const double candidateLow, string &blockingBlockName)
{
   double normalizedHigh = OBNormalizePrice(MathMax(candidateHigh, candidateLow));
   double normalizedLow = OBNormalizePrice(MathMin(candidateHigh, candidateLow));

   for(int i = ArraySize(blockNames) - 1; i >= 0; --i)
   {
      if(i < ArraySize(invalidatedStatus) && invalidatedStatus[i]) continue;

      string existingName = blockNames[i];
      if(existingName == "" || ObjectFind(0, existingName) < 0) continue;

      double existingHigh = ObjectGetDouble(0, existingName, OBJPROP_PRICE, 0);
      double existingLow = ObjectGetDouble(0, existingName, OBJPROP_PRICE, 1);
      double normalizedExistingHigh = OBNormalizePrice(MathMax(existingHigh, existingLow));
      double normalizedExistingLow = OBNormalizePrice(MathMin(existingHigh, existingLow));

      if(BlocksOverlapHeuristically(normalizedHigh, normalizedLow, normalizedExistingHigh, normalizedExistingLow))
      {
         blockingBlockName = existingName;
         return true;
      }
   }

   blockingBlockName = "";
   return false;
}

double high(int index)  { return iHigh (_Symbol, _Period, index); }
double low (int index)  { return iLow  (_Symbol, _Period, index); }
double close(int index) { return iClose(_Symbol, _Period, index); }
datetime time(int index){ return iTime (_Symbol, _Period, index); }
// --- End Order Block Strategy Helpers ---


int CountPositions()
{
    int count = 0;
    int TotalPositions = PositionsTotal();
    for (int i = 0; i < TotalPositions; i++)
    {
        string Instrument = PositionGetSymbol(i);
        if (Instrument == "")
        {
            PrintFormat(__FUNCTION__, ": ERROR - Unable to select the position - %s - %d.", GetLastErrorText(GetLastError()), GetLastError());
        }
        else
        {
            // Skip positions in other symbols.
            if (Instrument != Symbol()) continue;
            // Skip counting positions with a different Magic number if the EA has non-zero Magic number set.
            if ((MagicNumber != 0) && (PositionGetInteger(POSITION_MAGIC) != MagicNumber)) continue;
            count++;
        }
    }
    return count;
}

// Initialize handles. Indicator handles have to be initialized at the beginning of the EA's operation.
bool InitializeHandles()
{
    // This strategy does not use a main signal indicator, so IndicatorHandle is not initialized.
    
    // ATR handle for stop-loss and take-profit.
    ATRHandle = iATR(Symbol(), ATRTimeFrame, ATRPeriod);
    if (ATRHandle == INVALID_HANDLE)
    {
        PrintFormat("Unable to create ATR handle - %s - %d.", GetLastErrorText(GetLastError()), GetLastError());
        return false;
    }
    return true;
}

// Trading functions

// Set the basic parameters of the Trade object.
void SetTradeObject()
{
    // All future trade operations will take into account these parameters - Magic number and deviation/slippage.
    Trade.SetExpertMagicNumber(MagicNumber);
    Trade.SetDeviationInPoints(Slippage);
    Trade.SetTypeFillingBySymbol(_Symbol);
}

// Open a position with a buy order.
bool OpenBuy()
{
    double Ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
    double Bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);
    double OpenPrice = Ask; // Buy at Ask.
    double StopLossPrice = StopLoss(ORDER_TYPE_BUY, OpenPrice); // Calculate SL based on direction, price, and SL rules.
    double TakeProfitPrice = TakeProfit(ORDER_TYPE_BUY, OpenPrice); // Calculate TP based on direction, price, and TP rules.
    double Size = LotSize(StopLossPrice, OpenPrice); // Calculate position size based on the SL, price, and the given rules.
    
    if(Size <= 0)
    {
        PrintFormat("Unable to open BUY: Calculated lot size is zero or negative.");
        return false;
    }
    
    // Use the standard Trade object to open the position with calculated parameters.
    if (!Trade.Buy(Size, Symbol(), OpenPrice, StopLossPrice, TakeProfitPrice, OrderNote))
    {
        PrintFormat("Unable to open BUY: %s - %d", Trade.ResultRetcodeDescription(), Trade.ResultRetcode());
        return false;
    }
    return true;
}

// Open a position with a sell order.
bool OpenSell()
{
    double Ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
    double Bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);
    double OpenPrice = Bid; // Sell at Bid.
    double StopLossPrice = StopLoss(ORDER_TYPE_SELL, OpenPrice); // Calculate SL based on direction, price, and SL rules.
    double TakeProfitPrice = TakeProfit(ORDER_TYPE_SELL, OpenPrice); // Calculate TP based on direction, price, and TP rules.
    double Size = LotSize(StopLossPrice, OpenPrice); // Calculate position size based on the SL, price, and the given rules.

    if(Size <= 0)
    {
        PrintFormat("Unable to open SELL: Calculated lot size is zero or negative.");
        return false;
    }

    // Use the standard Trade object to open the position with calculated parameters.
    if (!Trade.Sell(Size, Symbol(), OpenPrice, StopLossPrice, TakeProfitPrice, OrderNote))
    {
        PrintFormat("Unable to open SELL: %s - %d", Trade.ResultRetcodeDescription(), Trade.ResultRetcode());
        return false;
    }
    return true;
}

// Close the specified position completely.
//!! Unused. Can be uncommented and used to close specific positions.
/* bool ClosePosition(ulong ticket)
{
    if (!Trade.PositionClose(ticket))
    {
        PrintFormat(__FUNCTION__, ": ERROR - Unable to close position: %s - %d", Trade.ResultRetcodeDescription(), Trade.ResultRetcode());
        return false;
    }
    return true;
}*/

void CloseAllSell()
{
    int total = PositionsTotal();

    // Start a loop to scan all the positions.
    // The loop starts from the last, otherwise it could skip positions.
    for (int i = total - 1; i >= 0; i--)
    {
        // If the position cannot be selected log an error.
        if (PositionGetSymbol(i) == "")
        {
            PrintFormat(__FUNCTION__, ": ERROR - Unable to select the position - %s - %d.", GetLastErrorText(GetLastError()), GetLastError());
            continue;
        }
        if (PositionGetString(POSITION_SYMBOL) != Symbol()) continue; // Only close current symbol trades.
        if (PositionGetInteger(POSITION_TYPE) != POSITION_TYPE_SELL) continue; // Only close Sell positions.
        if (PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue; // Only close own positions.

        for (int try = 0; try < 10; try++)
        {
            bool result = Trade.PositionClose(PositionGetInteger(POSITION_TICKET));
            if (!result)
            {
                PrintFormat(__FUNCTION__, ": ERROR - Unable to close position: %s - %d", Trade.ResultRetcodeDescription(), Trade.ResultRetcode());
            }
            else break;
        }
    }
}

void CloseAllBuy()
{
    int total = PositionsTotal();

    // Start a loop to scan all the positions.
    // The loop starts from the last, otherwise it could skip positions.
    for (int i = total - 1; i >= 0; i--)
    {
        // If the position cannot be selected log an error.
        if (PositionGetSymbol(i) == "")
        {
            PrintFormat(__FUNCTION__, ": ERROR - Unable to select the position - %s - %d.", GetLastErrorText(GetLastError()), GetLastError());
            continue;
        }
        if (PositionGetString(POSITION_SYMBOL) != Symbol()) continue; // Only close current symbol trades.
        if (PositionGetInteger(POSITION_TYPE) != POSITION_TYPE_BUY) continue; // Only close Buy positions.
        if (PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue; // Only close own positions.

        for (int try = 0; try < 10; try++)
        {
            bool result = Trade.PositionClose(PositionGetInteger(POSITION_TICKET));
            if (!result)
            {
                PrintFormat(__FUNCTION__, ": ERROR - Unable to close position: %s - %d", Trade.ResultRetcodeDescription(), Trade.ResultRetcode());
            }
            else break;
        }
    }
}

// Close all positions opened by this EA.
void CloseAllPositions()
{
    int total = PositionsTotal();

    // Start a loop to scan all the positions.
    // The loop starts from the last, otherwise it could skip positions.
    for (int i = total - 1; i >= 0; i--)
    {
        // If the position cannot be selected log an error.
        if (PositionGetSymbol(i) == "")
        {
            PrintFormat(__FUNCTION__, ": ERROR - Unable to select the position - %s - %d.", GetLastErrorText(GetLastError()), GetLastError());
            continue;
        }
        if (PositionGetString(POSITION_SYMBOL) != Symbol()) continue; // Only close current symbol trades.
        if (PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue; // Only close own positions.

        for (int try = 0; try < 10; try++)
        {
            bool result = Trade.PositionClose(PositionGetInteger(POSITION_TICKET));
            if (!result)
            {
                PrintFormat(__FUNCTION__, ": ERROR - Unable to close position: %s - %d", Trade.ResultRetcodeDescription(), Trade.ResultRetcode());
            }
            else break;
        }
    }
}

// Partially close a position with a given ticket.
bool PartialClose(ulong ticket, double percentage)
{
    if (!PositionSelectByTicket(ticket))
    {
        PrintFormat("ERROR - Unable to select position by ticket #%d: %s - %d", ticket, GetLastErrorText(GetLastError()), GetLastError());
        return false;
    }
    double OriginalSize = PositionGetDouble(POSITION_VOLUME);
    double Size = OriginalSize * percentage / 100;
    double LotStep = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
    double MaxLot = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MAX);
    double MinLot = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
    Size = MathFloor(Size / LotStep) * LotStep;
    if (Size < MinLot) return false;
    if (!Trade.PositionClosePartial(ticket, Size))
    {
        PrintFormat("ERROR - Unable to partially close position #%d: %s - %d", ticket, Trade.ResultRetcodeDescription(), Trade.ResultRetcode());
        return false;
    }
    return true;
}

// Calculate a stop-loss price for an order.
double StopLoss(ENUM_ORDER_TYPE order_type, double open_price)
{
    double StopLossPrice = 0;
    if (StopLossMode == SL_FIXED) // Easy way.
    {
        if (DefaultStopLoss == 0) return 0;
        if (order_type == ORDER_TYPE_BUY)
        {
            StopLossPrice = open_price - DefaultStopLoss * SymbolInfoDouble(Symbol(), SYMBOL_POINT);
        }
        if (order_type == ORDER_TYPE_SELL)
        {
            StopLossPrice = open_price + DefaultStopLoss * SymbolInfoDouble(Symbol(), SYMBOL_POINT);
        }
    }
    else // Special cases.
    {
        if(!GetIndicatorsData()) return 0; // Ensure ATR data is available
        StopLossPrice = DynamicStopLossPrice(order_type, open_price);
    }
    return NormalizeDouble(StopLossPrice, (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS));
}

// Calculate the take-profit price for an order.
double TakeProfit(ENUM_ORDER_TYPE order_type, double open_price)
{
    double TakeProfitPrice = 0;
    if (TakeProfitMode == TP_FIXED) // Easy way.
    {
        if (DefaultTakeProfit == 0) return 0;
        if (order_type == ORDER_TYPE_BUY)
        {
            TakeProfitPrice = open_price + DefaultTakeProfit * SymbolInfoDouble(Symbol(), SYMBOL_POINT);
        }
        if (order_type == ORDER_TYPE_SELL)
        {
            TakeProfitPrice = open_price - DefaultTakeProfit * SymbolInfoDouble(Symbol(), SYMBOL_POINT);
        }
    }
    else // Special cases.
    {
        if(!GetIndicatorsData()) return 0; // Ensure ATR data is available
        TakeProfitPrice = DynamicTakeProfitPrice(order_type, open_price);
    }
    return NormalizeDouble(TakeProfitPrice, (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS));
}

// Calculate the position size for an order.
double LotSize(double stop_loss, double open_price)
{
    double Size = DefaultLotSize;
    if (RiskDefaultSize == RISK_DEFAULT_AUTO) // If the position size is dynamic.
    {
        if (stop_loss != 0) // Calculate position size only if SL is non-zero, otherwise there will be a division by zero error.
        {
            double RiskBaseAmount = 0;
            // TickValue is the value of the individual price increment for 1 lot of the instrument expressed in the account currency.
            double TickValue = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE);
            // Define the base for the risk calculation depending on the parameter chosen
            if (RiskBase == RISK_BASE_BALANCE) RiskBaseAmount = AccountBalance();
            else if (RiskBase == RISK_BASE_EQUITY) RiskBaseAmount = AccountEquity();
            else if (RiskBase == RISK_BASE_FREEMARGIN) RiskBaseAmount = AccountFreeMargin();
            double SL = MathAbs(open_price - stop_loss) / SymbolInfoDouble(Symbol(), SYMBOL_POINT); // SL as a number of points.
            // Calculate the Position Size.
            Size = (RiskBaseAmount * MaxRiskPerTrade / 100) / (SL * TickValue);
        }
        // If the stop loss is zero, then use the default size.
        if (stop_loss == 0)
        {
            Size = DefaultLotSize;
        }
    }
    
    // Normalize the Lot Size to satisfy the allowed lot increment and minimum and maximum position size.
    double LotStep = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
    double MaxLot = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MAX);
    double MinLot = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
    Size = MathFloor(Size / LotStep) * LotStep;
    // Limit the lot size in case it is greater than the maximum allowed by the user.
    if (Size > MaxLotSize) Size = MaxLotSize;
    // Limit the lot size in case it is greater than the maximum allowed by the broker.
    if (Size > MaxLot) Size = MaxLot;
    // If the lot size is too small, then set it to 0 and don't trade.
    if ((Size < MinLotSize) || (Size < MinLot)) Size = 0;
    
    return Size;
}

// Utility functions

// Checks to run at initialization to complete it.
bool Prechecks()
{
    // An example of a check to run here.
    if (MaxLotSize < MinLotSize)
    {
        Print("MaxLotSize cannot be less than MinLotSize");
        return false;
    }
    return true;
}

// Retrieve indicator data necessary for auto SL/TP or partial close.
bool GetIndicatorsData()
{
    double buf[2]; // Needed for CopyBuffer().
    int count; // Will store the number of array elements returned by CopyBuffer().
    
    count = CopyBuffer(ATRHandle, 0, 0, 2, buf); // Copy using ATR indicator handle 2 latest values from 0th buffer to the buf array.
    if ((count < 2) || (buf[0] == NULL) || (buf[0] == EMPTY_VALUE))
    {
        Print("Unable to get ATR values.");
        return false;
    }
    else
    {
        ATR_current = buf[1];
        ATR_previous = buf[0];
    }
    
    return true;
}

// Dynamic stop-loss calculation
double DynamicStopLossPrice(ENUM_ORDER_TYPE type, double open_price)
{
    double StopLossPrice = 0;
    if (type == ORDER_TYPE_BUY)
    {
        StopLossPrice = open_price - ATR_previous * ATRMultiplierSL;
    }
    else if (type == ORDER_TYPE_SELL)
    {
        StopLossPrice = open_price + ATR_previous * ATRMultiplierSL;
    }
    return NormalizeDouble(StopLossPrice, (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS));
}

// Dynamic take-profit calculation
double DynamicTakeProfitPrice(ENUM_ORDER_TYPE type, double open_price)
{
    double TakeProfitPrice = 0;
    if (type == ORDER_TYPE_BUY)
    {
        TakeProfitPrice = open_price + ATR_previous * ATRMultiplierTP;
    }
    else if (type == ORDER_TYPE_SELL)
    {
        TakeProfitPrice = open_price - ATR_previous * ATRMultiplierTP;
    }
    return NormalizeDouble(TakeProfitPrice, (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS));
}

// Partially close all positions opened by this EA.
void PartialCloseAll()
{
    if(!GetIndicatorsData()) return; // Ensure ATR data is available for partial close logic

    int total = PositionsTotal();

    // Start a loop to scan all the positions.
    for (int i = total - 1; i >= 0; i--)
    {
        if (PositionGetSymbol(i) == "")
        {
            Print(__FUNCTION__, ": ERROR - Unable to select the position - ", GetLastError());
            continue;
        }
        if (PositionGetString(POSITION_SYMBOL) != Symbol()) continue; // Only close current symbol trades.
        if (PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue; // Only close own positions.

        int position_ticket = (int)PositionGetInteger(POSITION_TICKET);

        if (!HistorySelectByPosition(PositionGetInteger(POSITION_IDENTIFIER)))
        {
            PrintFormat("ERROR - Unable to get position history for %d - %s - %d", position_ticket, GetLastErrorText(GetLastError()), GetLastError());
            continue;
        }

        bool need_partial_close = true;

        if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
        {
            for (int j = HistoryDealsTotal() - 1; j >= 0; j--)
            {
                long deal_ticket = (int)HistoryDealGetTicket(j);
                if (deal_ticket > 0 && HistoryDealGetInteger(deal_ticket, DEAL_TYPE) == DEAL_TYPE_SELL)
                {
                    need_partial_close = false;
                    break;
                }
            }
            if ((need_partial_close) && (SymbolInfoDouble(Symbol(), SYMBOL_BID) - PositionGetDouble(POSITION_PRICE_OPEN) > ATR_previous * ATRMultiplierPC))
            {
                PartialClose(position_ticket, PartialClosePerc);
            }
        }
        else if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL)
        {
            for (int j = HistoryDealsTotal() - 1; j >= 0; j--)
            {
                long deal_ticket = (int)HistoryDealGetTicket(j);
                if (deal_ticket > 0 && HistoryDealGetInteger(deal_ticket, DEAL_TYPE) == DEAL_TYPE_BUY)
                {
                    need_partial_close = false;
                    break;
                }
            }
            if ((need_partial_close) && (PositionGetDouble(POSITION_PRICE_OPEN) - SymbolInfoDouble(Symbol(), SYMBOL_ASK) > ATR_previous * ATRMultiplierPC))
            {
                PartialClose(position_ticket, PartialClosePerc);
            }
        }
    }
}
//+------------------------------------------------------------------+
//| Function to handle breakeven logic                               |
//+------------------------------------------------------------------+
void BreakEvenLogic()
{
    if (!EnableBreakEven) return;

    for (int i = PositionsTotal() - 1; i >= 0; i--)
    {
        if (PositionGetSymbol(i) == _Symbol && PositionGetInteger(POSITION_MAGIC) == MagicNumber)
        {
            double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
            double currentStopLoss = PositionGetDouble(POSITION_SL);

            if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
            {
                double currentPrice = SymbolInfoDouble(_Symbol, SYMBOL_BID);
                if (currentPrice - openPrice >= BreakEvenDistance * _Point && currentStopLoss < openPrice)
                {
                    double newStopLoss = openPrice + 5 * _Point;
                    Trade.PositionModify(PositionGetTicket(i), newStopLoss, PositionGetDouble(POSITION_TP));
                }
            }
            else if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL)
            {
                double currentPrice = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
                if (openPrice - currentPrice >= BreakEvenDistance * _Point && (currentStopLoss > openPrice || currentStopLoss == 0))
                {
                    double newStopLoss = openPrice - 5 * _Point;
                    Trade.PositionModify(PositionGetTicket(i), newStopLoss, PositionGetDouble(POSITION_TP));
                }
            }
        }
    }
}

//+------------------------------------------------------------------+
//| Simple points-based trailing stop                                |
//+------------------------------------------------------------------+
void SimpleTrailingStop()
{
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   
   for(int i = PositionsTotal()-1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0 && PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == MagicNumber)
      {
         long type = (long)PositionGetInteger(POSITION_TYPE);
         double open = PositionGetDouble(POSITION_PRICE_OPEN);
         double curSL= PositionGetDouble(POSITION_SL);
         double curTP= PositionGetDouble(POSITION_TP);

         // Check if profit is sufficient to start trailing
         if ((type == POSITION_TYPE_BUY  && bid - open < MinProfitToTrail * _Point) ||
             (type == POSITION_TYPE_SELL && open - ask < MinProfitToTrail * _Point))
         {
             continue;
         }

         if(type == POSITION_TYPE_BUY)
         {
            double newSL = NormalizeDouble(bid - TrailingStopPoints * _Point, _Digits);
            if(newSL > open && (curSL == 0 || newSL > curSL))
               Trade.PositionModify(ticket, newSL, curTP);
         }
         else if(type == POSITION_TYPE_SELL)
         {
            double newSL = NormalizeDouble(ask + TrailingStopPoints * _Point, _Digits);
            if(newSL < open && (curSL == 0 || newSL < curSL))
               Trade.PositionModify(ticket, newSL, curTP);
         }
      }
   }
}

// Scan for Profit before indicator trail
bool CheckTrailingCondition(ulong ticket)
{
    if (PositionSelectByTicket(ticket))
    {
        double currentProfit = PositionGetDouble(POSITION_PROFIT);
        string symbol = PositionGetString(POSITION_SYMBOL);
        double pointValue = SymbolInfoDouble(symbol, SYMBOL_POINT);
        
        if (currentProfit >= TrailingStartProfit * pointValue)
        {
            return true;
        }
    }
    return false;
}

//+------------------------------------------------------------------+
//| Function to get stop loss for buy positions using MA             |
//+------------------------------------------------------------------+
double GetStopLossBuy(string symbol)
{
    double buf[1];
    int n = CopyBuffer(MAHandle, 0, Shift, 1, buf);
    if (n < 1)
    {
        Print("MA data not ready for " + symbol + ".");
    }
    return buf[0];
}

//+------------------------------------------------------------------+
//| Function to get stop loss for sell positions using MA            |
//+------------------------------------------------------------------+
double GetStopLossSell(string symbol)
{
    return GetStopLossBuy(symbol);
}

//+------------------------------------------------------------------+
//| Function to get stop loss for buy positions using PSAR           |
//+------------------------------------------------------------------+
double GetPSARBuy(string symbol)
{
    double buf[1];
    int n = CopyBuffer(PSARHandle, 0, 0, 1, buf);
    if (n < 1)
    {
        Print("PSAR data not ready for " + symbol + ".");
    }
    return buf[0];
}

//+------------------------------------------------------------------+
//| Function to get stop loss for sell positions using PSAR          |
//+------------------------------------------------------------------+
double GetPSARSell(string symbol)
{
    return GetPSARBuy(symbol);
}

//+------------------------------------------------------------------+
//| Function to get stop loss for buy positions using AMA            |
//+------------------------------------------------------------------+
double GetAMAStopLossBuy(string symbol)
{
    double buf[1];
    int n = CopyBuffer(AMAHandle, 0, AMATrailingShift, 1, buf);
    if (n < 1)
    {
        Print("AMA data not ready for " + symbol + ".");
    }
    return buf[0];
}

//+------------------------------------------------------------------+
//| Function to get stop loss for sell positions using AMA           |
//+------------------------------------------------------------------+
double GetAMAStopLossSell(string symbol)
{
    return GetAMAStopLossBuy(symbol);
}

//+------------------------------------------------------------------+
//| Function to get stop loss for buy positions using Fractals       |
//+------------------------------------------------------------------+
double GetFractalStopLossBuy(string symbol)
{
    double buf[];
    ArrayResize(buf, BarsToScan);
    int n = CopyBuffer(FractalHandle, LOWER_LINE, FractalTrailingShift, BarsToScan, buf);
    if (n < BarsToScan)
    {
        Print("Fractal data not ready for " + symbol + ".");
        return 0;
    }
    double Fractals = 0;
    int counter = 0;
    ArraySetAsSeries(buf, true);
    for (int i = 0; i < BarsToScan; i++)
    {
        Fractals = buf[i];
        if ((Fractals > 0) && (Fractals != EMPTY_VALUE))
        {
            counter++;
            if (counter >= FractalToUse) break;
        }
    }
    return Fractals;
}

//+------------------------------------------------------------------+
//| Function to get stop loss for sell positions using Fractals      |
//+------------------------------------------------------------------+
double GetFractalStopLossSell(string symbol)
{
    double buf[];
    ArrayResize(buf, BarsToScan);
    int n = CopyBuffer(FractalHandle, UPPER_LINE, FractalTrailingShift, BarsToScan, buf);
    if (n < BarsToScan)
    {
        Print("Fractal data not ready for " + symbol + ".");
        return 0;
    }
    double Fractals = 0;
    int counter = 0;
    ArraySetAsSeries(buf, true);
    for (int i = 0; i < BarsToScan; i++)
    {
        Fractals = buf[i];
        if ((Fractals > 0) && (Fractals != EMPTY_VALUE))
        {
            counter++;
            if (counter >= FractalToUse) break;
        }
    }
    return Fractals;
}

//+------------------------------------------------------------------+
//| Function to implement MA trailing stop logic                     |
//+------------------------------------------------------------------+
void TrailingStop()
{
    for (int i = 0; i < PositionsTotal(); i++)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket <= 0 || !PositionSelectByTicket(ticket)) continue;
        if (PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
        if (!CheckTrailingCondition(ticket)) continue;
        if (PositionGetString(POSITION_SYMBOL) != Symbol()) continue;

        double NewSL = 0;
        double NewTP = PositionGetDouble(POSITION_TP);
        string Instrument = PositionGetString(POSITION_SYMBOL);
        
        if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
        {
            double SLBuy = GetStopLossBuy(Instrument);
            if(SLBuy == 0 || SLBuy == EMPTY_VALUE) continue;
            
            double StopLevel = SymbolInfoInteger(Instrument, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
            if (SLBuy < SymbolInfoDouble(Instrument, SYMBOL_BID) - StopLevel)
            {
               NewSL = SLBuy;
               if ((NewSL > PositionGetDouble(POSITION_SL)) || (PositionGetDouble(POSITION_SL) == 0))
               {
                   ModifyOrder((int)ticket, NewSL, NewTP);
               }
            }
        }
        else if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL)
        {
            double SLSell = GetStopLossSell(Instrument);
            if(SLSell == 0 || SLSell == EMPTY_VALUE) continue;
            
            double StopLevel = SymbolInfoInteger(Instrument, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
            if (SLSell > SymbolInfoDouble(Instrument, SYMBOL_ASK) + StopLevel)
            {
               NewSL = SLSell;
               if ((NewSL < PositionGetDouble(POSITION_SL)) || (PositionGetDouble(POSITION_SL) == 0))
               {
                   ModifyOrder((int)ticket, NewSL, NewTP);
               }
            }
        }
    }
}

//+------------------------------------------------------------------+
//| Function to implement PSAR trailing stop logic                   |
//+------------------------------------------------------------------+
void PSARTrailingStop()
{
    for (int i = 0; i < PositionsTotal(); i++)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket <= 0 || !PositionSelectByTicket(ticket)) continue;
        if (PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
        if (!CheckTrailingCondition(ticket)) continue;
        if (PositionGetString(POSITION_SYMBOL) != Symbol()) continue;

        double NewSL = 0;
        double NewTP = PositionGetDouble(POSITION_TP);
        string Instrument = PositionGetString(POSITION_SYMBOL);

        if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
        {
            double SLBuy = GetPSARBuy(Instrument);
            if(SLBuy == 0 || SLBuy == EMPTY_VALUE) continue;

            double StopLevel = SymbolInfoInteger(Instrument, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
            if (SLBuy < SymbolInfoDouble(Instrument, SYMBOL_BID) - StopLevel)
            {
               NewSL = SLBuy;
               if ((NewSL > PositionGetDouble(POSITION_SL)) || (PositionGetDouble(POSITION_SL) == 0))
               {
                   ModifyOrder((int)ticket, NewSL, NewTP);
               }
            }
        }
        else if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL)
        {
            double SLSell = GetPSARSell(Instrument);
            if(SLSell == 0 || SLSell == EMPTY_VALUE) continue;

            double StopLevel = SymbolInfoInteger(Instrument, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
            if (SLSell > SymbolInfoDouble(Instrument, SYMBOL_ASK) + StopLevel)
            {
               NewSL = SLSell;
               if ((NewSL < PositionGetDouble(POSITION_SL)) || (PositionGetDouble(POSITION_SL) == 0))
               {
                   ModifyOrder((int)ticket, NewSL, NewTP);
               }
            }
        }
    }
}

//+------------------------------------------------------------------+
//| Function to implement AMA trailing stop logic                    |
//+------------------------------------------------------------------+
void AMATrailingStop()
{
    for (int i = 0; i < PositionsTotal(); i++)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket <= 0 || !PositionSelectByTicket(ticket)) continue;
        if (PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
        if (!CheckTrailingCondition(ticket)) continue;
        if (PositionGetString(POSITION_SYMBOL) != Symbol()) continue;

        double NewSL = 0;
        double NewTP = PositionGetDouble(POSITION_TP);
        string Instrument = PositionGetString(POSITION_SYMBOL);

        if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
        {
            double SLBuy = GetAMAStopLossBuy(Instrument);
            if(SLBuy == 0 || SLBuy == EMPTY_VALUE) continue;

            double StopLevel = SymbolInfoInteger(Instrument, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
            if (SLBuy < SymbolInfoDouble(Instrument, SYMBOL_BID) - StopLevel)
            {
               NewSL = SLBuy;
               if ((NewSL > PositionGetDouble(POSITION_SL)) || (PositionGetDouble(POSITION_SL) == 0))
               {
                   ModifyOrder((int)ticket, NewSL, NewTP);
               }
            }
        }
        else if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL)
        {
            double SLSell = GetAMAStopLossSell(Instrument);
            if(SLSell == 0 || SLSell == EMPTY_VALUE) continue;

            double StopLevel = SymbolInfoInteger(Instrument, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
            if (SLSell > SymbolInfoDouble(Instrument, SYMBOL_ASK) + StopLevel)
            {
               NewSL = SLSell;
               if ((NewSL < PositionGetDouble(POSITION_SL)) || (PositionGetDouble(POSITION_SL) == 0))
               {
                   ModifyOrder((int)ticket, NewSL, NewTP);
               }
            }
        }
    }
}

//+------------------------------------------------------------------+
//| Function to implement Fractal trailing stop logic                |
//+------------------------------------------------------------------+
void FractalTrailingStop()
{
    for (int i = 0; i < PositionsTotal(); i++)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket <= 0 || !PositionSelectByTicket(ticket)) continue;
        if (PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
        if (!CheckTrailingCondition(ticket)) continue;
        if (PositionGetString(POSITION_SYMBOL) != Symbol()) continue;

        double NewSL = 0;
        double NewTP = PositionGetDouble(POSITION_TP);
        string Instrument = PositionGetString(POSITION_SYMBOL);

        if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
        {
            double SLBuy = GetFractalStopLossBuy(Instrument);
            if(SLBuy == 0 || SLBuy == EMPTY_VALUE) continue;

            double StopLevel = SymbolInfoInteger(Instrument, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
            if (SLBuy < SymbolInfoDouble(Instrument, SYMBOL_BID) - StopLevel)
            {
               NewSL = SLBuy;
               if ((NewSL > PositionGetDouble(POSITION_SL)) || (PositionGetDouble(POSITION_SL) == 0))
               {
                   ModifyOrder((int)ticket, NewSL, NewTP);
               }
            }
        }
        else if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL)
        {
            double SLSell = GetFractalStopLossSell(Instrument);
            if(SLSell == 0 || SLSell == EMPTY_VALUE) continue;

            double StopLevel = SymbolInfoInteger(Instrument, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
            if (SLSell > SymbolInfoDouble(Instrument, SYMBOL_ASK) + StopLevel)
            {
               NewSL = SLSell;
               if ((NewSL < PositionGetDouble(POSITION_SL)) || (PositionGetDouble(POSITION_SL) == 0))
               {
                   ModifyOrder((int)ticket, NewSL, NewTP);
               }
            }
        }
    }
}

//+------------------------------------------------------------------+
//| Function to modify orders                                        |
//+------------------------------------------------------------------+
void ModifyOrder(int Ticket, double SLPrice, double TPPrice)
{
    string symbol = PositionGetString(POSITION_SYMBOL);
    int eDigits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
    SLPrice = NormalizeDouble(SLPrice, eDigits);
    TPPrice = NormalizeDouble(TPPrice, eDigits);

    if (!Trade.PositionModify(Ticket, SLPrice, TPPrice))
    {
        Print("Position Modify Return Code: ", Trade.ResultRetcodeDescription());
        int Error = GetLastError();
        Print("ERROR - UPDATE FAILED - error modifying position ", Ticket, " in ", symbol, " return error: ", Error, " (", GetLastErrorText(Error), ")");
    }
    else
    {
        Print("TRADE - UPDATE SUCCESS - Position ", Ticket, " in ", symbol, ": new stop-loss ", SLPrice, " new take-profit ", TPPrice);
    }
}
//+------------------------------------------------------------------+
