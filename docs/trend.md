//+------------------------------------------------------------------+
//|  Complete System Code with Integrated DEMA/MA Convergence/Divergence/Extreme Filter
//+------------------------------------------------------------------+
//
// This code merges the original system with the new DEMA/MA filter logic
// for convergence, divergence, and extreme zone filtering.
//
// * All original code is preserved.
// * The DEMA/MA filter code (convergence, divergence, extreme) is added
//   in the same style as other filters in the system.
// * Look for "DEMA/MA FILTER SETTINGS" sections for the added parts.
//
//+------------------------------------------------------------------+


// Includes
#include <Trade\Trade.mqh>
#include <MQLTA ErrorHandling.mqh>
#include <MQLTA Utils.mqh>

// Enums
enum ENUM_RISK_BASE {
    RISK_BASE_EQUITY = 1,
    RISK_BASE_BALANCE = 2,
    RISK_BASE_FREEMARGIN = 3,
};

enum ENUM_RISK_DEFAULT_SIZE {
    RISK_DEFAULT_FIXED = 1,
    RISK_DEFAULT_AUTO = 2,
};

enum ENUM_MODE_SL {
    SL_FIXED = 0,
    SL_AUTO = 1,
};

enum ENUM_MODE_TP {
    TP_FIXED = 0,
    TP_AUTO = 1,
};

// EA Parameters
input string Comment_0 = "==========";
input bool UseReversalMode     = false;  // Reversal after N candles
input int TrendBars = 3;
input int ConfirmBarsAfterTrend = 1; // wait this many fully closed bars after the N-trend candle


// Trading Hours Settings
input bool UseTradingHours = false;
input ENUM_HOUR TradingHourStart = h07;
input ENUM_HOUR TradingHourEnd = h19;

input bool UseCloseByTime = false; // Enable/disable closing trades by time
input int CloseHour = 23; // Hour to close all trades (24-hour format)
input int CloseMinute = 55; // Minute to close all trades

// ATR Settings
input int ATRPeriod = 100;
input ENUM_TIMEFRAMES ATRTimeFrame = PERIOD_CURRENT;
input double ATRMultiplierSL = 2;
input double ATRMultiplierTP = 3;

// Risk Management Settings
input string Comment_a = "==========";
input ENUM_RISK_DEFAULT_SIZE RiskDefaultSize = RISK_DEFAULT_FIXED;
input double DefaultLotSize = 0.01;
input ENUM_RISK_BASE RiskBase = RISK_BASE_BALANCE;
input int MaxRiskPerTrade = 2;
input double MinLotSize = 0.01;
input double MaxLotSize = 100;
input int MaxPositions = 1;
input bool EnableBreakEven = false; // Enable/disable Break Even
input double BreakEvenDistance = 200; // Break even in pips

// Stop-Loss and Take-Profit Settings
input string Comment_b = "==========";
input ENUM_MODE_SL StopLossMode = SL_FIXED;
input int DefaultStopLoss = 300;
input int MinStopLoss = 0;
input int MaxStopLoss = 5000;
input ENUM_MODE_TP TakeProfitMode = TP_FIXED;
input int DefaultTakeProfit = 800;
input int MinTakeProfit = 0;
input int MaxTakeProfit = 5000;

// Partial Close Settings
input string Comment_c = "==========";
input bool UsePartialClose = false;
input double PartialClosePerc = 50;
input double ATRMultiplierPC = 3;
// Partial Close based on Take Profit Settings
input bool UseTPPartialClose = false;       // Enable/disable TP-based partial close
input double TPPartialClosePerc = 50;       // Percentage of position to close
input double TPPartialCloseTrigger = 50;    // Percentage of take profit distance to trigger partial close

// Additional Settings
input string Comment_d = "==========";
input int MagicNumber = 0;
input string OrderNote = "";
input int Slippage = 5;
input int MaxSpread = 50;

// System-Specific Parameters
input string Comment_e = "=========="; // Trade Settings
input int EntryDelay = 1; // Number of candles before accepting a new signal
input int SystemMagicNumber = 0; // Magic number for the EA
input int SystemSlippage = 5000; // Slippage in points

// Day Filter Settings
input bool UseWiseDayLineFilter = false; // Enable/disable WiseDayLine filter
input int WiseDayLineBuffer = 0; // Buffer index for WiseDayLine indicator
input int TimeShift = 0; // Time shift (in hours)

// Moving Average Filter Settings
input string Comment_z = "==========";
input bool EnableTrendFiltering = true;                 // Enable Trend Filters
input bool UseWiseNetFilter = true;                     // Use Moving Average Filter
input int WiseNetPeriod = 400;                          // MA Period (keep naming for compatibility)
input ENUM_MA_METHOD WiseNetMethod = MODE_EMA;          // MA Method
input ENUM_APPLIED_PRICE WiseNetAppliedPrice = PRICE_CLOSE; // MA Applied Price
input int WiseNetShift = 0;                             // Shift In The MA Value (0=Current Candle)

input string Comment_MAFilter2 = "=========="; // Second MA Filter Settings
input bool UseMAFilter2 = true;                // Use Second MA Filter
input bool ReverseMAFilter2Logic = false;      // Reverse Second MA Filter logic
input int MAFilter2Period = 200;               // MA Filter 2 Period
input ENUM_MA_METHOD MAFilter2Method = MODE_EMA; // MA Filter 2 Method
input ENUM_APPLIED_PRICE MAFilter2AppliedPrice = PRICE_CLOSE; // MA Filter 2 Applied Price
input int MAFilter2Shift = 0;                  // MA Filter 2 Shift

input bool UseMACDFilter = false; // Enable/disable MACD filter
input bool ReverseMACDLogic = false; // Reverse MACD filter logic
input int MACDFastPeriod = 12; // MACD Fast Period
input int MACDSlowPeriod = 26; // MACD Slow Period
input int MACDSignalPeriod = 9; // MACD Signal Period
input ENUM_APPLIED_PRICE MACDApplyPrice = PRICE_CLOSE; // MACD Applied Price

// Third VIDYA Filter Settings
input string Comment_v = "=========="; // Second VIDYA Filter Settings
input bool ReverseVidyaLogic = false; // Reverse VIDYA filter logic
input bool UseVidyaFilter = false; // Enable/disable VIDYA filter
input int VidyaFilterCMOPeriod = 121; // VIDYA Filter CMO Period
input int VidyaFilterEMAPeriod = 89; // VIDYA Filter EMA Period
input int VidyaFilterShift = 0; // VIDYA Filter Shift
input ENUM_APPLIED_PRICE VidyaFilterAppliedPrice = PRICE_CLOSE; // VIDYA Filter Applied Price

// AMA Filter Settings
input bool UseAMAFilter = false; // Enable/disable AMA filter
input int AMAFilterPeriod = 500; // AMA Period
input int AMAFilterFastEMA = 7; // AMA Fast EMA
input int AMAFilterSlowEMA = 40; // AMA Slow EMA
input int AMAFilterSignal = 2; // AMA Signal Smoothing
input ENUM_APPLIED_PRICE AMAFilterApplyPrice = PRICE_CLOSE; // AMA Applied Price

// Fibb Retracement Settings
input string Comment_g = "==========";
input bool UseKittFibbs = false; // Use KittFibbs indicator
input ENUM_TIMEFRAMES KittFibbsTimeframe = PERIOD_CURRENT; // Timeframe for KittFibbs indicator
input bool KittFibbs_HighToLow = true; // HighToLow
input double KittFibbs_Level_1 = 0.213; // Fibo_Level_1
input double KittFibbs_Level_2 = 0.333; // Fibo_Level_2
input double KittFibbs_Level_3 = 0.5; // Fibo_Level_3
input double KittFibbs_Level_4 = 0.666; // Fibo_Level_4
input double KittFibbs_Level_5 = 0.75; // Fibo_Level_5
input double KittFibbs_Level_6 = 0.9; // Fibo_Level_6
input int KittFibbs_StartBar = 0; // startbar
input int KittFibbs_BarsBack = 150; // BarsBack

// Signal Buffer Selection
input int BuySignalBuffer = 1; // Buffer to use for buy signals
input int SellSignalBuffer = 6; // Buffer to use for sell signals

input bool UseDeMFilter = false; // Enable/disable DeMarker filter
input int DeMPeriod = 14; // DeMarker period
input double DeMOverbought = 0.7; // DeMarker overbought level
input double DeMOversold = 0.3; // DeMarker oversold level

// RSI Filter Settings
input string Comment_r = "==========";
input bool UseRSIFilter = false; // Enable/disable RSI filter
input int RSIPeriod = 14; // RSI Period
input ENUM_APPLIED_PRICE RSIApplyPrice = PRICE_CLOSE; // RSI Applied Price
input double RSILevelBuy = 30; // RSI Level for Buy
input double RSILevelSell = 70; // RSI Level for Sell

input string Comment_l = "=========="; // PSAR Filter Settings
input bool UsePSARFilter = false; // Use PSAR as filter
input double PSARFilterStep = 0.002; // PSAR Filter Step
input double PSARFilterMaximum = 0.2; // PSAR Filter Maximum
input ENUM_TIMEFRAMES PSARFilterTimeframe = PERIOD_CURRENT; // PSAR Filter Timeframe

// MA Trailing Stop Settings
input string Comment_h = "==========";
input bool EnableTrailing = false; // Enable Trailing Stop
input int MAPeriod = 400; // MA Period
input ENUM_MA_METHOD MAMethod = MODE_EMA; // MA Method
input ENUM_APPLIED_PRICE MAApplyPrice = PRICE_CLOSE; // MA Applied Price
input int Shift = 0; // Shift In The MA Value (0=Current Candle)

// PSAR Trailing Stop Settings
input string Comment_i = "==========";
input bool EnablePSARTrailing = false; // Enable PSAR Trailing Stop
input double PSARStep = 0.0004; // PSAR Step
input double PSARMaximum = 0.2; // PSAR Maximum

// AMA Trailing Stop Settings
input string Comment_j = "==========";
input bool EnableAMATrailing = false; // Enable AMA Trailing Stop
input int AMATrailingPeriod = 500; // AMA Period
input int AMATrailingFastEMA = 7; // AMA Fast EMA
input int AMATrailingSlowEMA = 40; // AMA Slow EMA
input int AMATrailingSignal = 2; // AMA Signal Smoothing
input ENUM_APPLIED_PRICE AMATrailingApplyPrice = PRICE_CLOSE; // AMA Applied Price
input int AMATrailingShift = 0; // Shift In The AMA Value (0=Current Candle)

// Fractal Trailing Stop Settings
input string Comment_k = "==========";
input bool EnableFractalTrailing = false; // Enable Fractal Trailing Stop
input int BarsToScan = 1000; // Bars To Scan (10=Last Ten Candles)
input int FractalToUse = 1; // Fractal Number to Use (1 = First, 2 = Second, ...)
input int FractalTrailingShift = 0; // Shift In The Fractal Value (0=Current Candle)
input int FractalApplyPrice = PRICE_CLOSE; // Applied Price

// Vidya Trailing Stop Settings
input bool EnableVidyaTrailing = false; // Enable Vidya Trailing Stop
input int VidyaCMOPeriod = 100; // Vidya CMO Period
input int VidyaEMAPeriod = 12; // Vidya EMA Period
input int VidyaShift = 0; // Vidya Shift
input ENUM_APPLIED_PRICE VidyaAppliedPrice = PRICE_CLOSE; // Vidya Applied Price

input int TrailingStartProfit = 300; // Start trailing after this many points in profit

//---------------------------------------------------------------
// DEMA/MA FILTER SETTINGS (Newly added section)
//---------------------------------------------------------------
input string Comment_dema = "=========="; // DEMA/MA Filter Settings
input bool   UseDEMAConvergenceFilter  = false; // Enable/Disable DEMA/MA Convergence Filter
input int    DEMAPeriod                = 20;    // DEMA Period
input int    DEMAShift                 = 0;     // DEMA Shift
input ENUM_APPLIED_PRICE DEMAAppliedPrice = PRICE_CLOSE; // DEMA Applied Price
input int    ConvergenceMAPeriod       = 50;    // MA Period (for convergence filter)
input int    ConvergenceMAShift        = 0;     // MA Shift
input ENUM_MA_METHOD ConvergenceMAMethod = MODE_SMA; // MA Method
input ENUM_APPLIED_PRICE ConvergenceMAAppliedPrice = PRICE_CLOSE; // MA Applied Price
input double DEMAMAConvergence         = 25;    // Max distance in points for "near" (convergence)

input bool   UseDEMADivergenceZone     = false; // Divergence Zone (block trades if distance >= threshold)
input double DEMAMADivergenceThreshold = 50;    // Distance threshold for divergence

input bool   UseDEMAExtremeZone        = false; // Enable/Disable DEMA/MA Extreme Zone Filter
input double DEMAExtremeThreshold      = 30;    // If distance >= this threshold, trades are allowed
//---------------------------------------------------------------
//---------------------------------------------------------------
// VWAP FILTER SETTINGS
//---------------------------------------------------------------
input string CommentVWAP = "=== VWAP Filter Settings ===";
input bool UseVWAPDailyFilter = false;      // Enable/Disable Daily VWAP Filter
input bool ReverseVWAPDailyLogic = false;   // Reverse Daily VWAP Filter logic
input bool UseVWAPWeeklyFilter = false;     // Enable/Disable Weekly VWAP Filter  
input bool ReverseVWAPWeeklyLogic = false;  // Reverse Weekly VWAP Filter logic

// Global Variables
CTrade Trade;
int ATRHandle;
int IndicatorHandle = -1;
double ATR_current, ATR_previous;
double Indicator_current, Indicator_previous;
int barsTotal;
int lastSignalBar = -1;
int handleWiseNetFilter;
int handleKittFibbs;
int MAHandle;
int PSARHandle;
int AMAHandle;
int FractalHandle;
int lastProcessedBar = 0;
int handleAMAFilter;
int handleRSI;
double netBuffer[];
double fibbBuffer1[], fibbBuffer2[], fibbBuffer3[], fibbBuffer4[], fibbBuffer5[], fibbBuffer6[];
double amaFilterBuffer[];
int VidyaHandle;
int handleMACD;
double macdBuffer[];
int handleWiseDayLine; // Declare the handle for the WiseDayLine indicator
double dayLineBuffer[]; // Declare the buffer for the WiseDayLine indicator
int handlePSARFilter; // Handle for the PSAR Filter indicator
int VidyaFilterHandle;
double vidyaFilterBuffer[];
int handleMAFilter2;
double maFilter2Buffer[];
// VWAP Filter handles and buffers
int handleVWAPDaily = INVALID_HANDLE;       // Handle for Daily VWAP
int handleVWAPWeekly = INVALID_HANDLE;      // Handle for Weekly VWAP
double vwapDailyBuffer[];                    // Buffer for Daily VWAP values
double vwapWeeklyBuffer[];                   // Buffer for Weekly VWAP values
int handleDeM;
int   pendingDirection    = 0;  // 1 = buy, -1 = sell, 0 = none
int   trendEndBarIndex    = -1; // index of the closed bar where N-trend finished
int      bullCountClosed   = 0;
int      bearCountClosed   = 0;
int      reversalArm       = 0;     // 1 = arm SELL after N bullish, -1 = arm BUY after N bearish, 0 = none
datetime lastBarTime       = 0;     // new-bar gate using iTime//---------------------------------------------------------------
// DEMA/MA FILTER GLOBAL VARIABLES (Newly added)
//---------------------------------------------------------------
int handleDEMAFilter = INVALID_HANDLE;       // DEMA indicator handle
int handleConvergenceMA = INVALID_HANDLE;    // MA indicator handle
double demaConvergenceBuffer[];              // Buffer for DEMA values
double maConvergenceBuffer[];                // Buffer for MA values
//---------------------------------------------------------------

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
    if (!Prechecks())
        return INIT_FAILED;

    if (!InitializeHandles())
    {
        PrintFormat("Error initializing indicator handles - %s - %d", GetLastErrorText(GetLastError()), GetLastError());
        return INIT_FAILED;
    }

    SetTradeObject();

    // WiseNetFilter
    if (UseWiseNetFilter)
    {
        handleWiseNetFilter = iMA(_Symbol, PERIOD_CURRENT, WiseNetPeriod, WiseNetShift, WiseNetMethod, WiseNetAppliedPrice);
        if (handleWiseNetFilter == INVALID_HANDLE)
        {
            Print("Failed to initialize Moving Average indicator handle.");
            return INIT_FAILED;
        }
    }

    // MA Filter 2
    if (UseMAFilter2)
    {
        handleMAFilter2 = iMA(_Symbol, PERIOD_CURRENT, MAFilter2Period, MAFilter2Shift, MAFilter2Method, MAFilter2AppliedPrice);
        if (handleMAFilter2 == INVALID_HANDLE)
        {
            Print("Failed to initialize Second MA Filter indicator handle.");
            return INIT_FAILED;
        }
    }

    // KittFibbs
    if (UseKittFibbs)
    {
        handleKittFibbs = iCustom(_Symbol, KittFibbsTimeframe, "KittFibbsV4.ex5",
                                  KittFibbs_HighToLow,
                                  KittFibbs_Level_1,
                                  KittFibbs_Level_2,
                                  KittFibbs_Level_3,
                                  KittFibbs_Level_4,
                                  KittFibbs_Level_5,
                                  KittFibbs_Level_6,
                                  KittFibbs_StartBar,
                                  KittFibbs_BarsBack);
        if (handleKittFibbs == INVALID_HANDLE)
        {
            Print("Failed to initialize KittFibbsV4 indicator handle.");
            return INIT_FAILED;
        }
    }

    // AMAFilter
    if (UseAMAFilter)
    {
        handleAMAFilter = iAMA(_Symbol, PERIOD_CURRENT, AMAFilterPeriod, AMAFilterFastEMA, AMAFilterSlowEMA, AMAFilterSignal, AMAFilterApplyPrice);
        if (handleAMAFilter == INVALID_HANDLE)
        {
            Print("Failed to initialize AMA filter indicator handle.");
            return INIT_FAILED;
        }
    }

    // RSI Filter
    if (UseRSIFilter)
    {
        handleRSI = iRSI(_Symbol, PERIOD_CURRENT, RSIPeriod, RSIApplyPrice);
        if (handleRSI == INVALID_HANDLE)
        {
            Print("Failed to initialize RSI indicator handle.");
            return INIT_FAILED;
        }
    }

    // WiseDayLine Filter
    if (UseWiseDayLineFilter)
    {
        handleWiseDayLine = iCustom(_Symbol, PERIOD_CURRENT, "WiseDayLine.ex5", TimeShift);
        if (handleWiseDayLine == INVALID_HANDLE)
        {
            Print("Failed to initialize WiseDayLine indicator handle.");
            return INIT_FAILED;
        }
    }

    // PSAR Filter
    if (UsePSARFilter)
{
    handlePSARFilter = iSAR(Symbol(), PSARFilterTimeframe, PSARFilterStep, PSARFilterMaximum);
    if (handlePSARFilter == INVALID_HANDLE)
    {
        Print("Failed to create PSAR Filter indicator handle.");
        return INIT_FAILED;
    }
}

    // VIDYA Filter
    VidyaFilterHandle = iVIDyA(_Symbol, PERIOD_CURRENT, VidyaFilterCMOPeriod, VidyaFilterEMAPeriod, VidyaFilterShift, VidyaFilterAppliedPrice);
    if (VidyaFilterHandle == INVALID_HANDLE)
    {
        Print("Failed to create VIDYA Filter indicator handle.");
        return INIT_FAILED;
    }

    // DeMarker
    handleDeM = iDeMarker(Symbol(), Period(), DeMPeriod);
    if (handleDeM == INVALID_HANDLE)
    {
        PrintFormat("Unable to create DeMarker indicator handle - %s - %d", GetLastErrorText(GetLastError()), GetLastError());
        return INIT_FAILED;
    }

    // Trailing indicators
    MAHandle = iMA(_Symbol, PERIOD_CURRENT, MAPeriod, 0, MAMethod, MAApplyPrice);
    PSARHandle = iSAR(_Symbol, PERIOD_CURRENT, PSARStep, PSARMaximum);
    AMAHandle = iAMA(_Symbol, PERIOD_CURRENT, AMATrailingPeriod, AMATrailingFastEMA, AMATrailingSlowEMA, AMATrailingSignal, AMATrailingApplyPrice);
    FractalHandle = iFractals(_Symbol, PERIOD_CURRENT);
    VidyaHandle = iVIDyA(_Symbol, PERIOD_CURRENT, VidyaCMOPeriod, VidyaEMAPeriod, VidyaShift, VidyaAppliedPrice);

    // ATR
    ATRHandle = iATR(Symbol(), ATRTimeFrame, ATRPeriod);
    if (ATRHandle == INVALID_HANDLE)
    {
        PrintFormat("Unable to create ATR handle - %s - %d.", GetLastErrorText(GetLastError()), GetLastError());
        return INIT_FAILED;
    }

    // MACD
    handleMACD = iMACD(_Symbol, PERIOD_CURRENT, MACDFastPeriod, MACDSlowPeriod, MACDSignalPeriod, MACDApplyPrice);
    if (handleMACD == INVALID_HANDLE)
    {
        Print("Failed to initialize MACD indicator handle.");
        return INIT_FAILED;
    }

    //---------------------------------------------------------------
    // Initialize DEMA/MA Filter (Newly added)
    //---------------------------------------------------------------
    if (UseDEMAConvergenceFilter || UseDEMADivergenceZone || UseDEMAExtremeZone)
    {
        // Attempt to create DEMA handle (some platforms allow iMA with MODE_DEMA, or a custom iDEMA)
        // We'll assume iDEMA(...) is valid. Adjust if your platform uses iMA with MODE_DEMA instead.
        handleDEMAFilter = iDEMA(_Symbol, PERIOD_CURRENT, DEMAPeriod, DEMAShift, DEMAAppliedPrice);
        handleConvergenceMA = iMA(_Symbol, PERIOD_CURRENT,
                                  ConvergenceMAPeriod,
                                  ConvergenceMAShift,
                                  ConvergenceMAMethod,
                                  ConvergenceMAAppliedPrice);

        if (handleDEMAFilter == INVALID_HANDLE || handleConvergenceMA == INVALID_HANDLE)
        {
            Print("Failed to initialize DEMA/MA Filter indicator handles.");
            return INIT_FAILED;
        }
    }
    //---------------------------------------------------------------
      //---------------------------------------------------------------
   // VWAP Filters
   //---------------------------------------------------------------
   if(UseVWAPDailyFilter)
   {
      handleVWAPDaily = iCustom(_Symbol, PERIOD_CURRENT, "\\Indicators\\vwap1");
      if(handleVWAPDaily == INVALID_HANDLE)
      {
         Print("Failed to initialize Daily VWAP indicator handle.");
         return(INIT_FAILED);
      }
   }
   
   if(UseVWAPWeeklyFilter)
   {
      handleVWAPWeekly = iCustom(_Symbol, PERIOD_CURRENT, "\\Indicators\\vwap1");
      if(handleVWAPWeekly == INVALID_HANDLE)
      {
         Print("Failed to initialize Weekly VWAP indicator handle.");
         return(INIT_FAILED);
      }
   }
   
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
    //---------------------------------------------------------------
    // Release DEMA/MA Filter handles (Newly added)
    //---------------------------------------------------------------
    if (handleDEMAFilter != INVALID_HANDLE)
        IndicatorRelease(handleDEMAFilter);

    if (handleConvergenceMA != INVALID_HANDLE)
        IndicatorRelease(handleConvergenceMA);
    //---------------------------------------------------------------
   //---------------------------------------------------------------
   // Release VWAP Filter handles
   //---------------------------------------------------------------
   if(handleVWAPDaily != INVALID_HANDLE)
      IndicatorRelease(handleVWAPDaily);
      
   if(handleVWAPWeekly != INVALID_HANDLE)
      IndicatorRelease(handleVWAPWeekly);
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
    ProcessTick();

    int bars = iBars(_Symbol, PERIOD_CURRENT);
    if (barsTotal != bars)
    {
        barsTotal = bars;
        if (!FetchIndicatorData())
            return;
    }

    CheckEntrySignal();

    BreakEvenLogic();

    if (UseCloseByTime)
    {
        CloseByTime();
    }

    if (EnableTrailing)
        TrailingStop();

    if (EnablePSARTrailing)
        PSARTrailingStop();

    if (EnableAMATrailing)
        AMATrailingStop();

    if (EnableFractalTrailing)
        FractalTrailingStop();

    if (UsePartialClose)
        PartialCloseAll();

    if (UseTPPartialClose)
        PartialCloseByTP();
}

void OnTimer()
{
}

void OnTrade()
{
}

//+------------------------------------------------------------------+
//| Tester function                                                  |
//+------------------------------------------------------------------+
double OnTester()
{
    double NetProfit = TesterStatistics(STAT_PROFIT);
    double InitialDeposit = TesterStatistics(STAT_INITIAL_DEPOSIT);
    double MaxDrawDownPerc = TesterStatistics(STAT_EQUITYDD_PERCENT);
    double TotalTrades = TesterStatistics(STAT_TRADES);
    if (InitialDeposit == 0)
        return 0;
    if (TotalTrades == 0)
        return -100;
    if ((TotalTrades > 0) && (MaxDrawDownPerc == 0))
        MaxDrawDownPerc = 0.01;

    double NetProfitPerc = NetProfit / InitialDeposit * 100;
    double Max = 0;
    if (NetProfitPerc > 0)
        Max = NetProfitPerc / MaxDrawDownPerc;
    if (NetProfitPerc < 0)
        Max = NetProfitPerc;
    return Max;
}

//+------------------------------------------------------------------+
//| Main process tick function                                       |
//+------------------------------------------------------------------+
void ProcessTick()
{
    if (!GetIndicatorsData())
        return;

    if (CountPositions())
    {
        if (UsePartialClose)
            PartialCloseAll();
    }

    if (CountPositions() < MaxPositions)
        CheckEntrySignal();
}

//+------------------------------------------------------------------+
//| Count positions                                                  |
//+------------------------------------------------------------------+
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
            if (Instrument != Symbol())
                continue;
            if ((MagicNumber != 0) && (PositionGetInteger(POSITION_MAGIC) != MagicNumber))
                continue;
            count++;
        }
    }
    return count;
}

//+------------------------------------------------------------------+
//| Initialize basic ATR handle                                      |
//+------------------------------------------------------------------+
bool InitializeHandles()
{
    ATRHandle = iATR(Symbol(), ATRTimeFrame, ATRPeriod);
    if (ATRHandle == INVALID_HANDLE)
    {
        PrintFormat("Unable to create ATR handle - %s - %d.", GetLastErrorText(GetLastError()), GetLastError());
        return false;
    }
    return true;
}

//+------------------------------------------------------------------+
//| Set trade object properties                                      |
//+------------------------------------------------------------------+
void SetTradeObject()
{
    Trade.SetExpertMagicNumber(MagicNumber);
    Trade.SetDeviationInPoints(Slippage);
}

//+------------------------------------------------------------------+
//| Open BUY                                                         |
//+------------------------------------------------------------------+
bool OpenBuy()
{
    double Ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
    double Bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);
    double OpenPrice = Ask;
    double StopLossPrice = StopLoss(ORDER_TYPE_BUY, OpenPrice);
    double TakeProfitPrice = TakeProfit(ORDER_TYPE_BUY, OpenPrice);
    double Size = LotSize(StopLossPrice, OpenPrice);
    if (!Trade.Buy(Size, Symbol(), OpenPrice, StopLossPrice, TakeProfitPrice))
    {
        PrintFormat("Unable to open BUY: %s - %d", Trade.ResultRetcodeDescription(), Trade.ResultRetcode());
        return false;
    }
    return true;
}

//+------------------------------------------------------------------+
//| Open SELL                                                        |
//+------------------------------------------------------------------+
bool OpenSell()
{
    double Ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
    double Bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);
    double OpenPrice = Bid;
    double StopLossPrice = StopLoss(ORDER_TYPE_SELL, OpenPrice);
    double TakeProfitPrice = TakeProfit(ORDER_TYPE_SELL, OpenPrice);
    double Size = LotSize(StopLossPrice, OpenPrice);
    if (!Trade.Sell(Size, Symbol(), OpenPrice, StopLossPrice, TakeProfitPrice))
    {
        PrintFormat("Unable to open SELL: %s - %d", Trade.ResultRetcodeDescription(), Trade.ResultRetcode());
        return false;
    }
    return true;
}

//+------------------------------------------------------------------+
//| Close all SELL                                                   |
//+------------------------------------------------------------------+
void CloseAllSell()
{
    int total = PositionsTotal();
    for (int i = total - 1; i >= 0; i--)
    {
        if (PositionGetSymbol(i) == "")
        {
            PrintFormat(__FUNCTION__, ": ERROR - Unable to select the position - %s - %d.", GetLastErrorText(GetLastError()), GetLastError());
            continue;
        }
        if (PositionGetString(POSITION_SYMBOL) != Symbol())
            continue;
        if (PositionGetInteger(POSITION_TYPE) != POSITION_TYPE_SELL)
            continue;
        if (PositionGetInteger(POSITION_MAGIC) != MagicNumber)
            continue;
        for (int try = 0; try < 10; try++)
        {
            bool result = Trade.PositionClose(PositionGetInteger(POSITION_TICKET));
            if (!result)
            {
                PrintFormat(__FUNCTION__, ": ERROR - Unable to close position: %s - %d", Trade.ResultRetcodeDescription(), Trade.ResultRetcode());
            }
            else
                break;
        }
    }
}

//+------------------------------------------------------------------+
//| Close all BUY                                                    |
//+------------------------------------------------------------------+
void CloseAllBuy()
{
    int total = PositionsTotal();
    for (int i = total - 1; i >= 0; i--)
    {
        if (PositionGetSymbol(i) == "")
        {
            PrintFormat(__FUNCTION__, ": ERROR - Unable to select the position - %s - %d.", GetLastErrorText(GetLastError()), GetLastError());
            continue;
        }
        if (PositionGetString(POSITION_SYMBOL) != Symbol())
            continue;
        if (PositionGetInteger(POSITION_TYPE) != POSITION_TYPE_BUY)
            continue;
        if (PositionGetInteger(POSITION_MAGIC) != MagicNumber)
            continue;
        for (int try = 0; try < 10; try++)
        {
            bool result = Trade.PositionClose(PositionGetInteger(POSITION_TICKET));
            if (!result)
            {
                PrintFormat(__FUNCTION__, ": ERROR - Unable to close position: %s - %d", Trade.ResultRetcodeDescription(), Trade.ResultRetcode());
            }
            else
                break;
        }
    }
}

//+------------------------------------------------------------------+
//| Close all positions                                              |
//+------------------------------------------------------------------+
void CloseAllPositions()
{
    int total = PositionsTotal();
    for (int i = total - 1; i >= 0; i--)
    {
        if (PositionGetSymbol(i) == "")
        {
            PrintFormat(__FUNCTION__, ": ERROR - Unable to select the position - %s - %d.", GetLastErrorText(GetLastError()), GetLastError());
            continue;
        }
        if (PositionGetString(POSITION_SYMBOL) != Symbol())
            continue;
        if (PositionGetInteger(POSITION_MAGIC) != MagicNumber)
            continue;
        for (int try = 0; try < 10; try++)
        {
            bool result = Trade.PositionClose(PositionGetInteger(POSITION_TICKET));
            if (!result)
            {
                PrintFormat(__FUNCTION__, ": ERROR - Unable to close position: %s - %d", Trade.ResultRetcodeDescription(), Trade.ResultRetcode());
            }
            else
                break;
        }
    }
}

//+------------------------------------------------------------------+
//| Partial close                                                    |
//+------------------------------------------------------------------+
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
    if (Size < MinLot)
        return false;
    if (!Trade.PositionClosePartial(ticket, Size))
    {
        PrintFormat("ERROR - Unable to partially close position #%d: %s - %d", ticket, Trade.ResultRetcodeDescription(), Trade.ResultRetcode());
        return false;
    }
    return true;
}

//+------------------------------------------------------------------+
//| Stop Loss calculation                                            |
//+------------------------------------------------------------------+
double StopLoss(ENUM_ORDER_TYPE order_type, double open_price)
{
    double StopLossPrice = 0;
    if (StopLossMode == SL_FIXED)
    {
        if (DefaultStopLoss == 0)
            return 0;
        if (order_type == ORDER_TYPE_BUY)
        {
            StopLossPrice = open_price - DefaultStopLoss * SymbolInfoDouble(Symbol(), SYMBOL_POINT);
        }
        if (order_type == ORDER_TYPE_SELL)
        {
            StopLossPrice = open_price + DefaultStopLoss * SymbolInfoDouble(Symbol(), SYMBOL_POINT);
        }
    }
    else
    {
        StopLossPrice = DynamicStopLossPrice(order_type, open_price);
    }
    return NormalizeDouble(StopLossPrice, (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS));
}

//+------------------------------------------------------------------+
//| Take Profit calculation                                          |
//+------------------------------------------------------------------+
double TakeProfit(ENUM_ORDER_TYPE order_type, double open_price)
{
    double TakeProfitPrice = 0;
    if (TakeProfitMode == TP_FIXED)
    {
        if (DefaultTakeProfit == 0)
            return 0;
        if (order_type == ORDER_TYPE_BUY)
        {
            TakeProfitPrice = open_price + DefaultTakeProfit * SymbolInfoDouble(Symbol(), SYMBOL_POINT);
        }
        if (order_type == ORDER_TYPE_SELL)
        {
            TakeProfitPrice = open_price - DefaultTakeProfit * SymbolInfoDouble(Symbol(), SYMBOL_POINT);
        }
    }
    else
    {
        TakeProfitPrice = DynamicTakeProfitPrice(order_type, open_price);
    }
    return NormalizeDouble(TakeProfitPrice, (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS));
}

//+------------------------------------------------------------------+
//| Lots calculation                                                 |
//+------------------------------------------------------------------+
double LotSize(double stop_loss, double open_price)
{
    double Size = DefaultLotSize;
    if (RiskDefaultSize == RISK_DEFAULT_AUTO)
    {
        if (stop_loss != 0)
        {
            double RiskBaseAmount = 0;
            double TickValue = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE);
            if (RiskBase == RISK_BASE_BALANCE)
                RiskBaseAmount = AccountBalance();
            else if (RiskBase == RISK_BASE_EQUITY)
                RiskBaseAmount = AccountEquity();
            else if (RiskBase == RISK_BASE_FREEMARGIN)
                RiskBaseAmount = AccountFreeMargin();
            double SL = MathAbs(open_price - stop_loss) / SymbolInfoDouble(Symbol(), SYMBOL_POINT);
            Size = (RiskBaseAmount * MaxRiskPerTrade / 100) / (SL * TickValue);
        }
        if (stop_loss == 0)
        {
            Size = DefaultLotSize;
        }
    }

    double LotStep = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
    double MaxLot = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MAX);
    double MinLot = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
    Size = MathFloor(Size / LotStep) * LotStep;
    if (Size > MaxLotSize)
        Size = MaxLotSize;
    if (Size > MaxLot)
        Size = MaxLot;
    if ((Size < MinLotSize) || (Size < MinLot))
        Size = 0;
    return Size;
}

//+------------------------------------------------------------------+
//| Pre-checks                                                       |
//+------------------------------------------------------------------+
bool Prechecks()
{
    if (MaxLotSize < MinLotSize)
    {
        Print("MaxLotSize cannot be less than MinLotSize");
        return false;
    }
    return true;
}

//+------------------------------------------------------------------+
//| Retrieve data from indicators in a loop                          |
//+------------------------------------------------------------------+
bool GetIndicatorsData()
{
    double buf[2];
    int count;
    bool AllDataAvailable = false;
    int MaxAttemptsForData = 5;
    int DelayBetweenAttempts = 200;
    int Attempt = 0;

    while ((!AllDataAvailable) && (Attempt < MaxAttemptsForData))
    {
        AllDataAvailable = true;

        count = CopyBuffer(ATRHandle, 0, 0, 2, buf);
        if ((count < 2) || (buf[0] == NULL) || (buf[0] == EMPTY_VALUE))
        {
            Print("Unable to get ATR values.");
            AllDataAvailable = false;
        }
        else
        {
            ATR_current = buf[1];
            ATR_previous = buf[0];
        }

        if (UseWiseDayLineFilter && CopyBuffer(handleWiseDayLine, 0, 0, 2, dayLineBuffer) < 2)
        {
            Print("Error reading WiseDayLine buffer.");
            AllDataAvailable = false;
        }

        if (UsePSARFilter)
        {
            double psarFilterBuffer[];
            if (CopyBuffer(handlePSARFilter, 0, 0, 2, psarFilterBuffer) != 2)
            {
                Print("Error reading PSAR Filter buffer.");
                AllDataAvailable = false;
            }
        }

        if (UseMAFilter2 && CopyBuffer(handleMAFilter2, 0, 0, 2, maFilter2Buffer) < 2)
        {
            Print("Error reading Second MA Filter buffer.");
            return false;
        }

        // VIDYA Filter
        if (UseVidyaFilter)
        {
            double vidyaBuffer[];
            if (CopyBuffer(VidyaFilterHandle, 0, 0, 2, vidyaBuffer) != 2)
            {
                Print("Error reading VIDYA Filter buffer.");
                AllDataAvailable = false;
            }
        }

        if (UseDeMFilter)
        {
            double deMBuffer[];
            if (CopyBuffer(handleDeM, 0, 0, 1, deMBuffer) != 1)
            {
                Print("Error reading DeMarker buffer.");
                return false;
            }
        }

        Attempt++;
        Sleep(DelayBetweenAttempts);
    }

    if (!AllDataAvailable)
    {
        Print("Unable to get some data for the entry signal, skipping candle.");
        return false;
    }

    return true;
}

//+------------------------------------------------------------------+
//| Attempt to fetch data from certain indicators once per bar       |
//+------------------------------------------------------------------+
bool FetchIndicatorData()
{
    if (UseWiseNetFilter && CopyBuffer(handleWiseNetFilter, 0, 0, 2, netBuffer) < 2)
    {
        Print("Error reading WiseNet filter buffer.");
        return false;
    }

    if (UseKittFibbs)
    {
        if (CopyBuffer(handleKittFibbs, 1, 0, 1, fibbBuffer1) != 1 ||
            CopyBuffer(handleKittFibbs, 2, 0, 1, fibbBuffer2) != 1 ||
            CopyBuffer(handleKittFibbs, 3, 0, 1, fibbBuffer3) != 1 ||
            CopyBuffer(handleKittFibbs, 4, 0, 1, fibbBuffer4) != 1 ||
            CopyBuffer(handleKittFibbs, 5, 0, 1, fibbBuffer5) != 1 ||
            CopyBuffer(handleKittFibbs, 6, 0, 1, fibbBuffer6) != 1)
        {
            Print("Failed to assign Fibonacci buffers.");
            return false;
        }
    }

    if (UseAMAFilter)
    {
        ArrayResize(amaFilterBuffer, 2);
        if (CopyBuffer(handleAMAFilter, 0, 0, 2, amaFilterBuffer) < 2)
        {
            Print("Error reading AMA filter buffer.");
            return false;
        }
    }

    //---------------------------------------------------------------
    // Fetch DEMA/MA Filter data (Newly added)
    //---------------------------------------------------------------
    if (UseDEMAConvergenceFilter || UseDEMADivergenceZone || UseDEMAExtremeZone)
    {
        if (CopyBuffer(handleDEMAFilter, 0, 0, 2, demaConvergenceBuffer) < 2)
        {
            Print("Error reading DEMA buffer.");
            return false;
        }

        if (CopyBuffer(handleConvergenceMA, 0, 0, 2, maConvergenceBuffer) < 2)
        {
            Print("Error reading MA buffer for DEMA/MA Filter.");
            return false;
        }
    }
    //---------------------------------------------------------------
   //---------------------------------------------------------------
   // Fetch VWAP Filter data
   //---------------------------------------------------------------
   if(UseVWAPDailyFilter)
   {
      if(CopyBuffer(handleVWAPDaily, 0, 0, 2, vwapDailyBuffer) < 2)  // Buffer 0 = Daily
      {
         Print("Error reading Daily VWAP buffer.");
         return false;
      }
   }
   
   if(UseVWAPWeeklyFilter)
   {
      if(CopyBuffer(handleVWAPWeekly, 1, 0, 2, vwapWeeklyBuffer) < 2)  // Buffer 1 = Weekly
      {
         Print("Error reading Weekly VWAP buffer.");
         return false;
      }
   }

    return true;
}

//+------------------------------------------------------------------+
//| Check the entry signal                                           |
//+------------------------------------------------------------------+
void CheckEntrySignal()
{
    // Run once per new bar
    datetime bt = iTime(_Symbol, PERIOD_CURRENT, 0);
    if (bt == lastBarTime) return;
    lastBarTime = bt;

    // Respect spacing and max positions before any work
    if (CountPositions() >= MaxPositions)
        return;

    if ((UseTradingHours) && (!IsCurrentTimeInInterval(TradingHourStart, TradingHourEnd)))
        return;

    // Work only on just-closed candle (shift = 1)
    double o1 = iOpen(_Symbol, PERIOD_CURRENT, 1);
    double c1 = iClose(_Symbol, PERIOD_CURRENT, 1);
    bool prevBull = (c1 > o1);
    bool prevBear = (c1 < o1);

    // Update consecutive-closed-candle counters (ignore doji)
    if (prevBull) { bullCountClosed++; bearCountClosed = 0; }
    else if (prevBear) { bearCountClosed++; bullCountClosed = 0; }
    else { bullCountClosed = 0; bearCountClosed = 0; }

    // Enforce EntryDelay spacing relative to last generated signal
    if (barsTotal - lastSignalBar < EntryDelay + 1)
        return;

    if (UseReversalMode)
    {
        // Arm on N-candle run
        if (reversalArm == 0)
        {
            if (bullCountClosed >= TrendBars) reversalArm = 1;      // prepare to SELL
            else if (bearCountClosed >= TrendBars) reversalArm = -1; // prepare to BUY
        }
        else
        {
            // Fire on the first opposite closed candle
            bool fireSell = (reversalArm == 1 && prevBear);
            bool fireBuy  = (reversalArm == -1 && prevBull);

            if (fireSell || fireBuy)
            {
                bool isBullish = fireBuy;      // trade direction for filters
                bool isBearish = fireSell;

                if (CheckFilter(isBullish, isBearish))
                {
                    HandleOpenPosition(isBullish, isBearish);
                    lastSignalBar = barsTotal - 1; // the bar we evaluated (closed)
                }
                // Reset after attempt to avoid duplicate firing
                reversalArm = 0;

                // Rebase counters on the latest bar color
                if (prevBear) { bearCountClosed = 1; bullCountClosed = 0; }
                else if (prevBull) { bullCountClosed = 1; bearCountClosed = 0; }
                else { bearCountClosed = bullCountClosed = 0; }
            }
        }
    }
    else
    {
        // Existing trend-following but on closed bars
        bool isBullish = IsBullishTrend(1); // 1 = previous closed bar
        bool isBearish = IsBearishTrend(1); // 1 = previous closed bar

        if (CheckFilter(isBullish, isBearish))
        {
            HandleOpenPosition(isBullish, isBearish);
            lastSignalBar = barsTotal - 1; // the bar we evaluated (closed)
        }
    }
}
//+------------------------------------------------------------------+
//| Validate buy signal with KittFibbs                               |
//+------------------------------------------------------------------+
bool IsValidBuySignal(double ask)
{
    if (!UseKittFibbs)
        return true;

    switch (BuySignalBuffer)
    {
        case 1:
            return ask < fibbBuffer1[0];
        case 2:
            return ask < fibbBuffer2[0];
        case 3:
            return ask < fibbBuffer3[0];
        case 4:
            return ask < fibbBuffer4[0];
        case 5:
            return ask < fibbBuffer5[0];
        case 6:
            return ask < fibbBuffer6[0];
        default:
            return false;
    }
}

//+------------------------------------------------------------------+
//| Validate sell signal with KittFibbs                              |
//+------------------------------------------------------------------+
bool IsValidSellSignal(double bid)
{
    if (!UseKittFibbs)
        return true;

    switch (SellSignalBuffer)
    {
        case 1:
            return bid > fibbBuffer1[0];
        case 2:
            return bid > fibbBuffer2[0];
        case 3:
            return bid > fibbBuffer3[0];
        case 4:
            return bid > fibbBuffer4[0];
        case 5:
            return bid > fibbBuffer5[0];
        case 6:
            return bid > fibbBuffer6[0];
        default:
            return false;
    }
}

//+------------------------------------------------------------------+
//| PSAR Filter condition                                            |
//+------------------------------------------------------------------+
bool IsPSARFilterConditionMet(bool isBullish)
{
    if (!UsePSARFilter) 
        return true;  // Skip PSAR check if filter is disabled
        
    double psarValue[1];
    if (CopyBuffer(handlePSARFilter, 0, 0, 1, psarValue) != 1)
    {
        // Silently handle the error when filter is inactive
        return true;  // Allow trade since filter is not active
    }

    double currentPrice = iClose(_Symbol, PERIOD_CURRENT, 0);
    
    if (isBullish)
        return currentPrice > psarValue[0];
    else 
        return currentPrice < psarValue[0];
}


//+------------------------------------------------------------------+
//| DeMarker Filter condition                                        |
//+------------------------------------------------------------------+
bool IsDeMFilterValid(bool isBullish)
{
    if (!UseDeMFilter)
        return true; // If the filter is not enabled, always return true

    double deMBuffer[];
    if (CopyBuffer(handleDeM, 0, 0, 1, deMBuffer) != 1)
    {
        Print("Error reading DeMarker buffer.");
        return false;
    }

    double deMValue = deMBuffer[0];

    if (isBullish)
    {
        // Buy signal when DeMarker is below oversold level
        return deMValue <= DeMOversold;
    }
    else
    {
        // Sell signal when DeMarker is above overbought level
        return deMValue >= DeMOverbought;
    }
}

//+------------------------------------------------------------------+
//| Main filter check function                                       |
//+------------------------------------------------------------------+
bool CheckFilter(bool isBullish, bool isBearish)
{
    double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
    double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
    double rsiValue = 0;
    double macdValue = 0;

    if (UseRSIFilter)
    {
        double rsiBuffer[1];
        if (CopyBuffer(handleRSI, 0, 1, 1, rsiBuffer) < 1)
        {
            Print("Error reading RSI buffer.");
            return false;
        }
        rsiValue = rsiBuffer[0];
    }

    if (UseMACDFilter)
    {
        if (CopyBuffer(handleMACD, 0, 0, 1, macdBuffer) < 1)
        {
            Print("Error reading MACD buffer.");
            return false;
        }
        macdValue = macdBuffer[0];
    }

    bool isValidWiseDayLine = IsValidWiseDayLineSignal(isBullish);
    bool isPSARFilterMet = IsPSARFilterConditionMet(isBullish);
    bool isDeMFilterValidBool = IsDeMFilterValid(isBullish); // Add DeMarker filter check

    // VIDYA Filter
    bool isVidyaFilterMet = true;
    if (UseVidyaFilter)
    {
        double vidyaValue;
        if (CopyBuffer(VidyaFilterHandle, 0, 0, 1, vidyaFilterBuffer) == 1)
        {
            vidyaValue = vidyaFilterBuffer[0];
            double currentPrice = iClose(_Symbol, PERIOD_CURRENT, 0);
            if (ReverseVidyaLogic)
            {
                isVidyaFilterMet = (isBullish && currentPrice < vidyaValue) || (isBearish && currentPrice > vidyaValue);
            }
            else
            {
                isVidyaFilterMet = (isBullish && currentPrice > vidyaValue) || (isBearish && currentPrice < vidyaValue);
            }
        }
        else
        {
            Print("Error reading VIDYA Filter buffer.");
            return false;
        }
    }

    // MA Filter 2
    bool isMAFilter2Met = true;
    if (UseMAFilter2)
    {
        double localMAFilter2Buffer[];
        if (CopyBuffer(handleMAFilter2, 0, 0, 1, localMAFilter2Buffer) == 1)
        {
            double maFilter2Value = localMAFilter2Buffer[0];
            double currentPrice = iClose(_Symbol, PERIOD_CURRENT, 0);

            if (ReverseMAFilter2Logic)
            {
                isMAFilter2Met = (isBullish && currentPrice < maFilter2Value) || (isBearish && currentPrice > maFilter2Value);
            }
            else
            {
                isMAFilter2Met = (isBullish && currentPrice > maFilter2Value) || (isBearish && currentPrice < maFilter2Value);
            }
        }
        else
        {
            Print("Error reading Second MA Filter buffer.");
            return false;
        }
    }

   // VWAP Daily Filter
   bool isVWAPDailyFilterMet = true;
   if(UseVWAPDailyFilter)
   {
      double localVWAPDailyBuffer[1];
      if(CopyBuffer(handleVWAPDaily, 0, 0, 1, localVWAPDailyBuffer) >= 1)  // Buffer 0 = Daily
      {
         double vwapDailyValue = localVWAPDailyBuffer[0];
         double currentPrice = iClose(_Symbol, PERIOD_CURRENT, 0);
         
         if(ReverseVWAPDailyLogic)
         {
            isVWAPDailyFilterMet = (isBullish && currentPrice < vwapDailyValue) ||
                                   (isBearish && currentPrice > vwapDailyValue);
         }
         else
         {
            isVWAPDailyFilterMet = (isBullish && currentPrice > vwapDailyValue) ||
                                   (isBearish && currentPrice < vwapDailyValue);
         }
      }
      else
      {
         Print("Error reading Daily VWAP Filter buffer.");
         return false;
      }
   }
   
   // VWAP Weekly Filter
   bool isVWAPWeeklyFilterMet = true;
   if(UseVWAPWeeklyFilter)
   {
      double localVWAPWeeklyBuffer[1];
      if(CopyBuffer(handleVWAPWeekly, 1, 0, 1, localVWAPWeeklyBuffer) >= 1)  // Buffer 1 = Weekly
      {
         double vwapWeeklyValue = localVWAPWeeklyBuffer[0];
         double currentPrice = iClose(_Symbol, PERIOD_CURRENT, 0);
         
         if(ReverseVWAPWeeklyLogic)
         {
            isVWAPWeeklyFilterMet = (isBullish && currentPrice < vwapWeeklyValue) ||
                                    (isBearish && currentPrice > vwapWeeklyValue);
         }
         else
         {
            isVWAPWeeklyFilterMet = (isBullish && currentPrice > vwapWeeklyValue) ||
                                    (isBearish && currentPrice < vwapWeeklyValue);
         }
      }
      else
      {
         Print("Error reading Weekly VWAP Filter buffer.");
         return false;
      }
   }

    // Combine basic filter checks
    if (UseWiseNetFilter)
    {
        if (isBullish &&
            IsAboveWiseNetFilter() &&
            IsValidBuySignal(ask) &&
            IsRSIBuy(rsiValue) &&
            IsMACDBuy(macdValue) &&
            isValidWiseDayLine &&
            (!UsePSARFilter || isPSARFilterMet) &&
            isVidyaFilterMet &&
            isMAFilter2Met &&
            isDeMFilterValidBool && 
          isVWAPDailyFilterMet && isVWAPWeeklyFilterMet)
            ;
        else if (isBearish &&
                 IsBelowWiseNetFilter() &&
                 IsValidSellSignal(bid) &&
                 IsRSISell(rsiValue) &&
                 IsMACDSell(macdValue) &&
                 isValidWiseDayLine &&
                 (!UsePSARFilter || isPSARFilterMet) &&
                 isVidyaFilterMet &&
                 isMAFilter2Met &&
                 isDeMFilterValidBool && 
          isVWAPDailyFilterMet && isVWAPWeeklyFilterMet)
            ;
        else
            return false;
    }
    else if (UseAMAFilter)
    {
        if (isBullish &&
            IsAboveAMAFilter() &&
            IsValidBuySignal(ask) &&
            IsRSIBuy(rsiValue) &&
            IsMACDBuy(macdValue) &&
            isValidWiseDayLine &&
            (!UsePSARFilter || isPSARFilterMet) &&
            isVidyaFilterMet &&
            isMAFilter2Met &&
            isDeMFilterValidBool && 
          isVWAPDailyFilterMet && isVWAPWeeklyFilterMet)
            ;
        else if (isBearish &&
                 IsBelowAMAFilter() &&
                 IsValidSellSignal(bid) &&
                 IsRSISell(rsiValue) &&
                 IsMACDSell(macdValue) &&
                 isValidWiseDayLine &&
                 (!UsePSARFilter || isPSARFilterMet) &&
                 isVidyaFilterMet &&
                 isMAFilter2Met &&
                 isDeMFilterValidBool && 
          isVWAPDailyFilterMet && isVWAPWeeklyFilterMet)
            ;
        else
            return false;
    }
    else
    {
        if (isBullish &&
            IsValidBuySignal(ask) &&
            IsRSIBuy(rsiValue) &&
            IsMACDBuy(macdValue) &&
            isValidWiseDayLine &&
            (!UsePSARFilter || isPSARFilterMet) &&
            isVidyaFilterMet &&
            isMAFilter2Met &&
            isDeMFilterValidBool && 
          isVWAPDailyFilterMet && isVWAPWeeklyFilterMet)
            ;
        else if (isBearish &&
                 IsValidSellSignal(bid) &&
                 IsRSISell(rsiValue) &&
                 IsMACDSell(macdValue) &&
                 isValidWiseDayLine &&
                 (!UsePSARFilter || isPSARFilterMet) &&
                 isVidyaFilterMet &&
                 isMAFilter2Met &&
                 isDeMFilterValidBool && 
          isVWAPDailyFilterMet && isVWAPWeeklyFilterMet)
            ;
        else
            return false;
    }

    //---------------------------------------------------------------
    // DEMA/MA FILTER LOGIC (Newly added)
    //---------------------------------------------------------------
    if (UseDEMAConvergenceFilter || UseDEMADivergenceZone || UseDEMAExtremeZone)
    {
        // Use the previous bar values for the filter
        double demaCurrent = demaConvergenceBuffer[1];
        double maCurrent = maConvergenceBuffer[1];
        double pointSize = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
        double distanceInPoints = MathAbs(demaCurrent - maCurrent) / pointSize;

        // Convergence Filter
        if (UseDEMAConvergenceFilter && distanceInPoints > DEMAMAConvergence)
        {
            // Block trade if distance exceeds threshold
            return false;
        }

        // Divergence Zone
        if (UseDEMADivergenceZone && distanceInPoints >= DEMAMADivergenceThreshold)
        {
            // Block trades if distance >= threshold
            return false;
        }

        // Extreme Zone
        if (UseDEMAExtremeZone && distanceInPoints < DEMAExtremeThreshold)
        {
            // Block trades unless distance >= threshold
            return false;
        }
    }
    //---------------------------------------------------------------

    return true;
}

//+------------------------------------------------------------------+
//| WiseDayLine filter condition                                    |
//+------------------------------------------------------------------+
bool IsValidWiseDayLineSignal(bool isBullish)
{
    if (!UseWiseDayLineFilter)
        return true;

    double dayLineValue;
    if (CopyBuffer(handleWiseDayLine, WiseDayLineBuffer, 0, 1, dayLineBuffer) < 1)
    {
        Print("Error reading WiseDayLine buffer.");
        return false;
    }
    dayLineValue = dayLineBuffer[0];

    double currentPrice = iClose(_Symbol, PERIOD_CURRENT, 0);

    if (isBullish)
    {
        return currentPrice > dayLineValue;
    }
    else
    {
        return currentPrice < dayLineValue;
    }
}

//+------------------------------------------------------------------+
//| RSI Filter check                                                 |
//+------------------------------------------------------------------+
bool IsRSIBuy(double rsiValue)
{
    if (!UseRSIFilter)
        return true; // If RSI filter is not used, always return true
    return (rsiValue < RSILevelBuy);
}

bool IsRSISell(double rsiValue)
{
    if (!UseRSIFilter)
        return true; // If RSI filter is not used, always return true
    return (rsiValue > RSILevelSell);
}

//+------------------------------------------------------------------+
//| MACD Filter check                                                |
//+------------------------------------------------------------------+
bool IsMACDBuy(double macdValue)
{
    if (!UseMACDFilter)
        return true;
    if (ReverseMACDLogic)
        return (macdValue < 0);  // Reversed logic
    return (macdValue > 0);      // Normal logic
}

bool IsMACDSell(double macdValue)
{
    if (!UseMACDFilter)
        return true;
    if (ReverseMACDLogic)
        return (macdValue < 0);  // Reversed logic
    return (macdValue > 0);      // Normal logic
}


//+------------------------------------------------------------------+
//| WiseNet filter conditions                                       |
//+------------------------------------------------------------------+
bool IsAboveWiseNetFilter()
{
    double netValue = netBuffer[0];
    double currentPrice = iClose(_Symbol, PERIOD_CURRENT, 0);
    return (currentPrice > netValue);
}

bool IsBelowWiseNetFilter()
{
    double netValue = netBuffer[0];
    double currentPrice = iClose(_Symbol, PERIOD_CURRENT, 0);
    return (currentPrice < netValue);
}

//+------------------------------------------------------------------+
//| AMA Filter conditions                                           |
//+------------------------------------------------------------------+
bool IsAboveAMAFilter()
{
    double amaValue = amaFilterBuffer[0]; // Use the most recent value
    double currentPrice = iClose(_Symbol, PERIOD_CURRENT, 0);
    return (currentPrice > amaValue);
}

bool IsBelowAMAFilter()
{
    double amaValue = amaFilterBuffer[0]; // Use the most recent value
    double currentPrice = iClose(_Symbol, PERIOD_CURRENT, 0);
    return (currentPrice < amaValue);
}

//+------------------------------------------------------------------+
//| Handle position opens                                            |
//+------------------------------------------------------------------+
void HandleOpenPosition(bool isBullish, bool isBearish)
{
    if (isBullish)
        OpenBuy();
    else if (isBearish)
        OpenSell();
}

//+------------------------------------------------------------------+
//| Detect bullish trend                                             |
//+------------------------------------------------------------------+
bool IsBullishTrend(int barShift)
{
    double open1 = iOpen(_Symbol, PERIOD_CURRENT, barShift);
    double close1 = iClose(_Symbol, PERIOD_CURRENT, barShift);
    if (open1 < close1 && IsTrendContinuation(ORDER_TYPE_BUY, barShift))
    {
        return true;
    }
    return false;
}

//+------------------------------------------------------------------+
//| Detect bearish trend                                             |
//+------------------------------------------------------------------+
bool IsBearishTrend(int barShift)
{
    double open1 = iOpen(_Symbol, PERIOD_CURRENT, barShift);
    double close1 = iClose(_Symbol, PERIOD_CURRENT, barShift);
    if (open1 > close1 && IsTrendContinuation(ORDER_TYPE_SELL, barShift))
    {
        return true;
    }
    return false;
}

//+------------------------------------------------------------------+
//| Check trend continuation for X bars                              |
//+------------------------------------------------------------------+
bool IsTrendContinuation(ENUM_ORDER_TYPE order_type, int barShift)
{
    for (int i = barShift; i < TrendBars + barShift; i++)
    {
        double open = iOpen(_Symbol, PERIOD_CURRENT, i);
        double close = iClose(_Symbol, PERIOD_CURRENT, i);
        if ((order_type == ORDER_TYPE_BUY && open > close) ||
            (order_type == ORDER_TYPE_SELL && open < close))
        {
            return false;
        }
    }
    return true;
}

//+------------------------------------------------------------------+
//| Dynamic stop-loss calculation                                    |
//+------------------------------------------------------------------+
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

//+------------------------------------------------------------------+
//| Dynamic take-profit calculation                                  |
//+------------------------------------------------------------------+
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

//+------------------------------------------------------------------+
//| Breakeven logic                                                  |
//+------------------------------------------------------------------+
void BreakEvenLogic()
{
    if (!EnableBreakEven)
        return;

    double openPrice = 0.0;
    double currentPrice = 0.0;

    for (int i = PositionsTotal() - 1; i >= 0; i--)
    {
        if (PositionGetSymbol(i) == _Symbol)
        {
            openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
            double currentStopLoss = PositionGetDouble(POSITION_SL);

            if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
            {
                currentPrice = SymbolInfoDouble(_Symbol, SYMBOL_BID);
                if (currentPrice - openPrice >= BreakEvenDistance * _Point && currentStopLoss < openPrice)
                {
                    double newStopLoss = openPrice + 5 * _Point;
                    Trade.PositionModify(PositionGetTicket(i), newStopLoss, PositionGetDouble(POSITION_TP));
                }
            }
            else if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL)
            {
                currentPrice = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
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
//| Check trailing condition                                         |
//+------------------------------------------------------------------+
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
//| Get stop loss for buy using MA                                   |
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
//| Get stop loss for sell using MA                                  |
//+------------------------------------------------------------------+
double GetStopLossSell(string symbol)
{
    return GetStopLossBuy(symbol);
}

//+------------------------------------------------------------------+
//| Get stop loss for buy using PSAR                                 |
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
//| Get stop loss for sell using PSAR                                |
//+------------------------------------------------------------------+
double GetPSARSell(string symbol)
{
    return GetPSARBuy(symbol);
}

//+------------------------------------------------------------------+
//| Get stop loss for buy using AMA                                  |
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
//| Get stop loss for sell using AMA                                 |
//+------------------------------------------------------------------+
double GetAMAStopLossSell(string symbol)
{
    return GetAMAStopLossBuy(symbol);
}

//+------------------------------------------------------------------+
//| Get stop loss for buy using Fractals                             |
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
            if (counter >= FractalToUse)
                break;
        }
    }
    return Fractals;
}

//+------------------------------------------------------------------+
//| Get stop loss for sell using Fractals                            |
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
            if (counter >= FractalToUse)
                break;
        }
    }
    return Fractals;
}

//+------------------------------------------------------------------+
//| Get stop loss for buy using Vidya                                |
//+------------------------------------------------------------------+
double GetVidyaStopLossBuy(string symbol)
{
    double buf[1];
    int n = CopyBuffer(VidyaHandle, 0, 0, 1, buf);
    if (n < 1)
    {
        Print("Vidya data not ready for " + symbol + ".");
    }
    return buf[0];
}

double GetVidyaStopLossSell(string symbol)
{
    return GetVidyaStopLossBuy(symbol);
}

//+------------------------------------------------------------------+
//| MA trailing stop                                                 |
//+------------------------------------------------------------------+
void TrailingStop()
{
    for (int i = 0; i < PositionsTotal(); i++)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket <= 0)
        {
            Print("PositionGetTicket failed " + IntegerToString(GetLastError()) + ".");
            continue;
        }

        if (!CheckTrailingCondition(ticket))
        {
            continue;
        }

        if (PositionSelectByTicket(ticket) == false)
        {
            int Error = GetLastError();
            string ErrorText = GetLastErrorText(Error);
            Print("ERROR - Unable to select the position #", IntegerToString(ticket), " - ", Error);
            Print("ERROR - ", ErrorText);
            continue;
        }
        if ((PositionGetString(POSITION_SYMBOL) != Symbol()))
            continue;

        double NewSL = 0;
        double NewTP = 0;
        string Instrument = PositionGetString(POSITION_SYMBOL);
        double SLBuy = GetStopLossBuy(Instrument);
        double SLSell = GetStopLossSell(Instrument);
        if ((SLBuy == 0) || (SLSell == 0) || (SLSell == EMPTY_VALUE) || (SLSell == EMPTY_VALUE))
        {
            Print("Not enough historical data - please load more candles for the selected timeframe.");
            return;
        }

        int eDigits = (int)SymbolInfoInteger(Instrument, SYMBOL_DIGITS);
        SLBuy = NormalizeDouble(SLBuy, eDigits);
        SLSell = NormalizeDouble(SLSell, eDigits);
        double SLPrice = NormalizeDouble(PositionGetDouble(POSITION_SL), eDigits);
        double TPPrice = NormalizeDouble(PositionGetDouble(POSITION_TP), eDigits);
        double Spread = SymbolInfoInteger(Instrument, SYMBOL_SPREAD) * SymbolInfoDouble(Instrument, SYMBOL_POINT);
        double StopLevel = SymbolInfoInteger(Instrument, SYMBOL_TRADE_STOPS_LEVEL) * SymbolInfoDouble(Instrument, SYMBOL_POINT);
        double TickSize = SymbolInfoDouble(Instrument, SYMBOL_TRADE_TICK_SIZE);
        if (TickSize > 0)
        {
            SLBuy = NormalizeDouble(MathRound(SLBuy / TickSize) * TickSize, eDigits);
            SLSell = NormalizeDouble(MathRound(SLSell / TickSize) * TickSize, eDigits);
        }
        if ((PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) && (SLBuy < SymbolInfoDouble(Instrument, SYMBOL_BID) - StopLevel))
        {
            NewSL = NormalizeDouble(SLBuy, eDigits);
            NewTP = TPPrice;
            if ((NewSL > SLPrice) || (SLPrice == 0))
            {
                ModifyOrder((int)ticket, NewSL, NewTP);
            }
        }
        else if ((PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL) && (SLSell > SymbolInfoDouble(Instrument, SYMBOL_ASK) + StopLevel))
        {
            NewSL = NormalizeDouble(SLSell + Spread, eDigits);
            NewTP = TPPrice;
            if ((NewSL < SLPrice) || (SLPrice == 0))
            {
                ModifyOrder((int)ticket, NewSL, NewTP);
            }
        }
    }
}

//+------------------------------------------------------------------+
//| PSAR trailing stop                                               |
//+------------------------------------------------------------------+
void PSARTrailingStop()
{
    for (int i = 0; i < PositionsTotal(); i++)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket <= 0)
        {
            Print("PositionGetTicket failed " + IntegerToString(GetLastError()) + ".");
            continue;
        }

        if (!CheckTrailingCondition(ticket))
        {
            continue;
        }

        if (PositionSelectByTicket(ticket) == false)
        {
            int Error = GetLastError();
            string ErrorText = GetLastErrorText(Error);
            Print("ERROR - Unable to select the position #", IntegerToString(ticket), " - ", Error);
            Print("ERROR - ", ErrorText);
            continue;
        }
        if ((PositionGetString(POSITION_SYMBOL) != Symbol()))
            continue;

        double NewSL = 0;
        double NewTP = 0;
        string Instrument = PositionGetString(POSITION_SYMBOL);
        double SLBuy = GetPSARBuy(Instrument);
        double SLSell = GetPSARSell(Instrument);
        if ((SLBuy == 0) || (SLSell == 0) || (SLSell == EMPTY_VALUE) || (SLSell == EMPTY_VALUE))
        {
            Print("Not enough historical data - please load more candles for the selected timeframe.");
            return;
        }

        int eDigits = (int)SymbolInfoInteger(Instrument, SYMBOL_DIGITS);
        SLBuy = NormalizeDouble(SLBuy, eDigits);
        SLSell = NormalizeDouble(SLSell, eDigits);
        double SLPrice = NormalizeDouble(PositionGetDouble(POSITION_SL), eDigits);
        double TPPrice = NormalizeDouble(PositionGetDouble(POSITION_TP), eDigits);
        double Spread = SymbolInfoInteger(Instrument, SYMBOL_SPREAD) * SymbolInfoDouble(Instrument, SYMBOL_POINT);
        double StopLevel = SymbolInfoInteger(Instrument, SYMBOL_TRADE_STOPS_LEVEL) * SymbolInfoDouble(Instrument, SYMBOL_POINT);
        double TickSize = SymbolInfoDouble(Instrument, SYMBOL_TRADE_TICK_SIZE);
        if (TickSize > 0)
        {
            SLBuy = NormalizeDouble(MathRound(SLBuy / TickSize) * TickSize, eDigits);
            SLSell = NormalizeDouble(MathRound(SLSell / TickSize) * TickSize, eDigits);
        }
        if ((PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) && (SLBuy < SymbolInfoDouble(Instrument, SYMBOL_BID) - StopLevel))
        {
            NewSL = NormalizeDouble(SLBuy, eDigits);
            NewTP = TPPrice;
            if ((NewSL > SLPrice) || (SLPrice == 0))
            {
                ModifyOrder((int)ticket, NewSL, NewTP);
            }
        }
        else if ((PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL) && (SLSell > SymbolInfoDouble(Instrument, SYMBOL_ASK) + StopLevel))
        {
            NewSL = NormalizeDouble(SLSell + Spread, eDigits);
            NewTP = TPPrice;
            if ((NewSL < SLPrice) || (SLPrice == 0))
            {
                ModifyOrder((int)ticket, NewSL, NewTP);
            }
        }
    }
}

//+------------------------------------------------------------------+
//| AMA trailing stop                                                |
//+------------------------------------------------------------------+
void AMATrailingStop()
{
    for (int i = 0; i < PositionsTotal(); i++)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket <= 0)
        {
            Print("PositionGetTicket failed " + IntegerToString(GetLastError()) + ".");
            continue;
        }

        if (!CheckTrailingCondition(ticket))
        {
            continue;
        }

        if (PositionSelectByTicket(ticket) == false)
        {
            int Error = GetLastError();
            string ErrorText = GetLastErrorText(Error);
            Print("ERROR - Unable to select the position #", IntegerToString(ticket), " - ", Error);
            Print("ERROR - ", ErrorText);
            continue;
        }
        if ((PositionGetString(POSITION_SYMBOL) != Symbol()))
            continue;

        double NewSL = 0;
        double NewTP = 0;
        string Instrument = PositionGetString(POSITION_SYMBOL);
        double SLBuy = GetAMAStopLossBuy(Instrument);
        double SLSell = GetAMAStopLossSell(Instrument);
        if ((SLBuy == 0) || (SLSell == 0) || (SLSell == EMPTY_VALUE) || (SLSell == EMPTY_VALUE))
        {
            Print("Not enough historical data - please load more candles for the selected timeframe.");
            return;
        }

        int eDigits = (int)SymbolInfoInteger(Instrument, SYMBOL_DIGITS);
        SLBuy = NormalizeDouble(SLBuy, eDigits);
        SLSell = NormalizeDouble(SLSell, eDigits);
        double SLPrice = NormalizeDouble(PositionGetDouble(POSITION_SL), eDigits);
        double TPPrice = NormalizeDouble(PositionGetDouble(POSITION_TP), eDigits);
        double Spread = SymbolInfoInteger(Instrument, SYMBOL_SPREAD) * SymbolInfoDouble(Instrument, SYMBOL_POINT);
        double StopLevel = SymbolInfoInteger(Instrument, SYMBOL_TRADE_STOPS_LEVEL) * SymbolInfoDouble(Instrument, SYMBOL_POINT);
        double TickSize = SymbolInfoDouble(Instrument, SYMBOL_TRADE_TICK_SIZE);
        if (TickSize > 0)
        {
            SLBuy = NormalizeDouble(MathRound(SLBuy / TickSize) * TickSize, eDigits);
            SLSell = NormalizeDouble(MathRound(SLSell / TickSize) * TickSize, eDigits);
        }
        if ((PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) && (SLBuy < SymbolInfoDouble(Instrument, SYMBOL_BID) - StopLevel))
        {
            NewSL = NormalizeDouble(SLBuy, eDigits);
            NewTP = TPPrice;
            if ((NewSL > SLPrice) || (SLPrice == 0))
            {
                ModifyOrder((int)ticket, NewSL, NewTP);
            }
        }
        else if ((PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL) && (SLSell > SymbolInfoDouble(Instrument, SYMBOL_ASK) + StopLevel))
        {
            NewSL = NormalizeDouble(SLSell + Spread, eDigits);
            NewTP = TPPrice;
            if ((NewSL < SLPrice) || (SLPrice == 0))
            {
                ModifyOrder((int)ticket, NewSL, NewTP);
            }
        }
    }
}

//+------------------------------------------------------------------+
//| Fractal trailing stop                                            |
//+------------------------------------------------------------------+
void FractalTrailingStop()
{
    for (int i = 0; i < PositionsTotal(); i++)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket <= 0)
        {
            Print("PositionGetTicket failed " + IntegerToString(GetLastError()) + ".");
            continue;
        }

        if (!CheckTrailingCondition(ticket))
        {
            continue;
        }

        if (PositionSelectByTicket(ticket) == false)
        {
            int Error = GetLastError();
            string ErrorText = GetLastErrorText(Error);
            Print("ERROR - Unable to select the position #", IntegerToString(ticket), " - ", Error);
            Print("ERROR - ", ErrorText);
            continue;
        }
        if (PositionGetString(POSITION_SYMBOL) != Symbol())
            continue;

        double NewSL = 0;
        double NewTP = 0;
        string Instrument = PositionGetString(POSITION_SYMBOL);
        double SLBuy = GetFractalStopLossBuy(Instrument);
        double SLSell = GetFractalStopLossSell(Instrument);
        if ((SLBuy == 0) || (SLSell == 0) || (SLSell == EMPTY_VALUE) || (SLSell == EMPTY_VALUE))
        {
            Print("Not enough historical data - please load more candles for the selected timeframe.");
            return;
        }

        int eDigits = (int)SymbolInfoInteger(Instrument, SYMBOL_DIGITS);
        SLBuy = NormalizeDouble(SLBuy, eDigits);
        SLSell = NormalizeDouble(SLSell, eDigits);
        double SLPrice = NormalizeDouble(PositionGetDouble(POSITION_SL), eDigits);
        double TPPrice = NormalizeDouble(PositionGetDouble(POSITION_TP), eDigits);
        double Spread = SymbolInfoInteger(Instrument, SYMBOL_SPREAD) * SymbolInfoDouble(Instrument, SYMBOL_POINT);
        double StopLevel = SymbolInfoInteger(Instrument, SYMBOL_TRADE_STOPS_LEVEL) * SymbolInfoDouble(Instrument, SYMBOL_POINT);
        double TickSize = SymbolInfoDouble(Instrument, SYMBOL_TRADE_TICK_SIZE);
        if (TickSize > 0)
        {
            SLBuy = NormalizeDouble(MathRound(SLBuy / TickSize) * TickSize, eDigits);
            SLSell = NormalizeDouble(MathRound(SLSell / TickSize) * TickSize, eDigits);
        }
        if ((PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) && (SLBuy < SymbolInfoDouble(Instrument, SYMBOL_BID) - StopLevel))
        {
            NewSL = NormalizeDouble(SLBuy, eDigits);
            NewTP = TPPrice;
            if ((NewSL > SLPrice) || (SLPrice == 0))
            {
                ModifyOrder((int)ticket, NewSL, NewTP);
            }
        }
        else if ((PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL) && (SLSell > SymbolInfoDouble(Instrument, SYMBOL_ASK) + StopLevel))
        {
            NewSL = NormalizeDouble(SLSell + Spread, eDigits);
            NewTP = TPPrice;
            if ((NewSL < SLPrice) || (SLPrice == 0))
            {
                ModifyOrder((int)ticket, NewSL, NewTP);
            }
        }
    }
}

//+------------------------------------------------------------------+
//| Vidya trailing stop                                              |
//+------------------------------------------------------------------+
void VidyaTrailingStop()
{
    for (int i = 0; i < PositionsTotal(); i++)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket <= 0)
        {
            Print("PositionGetTicket failed " + IntegerToString(GetLastError()) + ".");
            continue;
        }

        if (!CheckTrailingCondition(ticket))
        {
            continue;
        }

        if (PositionSelectByTicket(ticket) == false)
        {
            int Error = GetLastError();
            string ErrorText = GetLastErrorText(Error);
            Print("ERROR - Unable to select the position #", IntegerToString(ticket), " - ", Error);
            Print("ERROR - ", ErrorText);
            continue;
        }
        if (PositionGetString(POSITION_SYMBOL) != Symbol())
            continue;

        double NewSL = 0;
        double NewTP = 0;
        string Instrument = PositionGetString(POSITION_SYMBOL);
        double SLBuy = GetVidyaStopLossBuy(Instrument);
        double SLSell = GetVidyaStopLossSell(Instrument);
        if ((SLBuy == 0) || (SLSell == 0) || (SLSell == EMPTY_VALUE) || (SLSell == EMPTY_VALUE))
        {
            Print("Not enough historical data - please load more candles for the selected timeframe.");
            return;
        }

        int eDigits = (int)SymbolInfoInteger(Instrument, SYMBOL_DIGITS);
        SLBuy = NormalizeDouble(SLBuy, eDigits);
        SLSell = NormalizeDouble(SLSell, eDigits);
        double SLPrice = NormalizeDouble(PositionGetDouble(POSITION_SL), eDigits);
        double TPPrice = NormalizeDouble(PositionGetDouble(POSITION_TP), eDigits);
        double Spread = SymbolInfoInteger(Instrument, SYMBOL_SPREAD) * SymbolInfoDouble(Instrument, SYMBOL_POINT);
        double StopLevel = SymbolInfoInteger(Instrument, SYMBOL_TRADE_STOPS_LEVEL) * SymbolInfoDouble(Instrument, SYMBOL_POINT);
        double TickSize = SymbolInfoDouble(Instrument, SYMBOL_TRADE_TICK_SIZE);
        if (TickSize > 0)
        {
            SLBuy = NormalizeDouble(MathRound(SLBuy / TickSize) * TickSize, eDigits);
            SLSell = NormalizeDouble(MathRound(SLSell / TickSize) * TickSize, eDigits);
        }
        if ((PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) && (SLBuy < SymbolInfoDouble(Instrument, SYMBOL_BID) - StopLevel))
        {
            NewSL = NormalizeDouble(SLBuy, eDigits);
            NewTP = TPPrice;
            if ((NewSL > SLPrice) || (SLPrice == 0))
            {
                ModifyOrder((int)ticket, NewSL, NewTP);
            }
        }
        else if ((PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL) && (SLSell > SymbolInfoDouble(Instrument, SYMBOL_ASK) + StopLevel))
        {
            NewSL = NormalizeDouble(SLSell + Spread, eDigits);
            NewTP = TPPrice;
            if ((NewSL < SLPrice) || (SLPrice == 0))
            {
                ModifyOrder((int)ticket, NewSL, NewTP);
            }
        }
    }
}

//+------------------------------------------------------------------+
//| Modify orders                                                    |
//+------------------------------------------------------------------+
void ModifyOrder(int Ticket, double SLPrice, double TPPrice)
{
    string symbol = PositionGetString(POSITION_SYMBOL);
    int eDigits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
    SLPrice = NormalizeDouble(SLPrice, eDigits);
    TPPrice = NormalizeDouble(TPPrice, eDigits);
    for (int i = 1; i <= 5; i++)
    {
        bool res = Trade.PositionModify(Ticket, SLPrice, TPPrice);
        if (!res)
        {
            Print("Wrong position modification request: ", Ticket, " in ", symbol, " at SL = ", SLPrice, ", TP = ", TPPrice);
            return;
        }
        if ((Trade.ResultRetcode() == 10008) || (Trade.ResultRetcode() == 10009) || (Trade.ResultRetcode() == 10010)) // Success.
        {
            Print("TRADE - UPDATE SUCCESS - Position ", Ticket, " in ", symbol, ": new stop-loss ", SLPrice, " new take-profit ", TPPrice);
            break;
        }
        else
        {
            Print("Position Modify Return Code: ", Trade.ResultRetcodeDescription());
            int Error = GetLastError();
            string ErrorText = GetLastErrorText(Error);
            Print("ERROR - UPDATE FAILED - error modifying position ", Ticket, " in ", symbol, " return error: ", Error, " Open=", PositionGetDouble(POSITION_PRICE_OPEN),
                  " Old SL=", PositionGetDouble(POSITION_SL), " Old TP=", PositionGetDouble(POSITION_TP),
                  " New SL=", SLPrice, " New TP=", TPPrice, " Bid=", SymbolInfoDouble(symbol, SYMBOL_BID), " Ask=", SymbolInfoDouble(symbol, SYMBOL_ASK));
            Print("ERROR - ", ErrorText);
        }
    }
}

//+------------------------------------------------------------------+
//| Partially close all                                              |
//+------------------------------------------------------------------+
void PartialCloseAll()
{
    int total = PositionsTotal();

    for (int i = total - 1; i >= 0; i--)
    {
        if (PositionGetSymbol(i) == "")
        {
            Print(__FUNCTION__, ": ERROR - Unable to select the position - ", GetLastError());
            continue;
        }
        if (PositionGetString(POSITION_SYMBOL) != Symbol())
            continue; // Only close current symbol trades.
        if (PositionGetInteger(POSITION_MAGIC) != MagicNumber)
            continue; // Only close own positions.

        int position_ticket = (int)PositionGetInteger(POSITION_TICKET);

        if (!HistorySelectByPosition(PositionGetInteger(POSITION_IDENTIFIER)))
        {
            PrintFormat("ERROR - Unable to get position history for %d - %s - %d", position_ticket, GetLastErrorText(GetLastError()), GetLastError());
            continue;
        }

        bool need_partial_close = true;

        // Partial close for a BUY
        if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
        {
            for (int j = HistoryDealsTotal() - 1; j >= 0; j--)
            {
                long deal_ticket = (int)HistoryDealGetTicket(j);
                if (!deal_ticket)
                {
                    PrintFormat("Unable to get deal for %d - %s - %d", position_ticket, GetLastErrorText(GetLastError()), GetLastError());
                    break;
                }
                if (HistoryDealGetInteger(deal_ticket, DEAL_TYPE) == DEAL_TYPE_SELL)
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
        // Partial close for a SELL
        else if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL)
        {
            for (int j = HistoryDealsTotal() - 1; j >= 0; j--)
            {
                long deal_ticket = (int)HistoryDealGetTicket(j);
                if (!deal_ticket)
                {
                    PrintFormat("Unable to get deal for %d - %s - %d", position_ticket, GetLastErrorText(GetLastError()), GetLastError());
                    return;
                }
                if (HistoryDealGetInteger(deal_ticket, DEAL_TYPE) == DEAL_TYPE_BUY)
                {
                    need_partial_close = false;
                    break;
                }
            }
            if ((need_partial_close) && (PositionGetDouble(POSITION_PRICE_OPEN) - SymbolInfoDouble(Symbol(), SYMBOL_ASK) > ATR_previous * ATRMultiplierPC))
            {
                PartialClose(position_ticket, PartialClosePerc);
            }
            return;
        }
    }
}

//+------------------------------------------------------------------+
//| Partial close by TP                                              |
//+------------------------------------------------------------------+
void PartialCloseByTP()
{
    int total = PositionsTotal();
    for (int i = total - 1; i >= 0; i--)
    {
        if (PositionGetSymbol(i) == "")
        {
            Print(__FUNCTION__, ": ERROR - Unable to select the position - ", GetLastError());
            continue;
        }
        if (PositionGetString(POSITION_SYMBOL) != Symbol())
            continue;
        if (PositionGetInteger(POSITION_MAGIC) != MagicNumber)
            continue;

        ulong position_ticket = PositionGetInteger(POSITION_TICKET);
        double open_price = PositionGetDouble(POSITION_PRICE_OPEN);
        double tp_price = PositionGetDouble(POSITION_TP);
        double current_price = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
                                 ? SymbolInfoDouble(Symbol(), SYMBOL_BID)
                                 : SymbolInfoDouble(Symbol(), SYMBOL_ASK);

        if (tp_price == 0)
            continue; // Skip if there is no take profit set

        double tp_distance = MathAbs(tp_price - open_price);
        double current_distance = MathAbs(current_price - open_price);
        double trigger_distance = tp_distance * TPPartialCloseTrigger / 100;

        if (current_distance >= trigger_distance)
        {
            PartialClose(position_ticket, TPPartialClosePerc);
        }
    }
}

//+------------------------------------------------------------------+
//| Close by time                                                    |
//+------------------------------------------------------------------+
void CloseByTime()
{
    datetime currentTime = TimeCurrent();
    MqlDateTime struct_time;
    TimeToStruct(currentTime, struct_time);

    if (struct_time.hour == CloseHour && struct_time.min == CloseMinute)
    {
        int total = PositionsTotal();
        for (int i = total - 1; i >= 0; i--)
        {
            ulong ticket = PositionGetTicket(i);

            if (ticket <= 0)
            {
                Print("PositionGetTicket failed " + IntegerToString(GetLastError()) + ".");
                continue;
            }

            if (PositionSelectByTicket(ticket) == false)
            {
                int Error = GetLastError();
                string ErrorText = GetLastErrorText(Error);
                Print("ERROR - Unable to select the position #", IntegerToString(ticket), " - ", Error);
                Print("ERROR - ", ErrorText);
                continue;
            }

            if (PositionGetString(POSITION_SYMBOL) != Symbol())
                continue;

            if (PositionGetInteger(POSITION_MAGIC) != MagicNumber)
                continue;

            if (!Trade.PositionClose(ticket))
            {
                Print("ERROR - Unable to close position: ", Trade.ResultRetcodeDescription());
            }
            else
            {
                Print("Position closed by time: ", ticket);
            }
        }
    }
}