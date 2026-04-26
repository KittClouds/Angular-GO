

//-INCLUDES-//
// '#include' allows to import code from other files.
// In the following instance the file has to be placed in the MQL5\Include folder.
#include <Trade\Trade.mqh> // This file is required to easily manage orders and positions.
#include <MQLTA ErrorHandling.mqh> // This file contains useful descriptions for errors.
#include <MQLTA Utils.mqh> // This file contains some useful functions.

//-COMMENTS-//
// This is a single line comment and you can do it by placing // at the start of the comment, this text is ignored when compiling.

/*
This is a multi-line comment.
It starts with /* and it finishes with the * and / like below
*/

enum ENUM_CUSTOMTIMEFRAMES
{
    CURRENT = PERIOD_CURRENT, // CURRENT PERIOD
    M1 = PERIOD_M1,           // M1
    M2 = PERIOD_M2,           // M2
    M3 = PERIOD_M3,           // M3
    M5 = PERIOD_M5,           // M5
    M10 = PERIOD_M10,         // M10
    M15 = PERIOD_M15,         // M15
    M30 = PERIOD_M30,         // M30
    H1 = PERIOD_H1,           // H1
    H4 = PERIOD_H4,           // H4
    D1 = PERIOD_D1,           // D1
    W1 = PERIOD_W1,           // W1
    MN1 = PERIOD_MN1,         // MN1
};



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


input bool UseWiseDayLineFilter = false; // Enable/disable WiseDayLine filter
input int WiseDayLineBuffer = 0; // Buffer index for WiseDayLine indicator
input int TimeShift = 0; // Time shift (in hours)

input bool UseCloseByTime = false; // Enable/disable closing trades by time
input int CloseHour = 23; // Hour to close all trades (24-hour format)
input int CloseMinute = 55; // Minute to close all trades

// EA Parameters
input string Comment_0 = "==========";          // EA-Specific Parameters
input int SignalRefreshPeriod = 5; // Number of candles until the next permitted signal
input string Comment_1 = "==========";  // Trading Hours Settings
input bool UseTradingHours = false;     // Limit trading hours
input ENUM_HOUR TradingHourStart = h07; // Trading start hour (Broker server hour)
input ENUM_HOUR TradingHourEnd = h19;   // Trading end hour (Broker server hour)

input string Comment_2 = "==========";  // ATR Settings
input int ATRPeriod = 100;              // ATR period
input ENUM_TIMEFRAMES ATRTimeFrame = PERIOD_CURRENT; // ATR timeframe
input double ATRMultiplierSL = 3;       // ATR multiplier for stop-loss
input double ATRMultiplierTP = 8;       // ATR multiplier for take-profit

// General input parameters
input string Comment_a = "==========";                             // Risk Management Settings
input ENUM_RISK_DEFAULT_SIZE RiskDefaultSize = RISK_DEFAULT_FIXED; // Position size mode
input double DefaultLotSize = 0.01;                                // Position size (if fixed or if no stop loss defined)
input ENUM_RISK_BASE RiskBase = RISK_BASE_BALANCE;                 // Risk base
input int MaxRiskPerTrade = 2;                                     // Percentage to risk each trade
input double MinLotSize = 0.01;                                    // Minimum position size allowed
input double MaxLotSize = 100;                                     // Maximum position size allowed
input int MaxPositions = 8;                                        // Maximum number of positions for this EA
input bool EnableBreakEven = false;     // Enable/disable Break Even
input double BreakEvenDistance = 100;  // Break even in pips

input string Comment_b = "==========";                             // Stop-Loss and Take-Profit Settings
input ENUM_MODE_SL StopLossMode = SL_FIXED;                        // Stop-loss mode
input int DefaultStopLoss = 0;                                     // Default stop-loss in points (0 = no stop-loss)
input int MinStopLoss = 0;                                         // Minimum allowed stop-loss in points
input int MaxStopLoss = 5000;                                      // Maximum allowed stop-loss in points
input ENUM_MODE_TP TakeProfitMode = TP_FIXED;                      // Take-profit mode
input int DefaultTakeProfit = 0;                                   // Default take-profit in points (0 = no take-profit)
input int MinTakeProfit = 0;                                       // Minimum allowed take-profit in points
input int MaxTakeProfit = 5000;                                    // Maximum allowed take-profit in points

input string Comment_c = "==========";                             // Partial Close Settings
input bool UsePartialClose = false;                                // Use partial close
input double PartialClosePerc = 50;                                // Partial close percentage
input double ATRMultiplierPC = 5;                                  // ATR multiplier for partial close

input string Comment_d = "==========";                             // Additional Settings
input int MagicNumber = 0;                                         // Magic number
input string OrderNote = "";                                       // Comment for orders
input int Slippage = 5;                                            // Slippage in points
input int MaxSpread = 50;                                          // Maximum allowed spread to trade, in points

input string Comment_z = "==========";
input bool UseWiseNetFilter = true;               // Use Moving Average Filter
input bool EnableTrendFiltering = true;                 // Enable Trend Filters
input int WiseNetPeriod = 400;                    // MA Period (keep naming for compatibility)
input ENUM_MA_METHOD WiseNetMethod = MODE_EMA;    // MA Method
input ENUM_APPLIED_PRICE WiseNetAppliedPrice = PRICE_CLOSE; // MA Applied Price
input int WiseNetShift = 0;                       // Shift In The MA Value (0=Current Candle)



// VWAP Filter Settings
input string CommentVWAP = "=== VWAP Filter Settings ===";
input bool UseVWAPDailyFilter = false;      // Enable/Disable Daily VWAP Filter
input bool ReverseVWAPDailyLogic = false;   // Reverse Daily VWAP Filter logic
input bool UseVWAPWeeklyFilter = false;     // Enable/Disable Weekly VWAP Filter  
input bool ReverseVWAPWeeklyLogic = false;  // Reverse Weekly VWAP Filter logic

// Location Filter Settings
input string Comment_loc = "=========="; // Location Filter Settings
input bool UseLocationFilter = true;     // Master switch for extension/location filter
input bool DebugLocationFilter = false;  // Print rejection reasons

// WiseNet extension gate
input bool UseWiseNetLocationFilter = true;
input double MaxBuyWiseNetDistATR = 1.80;
input double MaxSellWiseNetDistATR = 1.80;

// Daily VWAP extension gate
input bool UseVWAPDailyLocationFilter = true;
input double MaxBuyVWAPDailyDistATR = 1.20;
input double MaxSellVWAPDailyDistATR = 1.20;

// Weekly VWAP extension gate
input bool UseVWAPWeeklyLocationFilter = true;
input double MaxBuyVWAPWeeklyDistATR = 2.50;
input double MaxSellVWAPWeeklyDistATR = 2.50;

// Maturity Filter Settings
input string Comment_mat = "=========="; // Maturity Filter Settings
input bool UseBreakMaturityGate = true;    // Enable maturity filter
input int MaxBullBreakCount = 2;           // Max consecutive bull sweeps allowed
input int MaxBearBreakCount = 2;           // Max consecutive bear sweeps allowed

// Pullback/Reset Filter Settings
input string Comment_pb = "=========="; // Pullback Filter Settings
input bool UsePullbackGate = true;         // Enable pullback gate
input int PullbackLookbackBars = 40;       // Bars to scan for impulse range
input double MinBuyPullbackFraction = 0.25; // 25% minimum pullback for Buys
input double MinSellPullbackFraction = 0.25; // 25% minimum pullback for Sells



// MA Trailing Stop Settings
input bool EnableTrailing = true;                 // Enable Trailing Stop
input int MAPeriod = 400;                          // MA Period
input ENUM_MA_METHOD MAMethod = MODE_EMA;         // MA Method
input ENUM_APPLIED_PRICE MAApplyPrice = PRICE_CLOSE; // MA Applied Price
input int Shift = 0;                              // Shift In The MA Value (0=Current Candle)

// PSAR Trailing Stop Settings
input bool EnablePSARTrailing = true;  // Enable PSAR Trailing Stop
input double PSARStep = 0.0004;          // PSAR Step
input double PSARMaximum = 0.2;        // PSAR Maximum

// AMA Trailing Stop Settings
input string Comment_k = "==========";       // AMA Trailing Stop Settings
input bool EnableAMATrailing = false;        // Enable AMA Trailing Stop
input int AMATrailingPeriod = 500;            // AMA Period
input int AMATrailingFastEMA = 7;            // AMA Fast EMA
input int AMATrailingSlowEMA = 40;           // AMA Slow EMA
input int AMATrailingSignal = 2;             // AMA Signal Smoothing
input int AMATrailingApplyPrice = PRICE_CLOSE; // AMA Applied Price
input int AMATrailingShift = 11;              // Shift In The AMA Value (0=Current Candle)

// Fractal Trailing Stop Settings
input bool EnableFractalTrailing = false; // Enable Fractal Trailing Stop
input int BarsToScan = 1000; // Bars To Scan (10=Last Ten Candles)
input int FractalToUse = 3; // Fractal Number to Use (1 = First, 2 = Second, ...)
input int FractalTrailingShift = 0; // Shift In The Fractal Value (0=Current Candle)
input int FractalApplyPrice = PRICE_CLOSE; // Applied Price

// Vidya Trailing Stop
input bool EnableVidyaTrailing = false; // Enable Vidya Trailing Stop
input int VidyaCMOPeriod = 55; // Vidya CMO Period
input int VidyaEMAPeriod = 12; // Vidya EMA Period
input int VidyaShift = 0; // Vidya Shift
input ENUM_APPLIED_PRICE VidyaAppliedPrice = PRICE_CLOSE; // Vidya Applied Price

input int TrailingStartProfit = 0; // Start trailing after this many points in profit

// Global Variables
CTrade Trade; // Trade object.
int ATRHandle; // Indicator handle for ATR.
int IndicatorHandle = -1; // Global indicator handle for the EA's main signal indicator.
int MAHandle;  // Handle for the Moving Average indicator
int PSARHandle;  // Handle for the PSAR indicator
int AMAHandle; // Handle for the Adaptive Moving Average (AMA) indicator
int FractalHandle; // Handle for the Fractal indicator
int VidyaHandle; // Handle for Vidya Trailing Stop
double ATR_current, ATR_previous; // ATR values.
double Indicator_current, Indicator_previous; // Indicator values.
int barsTotal;
// Global Variables
int WiseNetFilterHandle;
double netBuffer[];
int handleWiseDayLine; // Declare the handle for the WiseDayLine indicator
double dayLineBuffer[]; // Declare the buffer for the WiseDayLine indicator
// VWAP Filter handles and buffers
int handleVWAPDaily = INVALID_HANDLE;       // Handle for Daily VWAP
int handleVWAPWeekly = INVALID_HANDLE;      // Handle for Weekly VWAP
double vwapDailyBuffer[];                    // Buffer for Daily VWAP values
double vwapWeeklyBuffer[];                   // Buffer for Weekly VWAP values

// Maturity Tracking Global Variables
int BullBreakCount = 0;
int BearBreakCount = 0;
double LastBullBreakPrice = 0.0;
double LastBearBreakPrice = 0.0;
datetime LastBullBreakTime = 0;
datetime LastBearBreakTime = 0;
// Here go all the event handling functions. They all run on specific events generated for the expert advisor.
// All event handlers are optional and can be removed if you don't need to process that specific event.

//+-------------------------------------------------------------------+
//| Expert initialization handler                                     |
//| Here goes the code that runs just once each time you load the EA. |
//+-------------------------------------------------------------------+
int OnInit()
{
    // EventSetTimer(60); // Starting a 60-second timer.
    // EventSetMillisecondTimer(500); // Starting a 500-millisecond timer.

    if (!Prechecks()) // Check if everything is OK with input parameters.
    {
        return INIT_FAILED; // Don't initialize the EA if checks fail.
    }

    if (!InitializeHandles()) // Initialize indicator handles.
    {
        PrintFormat("Error initializing indicator handles - %s - %d", GetLastErrorText(GetLastError()), GetLastError());
        return INIT_FAILED;
    }

    if (UseWiseNetFilter || UseWiseNetLocationFilter)
    {
    WiseNetFilterHandle = iMA(_Symbol, PERIOD_CURRENT, WiseNetPeriod, WiseNetShift, WiseNetMethod, WiseNetAppliedPrice);
    if (WiseNetFilterHandle == INVALID_HANDLE)
    {
        Print("Failed to initialize Moving Average indicator handle.");
        return INIT_FAILED;
        }
    }


    if (UseWiseDayLineFilter)
{
    handleWiseDayLine = iCustom(_Symbol, PERIOD_CURRENT, "WiseDayLine.ex5", TimeShift);
    if (handleWiseDayLine == INVALID_HANDLE)
    {
        Print("Failed to initialize WiseDayLine indicator handle.");
        return INIT_FAILED;
    }
}

     // Initialize the Moving Average handle for trailing stop
    MAHandle = iMA(_Symbol, PERIOD_CURRENT, MAPeriod, 0, MAMethod, MAApplyPrice);
    
    // Initialize the PSAR handle for trailing stop
    PSARHandle = iSAR(_Symbol, PERIOD_CURRENT, PSARStep, PSARMaximum);

    // Initialize the AMA handle for trailing stop
    AMAHandle = iAMA(_Symbol, PERIOD_CURRENT, AMATrailingPeriod, AMATrailingFastEMA, AMATrailingSlowEMA, AMATrailingSignal, AMATrailingApplyPrice);

    // Initialize the Fractal handle for trailing stop
    FractalHandle = iFractals(_Symbol, PERIOD_CURRENT);

    VidyaHandle = iVIDyA(_Symbol, PERIOD_CURRENT, VidyaCMOPeriod, VidyaEMAPeriod, VidyaShift, VidyaAppliedPrice);

    // VWAP Filters
    if(UseVWAPDailyFilter || UseVWAPDailyLocationFilter)
    {
       handleVWAPDaily = iCustom(_Symbol, PERIOD_CURRENT, "\\Indicators\\vwap1");
       if(handleVWAPDaily == INVALID_HANDLE)
       {
          Print("Failed to initialize Daily VWAP indicator handle.");
          return(INIT_FAILED);
       }
    }
    
    if(UseVWAPWeeklyFilter || UseVWAPWeeklyLocationFilter)
    {
       handleVWAPWeekly = iCustom(_Symbol, PERIOD_CURRENT, "\\Indicators\\vwap1");
       if(handleVWAPWeekly == INVALID_HANDLE)
       {
          Print("Failed to initialize Weekly VWAP indicator handle.");
          return(INIT_FAILED);
       }
    }

    SetTradeObject();

    return INIT_SUCCEEDED; // Successful initialization.
}

//+---------------------------------------------------------------------+
//| Expert deinitialization handler                                     |
//| Here goes the code that runs just once each time you unload the EA. |
//+---------------------------------------------------------------------+
void OnDeinit(const int reason)
{
    if(handleVWAPDaily != INVALID_HANDLE)
       IndicatorRelease(handleVWAPDaily);
       
    if(handleVWAPWeekly != INVALID_HANDLE)
       IndicatorRelease(handleVWAPWeekly);
}

//+------------------------------------------------------------------+
//| Expert tick handler                                              |
//| Here goes the code that runs every tick.                         |
//+------------------------------------------------------------------+
void OnTick()
{
    if (EnableVidyaTrailing) VidyaTrailingStop();

    BreakEvenLogic();

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

    if (CountPositions())
    {
        if (UsePartialClose) PartialCloseAll();
        CheckExitSignal();
    }

    if (UseCloseByTime)
   {
      CloseByTime();
   }

    ProcessTick();
}

//+------------------------------------------------------------------+
//| Timer event handler                                              |
//| Here goes the code that runs on timer.                           |
//+------------------------------------------------------------------+
void OnTimer()
{
    // For example, you can update a display timer here if you have one in your EA.
}

//+------------------------------------------------------------------------------+
//| Trade event handler                                                          |
//| Here goes the code that runs each time something related to trading happens. |
//+------------------------------------------------------------------------------+
void OnTrade()
{
    // For example, if you want to do something when a pending order gets triggered, you can do it here without overloading the OnTick() handler too much.
}

//+--------------------------------------------------------------------------------+
//| Backtest end handler                                                           |
//| Here goes the code that runs each time a backtest in Strategy Tester finishes. |
//| The goal is to calculate the value of a custom optimization criterion.         |
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


// Here go all custom functions. They all are called either from the above-defined event handlers or from other custom functions.

// Entry and exit processing
void ProcessTick()
{
    if (!GetIndicatorsData()) return;

    if (CountPositions() >= MaxPositions) return;

    // Add the logic for the Break of Structure EA here
    static bool isNewBar = false;
    int currBars = iBars(_Symbol, _Period);
    static int prevBars = currBars;
    if (prevBars == currBars) isNewBar = false;
    else if (prevBars != currBars) { isNewBar = true; prevBars = currBars; }

    const int length = 10; // >2
    static double swing_H = -1.0, swing_L = -1.0;

    if (isNewBar)
    {
        int curr_bar = length;
        bool isSwingHigh = checkSwingHigh(curr_bar, length);
        bool isSwingLow = checkSwingLow(curr_bar, length);

        if (isSwingHigh)
        {
            swing_H = high(curr_bar);
            drawSwingPoint(TimeToString(time(curr_bar)), time(curr_bar), high(curr_bar), 77, clrBlue, 1);
        }
        if (isSwingLow)
        {
            swing_L = low(curr_bar);
            drawSwingPoint(TimeToString(time(curr_bar)), time(curr_bar), low(curr_bar), 77, clrRed, -1);
        }
    }

    double Ask = NormalizeDouble(SymbolInfoDouble(_Symbol, SYMBOL_ASK), _Digits);
    double Bid = NormalizeDouble(SymbolInfoDouble(_Symbol, SYMBOL_BID), _Digits);

    if (FetchIndicatorData())
    {
        checkBuyBreak(Ask, swing_H, length);
        checkSellBreak(Bid, swing_L, length);
    }

    if (CountPositions())
    {
        if (UsePartialClose) PartialCloseAll();
        CheckExitSignal();
    }
}
//+------------------------------------------------------------------+
//| Function to fetch indicator data                                 |
//+------------------------------------------------------------------+
bool FetchIndicatorData()
{
    if (UseWiseNetFilter && CopyBuffer(WiseNetFilterHandle, 0, 0, 2, netBuffer) < 2)
    {
        Print("Error reading WiseNet filter buffer.");
        return false;
    }
    return true;
}


// Max Position Control
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
    // Indicator handle is the main handle for the signal generating indicator.
    /*IndicatorHandle = iMA(Symbol(), Period(), MA_Period, MA_Shift, MA_Mode, MA_Price);
    if (IndicatorHandle == INVALID_HANDLE)
    {
        PrintFormat("Unable to create main indicator handle - %s - %d.", GetLastErrorText(GetLastError()), GetLastError());
        return false;
    }*/
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
    // Use the standard Trade object to open the position with calculated parameters.
    if (!Trade.Buy(Size, Symbol(), OpenPrice, StopLossPrice, TakeProfitPrice))
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
    // Use the standard Trade object to open the position with calculated parameters.
    if (!Trade.Sell(Size, Symbol(), OpenPrice, StopLossPrice, TakeProfitPrice))
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

// Retrieve indicator data necessary for entry, update, and exit.
// Boolean type, so it can return true if all the data is available or false if it is not.
// Other advantage of this function is to move part of repetitive code into one location to make it leaner.
// Retrieve indicator data necessary for entry, update, and exit.
bool GetIndicatorsData()
{
    double buf[2]; // Needed for CopyBuffer().
    int count; // Will store the number of array elements returned by CopyBuffer().
    bool AllDataAvailable = false;
    int MaxAttemptsForData = 5;
    int DelayBetweenAttempts = 200; // Milliseconds.
    int Attempt = 0;

    while ((!AllDataAvailable) && (Attempt < MaxAttemptsForData))
    {
        AllDataAvailable = true;

        count = CopyBuffer(ATRHandle, 0, 0, 2, buf); // Copy using ATR indicator handle 2 latest values from 0th buffer to the buf array.
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

        if ((UseWiseNetFilter || UseWiseNetLocationFilter) && CopyBuffer(WiseNetFilterHandle, 0, 0, 2, netBuffer) < 2)
        {
            Print("Error reading WiseNet filter buffer.");
            AllDataAvailable = false;
        }




        // Fetch VWAP Filter data
        if(UseVWAPDailyFilter || UseVWAPDailyLocationFilter)
        {
           if(CopyBuffer(handleVWAPDaily, 0, 0, 2, vwapDailyBuffer) < 2)  // Buffer 0 = Daily
           {
              Print("Error reading Daily VWAP buffer.");
              AllDataAvailable = false;
           }
        }
        
        if(UseVWAPWeeklyFilter || UseVWAPWeeklyLocationFilter)
        {
           if(CopyBuffer(handleVWAPWeekly, 1, 0, 2, vwapWeeklyBuffer) < 2)  // Buffer 1 = Weekly
           {
              Print("Error reading Weekly VWAP buffer.");
              AllDataAvailable = false;
           }
        }

        if (UseWiseDayLineFilter && CopyBuffer(handleWiseDayLine, 0, 0, 2, dayLineBuffer) < 2)
        {
            Print("Error reading WiseDayLine buffer.");
            AllDataAvailable = false;
        }

        if (!AllDataAvailable)
        {
            Attempt++;
            Sleep(DelayBetweenAttempts);
        }
    }

    if (!AllDataAvailable)
    {
        Print("Unable to get some data for the entry signal, skipping candle.");
        return false;
    }

    return true;
}




//+------------------------------------------------------------------+
//| Function to check if the current bar is a swing high             |
//+------------------------------------------------------------------+
bool checkSwingHigh(int curr_bar, int length)
{
    for (int a = 1; a <= length; a++)
    {
        int right_index = curr_bar - a;
        int left_index = curr_bar + a;
        if ((high(curr_bar) < high(right_index)) || (high(curr_bar) < high(left_index)))
            return false;
    }
    return true;
}

//+------------------------------------------------------------------+
//| Function to check if the current bar is a swing low              |
//+------------------------------------------------------------------+
bool checkSwingLow(int curr_bar, int length)
{
    for (int a = 1; a <= length; a++)
    {
        int right_index = curr_bar - a;
        int left_index = curr_bar + a;
        if ((low(curr_bar) > low(right_index)) || (low(curr_bar) > low(left_index)))
            return false;
    }
    return true;
}

//+------------------------------------------------------------------+
//| Function to check for buy break (upper sweep -> SELL)            |
//+------------------------------------------------------------------+
datetime lastBuySignalTime = 0;

void checkBuyBreak(double Ask, double &swing_H, int length)
{
    if ((UseTradingHours) && (!IsCurrentTimeInInterval(TradingHourStart, TradingHourEnd))) return;

    bool SellSidePass = false;  // was BuySignal

    double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
    if (swing_H > 0 && Ask > swing_H)
    {
        // SWITCH TO SELL FILTER STACK so shorts require price BELOW filters
        if (IsValidSellSignal(bid)
            && IsValidTrendSellSignal(bid)
            && IsValidSellLocationSignal(bid)
            && IsValidSellMaturitySignal()
            && IsValidSellPullbackSignal(bid))
        {
            if (iTime(_Symbol, _Period, 0) - lastBuySignalTime >= SignalRefreshPeriod * PeriodSeconds(_Period))
            {
                SellSidePass = true;
                lastBuySignalTime = iTime(_Symbol, _Period, 0);
            }
        }
    }

    if (SellSidePass)
    {
        int swing_H_index = findSwingIndex(swing_H, length, true);
        datetime breakTime = time(0);
        drawBreakLevel(TimeToString(breakTime), time(swing_H_index), high(swing_H_index), breakTime, high(swing_H_index), clrBlue, -1);
        if (OpenSell())
        {
           BearBreakCount++;
           BullBreakCount = 0; // Reset opposite side on structure flip
           LastBearBreakPrice = bid;
           LastBearBreakTime = time(0);
        }
        swing_H = -1.0;
    }
}

//+------------------------------------------------------------------+
//| Function to check for sell break (lower sweep -> BUY)            |
//+------------------------------------------------------------------+
datetime lastSellSignalTime = 0;

void checkSellBreak(double Bid, double &swing_L, int length)
{
    if ((UseTradingHours) && (!IsCurrentTimeInInterval(TradingHourStart, TradingHourEnd))) return;

    bool BuySidePass = false;  // was SellSignal

    double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
    if (swing_L > 0 && Bid < swing_L)
    {
        // SWITCH TO BUY FILTER STACK so longs require price ABOVE filters
        if (IsValidBuySignal(ask)
            && IsValidTrendBuySignal(ask)
            && IsValidBuyLocationSignal(ask)
            && IsValidBuyMaturitySignal()
            && IsValidBuyPullbackSignal(ask))
        {
            if (iTime(_Symbol, _Period, 0) - lastSellSignalTime >= SignalRefreshPeriod * PeriodSeconds(_Period))
            {
                BuySidePass = true;
                lastSellSignalTime = iTime(_Symbol, _Period, 0);
            }
        }
    }

    if (BuySidePass)
    {
        int swing_L_index = findSwingIndex(swing_L, length, false);
        datetime breakTime = time(0);
        drawBreakLevel(TimeToString(breakTime), time(swing_L_index), low(swing_L_index), breakTime, low(swing_L_index), clrRed, 1);
        if (OpenBuy())
        {
           BullBreakCount++;
           BearBreakCount = 0; // Reset opposite side on structure flip
           LastBullBreakPrice = ask;
           LastBullBreakTime = time(0);
        }
        swing_L = -1.0;
    }
}


//+------------------------------------------------------------------+
//| Function to find the swing index                                 |
//+------------------------------------------------------------------+
int findSwingIndex(double swing_price, int length, bool isHigh)
{
    for (int i = 0; i <= length * 2 + 1000; i++)
    {
        double price = isHigh ? high(i) : low(i);
        if (price == swing_price)
            return i;
    }
    return -1;
}

//+------------------------------------------------------------------+
//| Utility functions                                                |
//+------------------------------------------------------------------+
double high(int index) { return (iHigh(_Symbol, _Period, index)); }
double low(int index) { return (iLow(_Symbol, _Period, index)); }
datetime time(int index) { return (iTime(_Symbol, _Period, index)); }

void drawSwingPoint(string objName, datetime time, double price, int arrCode, color clr, int direction)
{
    if (ObjectFind(0, objName) < 0)
    {
        ObjectCreate(0, objName, OBJ_ARROW, 0, time, price);
        ObjectSetInteger(0, objName, OBJPROP_ARROWCODE, arrCode);
        ObjectSetInteger(0, objName, OBJPROP_COLOR, clr);
        ObjectSetInteger(0, objName, OBJPROP_FONTSIZE, 10);
        if (direction > 0)
            ObjectSetInteger(0, objName, OBJPROP_ANCHOR, ANCHOR_TOP);
        if (direction < 0)
            ObjectSetInteger(0, objName, OBJPROP_ANCHOR, ANCHOR_BOTTOM);
    }

    string text = "BoS";
    string objName_Descr = objName + text;
    ObjectCreate(0, objName_Descr, OBJ_TEXT, 0, time, price);
    ObjectSetInteger(0, objName_Descr, OBJPROP_COLOR, clr);
    ObjectSetInteger(0, objName_Descr, OBJPROP_FONTSIZE, 10);

    if (direction > 0)
    {
        ObjectSetString(0, objName_Descr, OBJPROP_TEXT, " " + text);
        ObjectSetInteger(0, objName_Descr, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
    }
    if (direction < 0)
    {
        ObjectSetString(0, objName_Descr, OBJPROP_TEXT, " " + text);
        ObjectSetInteger(0, objName_Descr, OBJPROP_ANCHOR, ANCHOR_LEFT_LOWER);
    }

    ChartRedraw(0);
}

void drawBreakLevel(string objName, datetime time1, double price1, datetime time2, double price2, color clr, int direction)
{
    if (ObjectFind(0, objName) < 0)
    {
        ObjectCreate(0, objName, OBJ_TREND, 0, time1, price1, time2, price1);
        ObjectSetInteger(0, objName, OBJPROP_COLOR, clr);
        ObjectSetInteger(0, objName, OBJPROP_STYLE, STYLE_SOLID);
        ObjectSetInteger(0, objName, OBJPROP_WIDTH, 2);
    }

    string text = "Break";
    string objName_Descr = objName + text;
    ObjectCreate(0, objName_Descr, OBJ_TEXT, 0, time2, price2);
    ObjectSetInteger(0, objName_Descr, OBJPROP_COLOR, clr);
    ObjectSetInteger(0, objName_Descr, OBJPROP_FONTSIZE, 10);

    if (direction > 0)
    {
        ObjectSetString(0, objName_Descr, OBJPROP_TEXT, text + " ");
        ObjectSetInteger(0, objName_Descr, OBJPROP_ANCHOR, ANCHOR_RIGHT_UPPER);
    }
    if (direction < 0)
    {
        ObjectSetString(0, objName_Descr, OBJPROP_TEXT, text + " ");
        ObjectSetInteger(0, objName_Descr, OBJPROP_ANCHOR, ANCHOR_RIGHT_LOWER);
    }

    ChartRedraw(0);
}


// Exit signal
void CheckExitSignal()
{
    //!! if ((UseTradingHours) && (!IsCurrentTimeInInterval(TradingHourStart, TradingHourEnd))) return; // Trading hours restrictions for exit. Normally, you don't want to restrict exit by hours. Still, it's a possibility.

    bool SignalExitLong = false;
    bool SignalExitShort = false;

    //!! Uncomment and modify these exit signal checks:
    //if ((Indicator_current > iClose(Symbol(), Period(), 1)) && (Indicator_previous <= iClose(Symbol(), Period(), 2))) SignalExitShort = true; // Check if the indicator's value crossed the Close price level from below.
    //else if ((Indicator_current < iClose(Symbol(), Period(), 1)) && (Indicator_previous >= iClose(Symbol(), Period(), 2))) SignalExitLong = true; // Check if the indicator's value crossed the Close price level from above.

    if (SignalExitLong) CloseAllBuy();
    if (SignalExitShort) CloseAllSell();
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
    int total = PositionsTotal();

    // Start a loop to scan all the positions.
    // The loop starts from the last, otherwise it could skip positions.
    for (int i = total - 1; i >= 0; i--)
    {
        // If the position cannot be selected log an error.
        if (PositionGetSymbol(i) == "")
        {
            Print(__FUNCTION__, ": ERROR - Unable to select the position - ", GetLastError());
            continue;
        }
        if (PositionGetString(POSITION_SYMBOL) != Symbol()) continue; // Only close current symbol trades.
        if (PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue; // Only close own positions.

        int position_ticket = (int)PositionGetInteger(POSITION_TICKET);

        // Retrieve the history of deals and orders for that position to check if it hasn't been already partially closed.
        if (!HistorySelectByPosition(PositionGetInteger(POSITION_IDENTIFIER)))
        {
            PrintFormat("ERROR - Unable to get position history for %d - %s - %d", position_ticket, GetLastErrorText(GetLastError()), GetLastError());
            continue;
        }

        bool need_partial_close = true;

        // Process partial close for a long position.
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
                if (HistoryDealGetInteger(deal_ticket, DEAL_TYPE) == DEAL_TYPE_SELL) // Looks like this long position has already been partially closed at least once.
                {
                    need_partial_close = false;
                    break; // No need to partially close this position.
                }
            }
            // Condition for partial close of a long position.
            if ((need_partial_close) && (SymbolInfoDouble(Symbol(), SYMBOL_BID) - PositionGetDouble(POSITION_PRICE_OPEN) > ATR_previous * ATRMultiplierPC))
            {
                PartialClose(position_ticket, PartialClosePerc);
            }
        }
        // Process partial close for a short position.
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
                if (HistoryDealGetInteger(deal_ticket, DEAL_TYPE) == DEAL_TYPE_BUY) // Looks like this short position has already been partially closed at least once.
                {
                    need_partial_close = false;
                    break; // No need to partially close this position.
                }
            }
            // Condition for partial close of a short position.
            if ((need_partial_close) && (PositionGetDouble(POSITION_PRICE_OPEN) - SymbolInfoDouble(Symbol(), SYMBOL_ASK) > ATR_previous * ATRMultiplierPC))
            {
                PartialClose(position_ticket, PartialClosePerc);
            }
            return;
        }
    }
}
//+------------------------------------------------------------------+

//+------------------------------------------------------------------+
//| Function to handle breakeven logic                               |
//+------------------------------------------------------------------+
void BreakEvenLogic()
{
    if (!EnableBreakEven) return;

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

// Scan for Profit before trail
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
//| Function to implement MA trailing stop logic                     |
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
        if ((PositionGetString(POSITION_SYMBOL) != Symbol())) continue;

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
        // Adjust for tick size granularity.
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
//| Function to implement PSAR trailing stop logic                   |
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
        if ((PositionGetString(POSITION_SYMBOL) != Symbol())) continue;

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
        // Adjust for tick size granularity.
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
//| Function to implement AMA trailing stop logic                    |
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
        if ((PositionGetString(POSITION_SYMBOL) != Symbol())) continue;

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
        // Adjust for tick size granularity.
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
//| Function to implement Fractal trailing stop logic                |
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
        if (PositionGetString(POSITION_SYMBOL) != Symbol()) continue;

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
        // Adjust for tick size granularity.
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
        if (PositionGetString(POSITION_SYMBOL) != Symbol()) continue;

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
        // Adjust for tick size granularity.
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
//| Function to modify orders                                        |
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

// Maturity Filter
bool IsValidBuyMaturitySignal()
{
   if(!UseBreakMaturityGate) return true;
   return BullBreakCount < MaxBullBreakCount;
}

bool IsValidSellMaturitySignal()
{
   if(!UseBreakMaturityGate) return true;
   return BearBreakCount < MaxBearBreakCount;
}

// Pullback Gate
bool IsValidBuyPullbackSignal(double ask)
{
   if(!UsePullbackGate) return true;

   int highestBar = iHighest(_Symbol, _Period, MODE_HIGH, PullbackLookbackBars, 1);
   int lowestBar = iLowest(_Symbol, _Period, MODE_LOW, PullbackLookbackBars, 1);
   
   double impulseHigh = iHigh(_Symbol, _Period, highestBar);
   double impulseLow = iLow(_Symbol, _Period, lowestBar);
   double range = impulseHigh - impulseLow;

   if(range <= 0.0) return true;

   double pullbackFraction = (impulseHigh - ask) / range;
   return pullbackFraction >= MinBuyPullbackFraction;
}

bool IsValidSellPullbackSignal(double bid)
{
   if(!UsePullbackGate) return true;

   int highestBar = iHighest(_Symbol, _Period, MODE_HIGH, PullbackLookbackBars, 1);
   int lowestBar = iLowest(_Symbol, _Period, MODE_LOW, PullbackLookbackBars, 1);
   
   double impulseHigh = iHigh(_Symbol, _Period, highestBar);
   double impulseLow = iLow(_Symbol, _Period, lowestBar);
   double range = impulseHigh - impulseLow;

   if(range <= 0.0) return true;

   double pullbackFraction = (bid - impulseLow) / range;
   return pullbackFraction >= MinSellPullbackFraction;
}

//+------------------------------------------------------------------+
//| Location Filter Helpers                                          |
//+------------------------------------------------------------------+
bool IsUsableLocationNumber(const double value)
{
   return MathIsValidNumber(value) && (value != EMPTY_VALUE);
}

void PrintLocationReject(const string side, const string anchorName, const double distATR, const double maxATR)
{
   if(!DebugLocationFilter) return;
   PrintFormat("%s location reject: %s distance %.2f ATR > max %.2f ATR",
               side, anchorName, distATR, maxATR);
}

// For buys:
// reverseLogic = false  -> extension is price ABOVE anchor
// reverseLogic = true   -> extension is price BELOW anchor
double GetBuyExtensionATR(const double price, const double anchor, const bool reverseLogic = false)
{
   if(ATR_previous <= 0.0) return DBL_MAX;

   double rawDist = reverseLogic ? (anchor - price) : (price - anchor);
   return rawDist / ATR_previous;
}

// For sells:
// reverseLogic = false  -> extension is price BELOW anchor
// reverseLogic = true   -> extension is price ABOVE anchor
double GetSellExtensionATR(const double price, const double anchor, const bool reverseLogic = false)
{
   if(ATR_previous <= 0.0) return DBL_MAX;

   double rawDist = reverseLogic ? (price - anchor) : (anchor - price);
   return rawDist / ATR_previous;
}

bool IsValidBuyLocationSignal(double ask)
{
   if(!UseLocationFilter) return true;

   if(!MathIsValidNumber(ask) || (ATR_previous <= 0.0) || (ATR_previous == EMPTY_VALUE))
   {
      if(DebugLocationFilter) Print("BUY location reject: ATR not ready.");
      return false;
   }

   // Local mean leash
   if(UseWiseNetLocationFilter)
   {
      if(!IsUsableLocationNumber(netBuffer[0]))
      {
         if(DebugLocationFilter) Print("BUY location reject: WiseNet buffer not ready.");
         return false;
      }

      double distWiseNetATR = GetBuyExtensionATR(ask, netBuffer[0], false);
      if(distWiseNetATR > MaxBuyWiseNetDistATR)
      {
         PrintLocationReject("BUY", "WiseNet", distWiseNetATR, MaxBuyWiseNetDistATR);
         return false;
      }
   }

   // Session leash
   if(UseVWAPDailyLocationFilter)
   {
      if(!IsUsableLocationNumber(vwapDailyBuffer[0]))
      {
         if(DebugLocationFilter) Print("BUY location reject: Daily VWAP buffer not ready.");
         return false;
      }

      double distDailyVWAPATR = GetBuyExtensionATR(ask, vwapDailyBuffer[0], ReverseVWAPDailyLogic);
      if(distDailyVWAPATR > MaxBuyVWAPDailyDistATR)
      {
         PrintLocationReject("BUY", "Daily VWAP", distDailyVWAPATR, MaxBuyVWAPDailyDistATR);
         return false;
      }
   }

   // Broader leash
   if(UseVWAPWeeklyLocationFilter)
   {
      if(!IsUsableLocationNumber(vwapWeeklyBuffer[0]))
      {
         if(DebugLocationFilter) Print("BUY location reject: Weekly VWAP buffer not ready.");
         return false;
      }

      double distWeeklyVWAPATR = GetBuyExtensionATR(ask, vwapWeeklyBuffer[0], ReverseVWAPWeeklyLogic);
      if(distWeeklyVWAPATR > MaxBuyVWAPWeeklyDistATR)
      {
         PrintLocationReject("BUY", "Weekly VWAP", distWeeklyVWAPATR, MaxBuyVWAPWeeklyDistATR);
         return false;
      }
   }

   return true;
}

bool IsValidSellLocationSignal(double bid)
{
   if(!UseLocationFilter) return true;

   if(!MathIsValidNumber(bid) || (ATR_previous <= 0.0) || (ATR_previous == EMPTY_VALUE))
   {
      if(DebugLocationFilter) Print("SELL location reject: ATR not ready.");
      return false;
   }

   // Local mean leash
   if(UseWiseNetLocationFilter)
   {
      if(!IsUsableLocationNumber(netBuffer[0]))
      {
         if(DebugLocationFilter) Print("SELL location reject: WiseNet buffer not ready.");
         return false;
      }

      double distWiseNetATR = GetSellExtensionATR(bid, netBuffer[0], false);
      if(distWiseNetATR > MaxSellWiseNetDistATR)
      {
         PrintLocationReject("SELL", "WiseNet", distWiseNetATR, MaxSellWiseNetDistATR);
         return false;
      }
   }

   // Session leash
   if(UseVWAPDailyLocationFilter)
   {
      if(!IsUsableLocationNumber(vwapDailyBuffer[0]))
      {
         if(DebugLocationFilter) Print("SELL location reject: Daily VWAP buffer not ready.");
         return false;
      }

      double distDailyVWAPATR = GetSellExtensionATR(bid, vwapDailyBuffer[0], ReverseVWAPDailyLogic);
      if(distDailyVWAPATR > MaxSellVWAPDailyDistATR)
      {
         PrintLocationReject("SELL", "Daily VWAP", distDailyVWAPATR, MaxSellVWAPDailyDistATR);
         return false;
      }
   }

   // Broader leash
   if(UseVWAPWeeklyLocationFilter)
   {
      if(!IsUsableLocationNumber(vwapWeeklyBuffer[0]))
      {
         if(DebugLocationFilter) Print("SELL location reject: Weekly VWAP buffer not ready.");
         return false;
      }

      double distWeeklyVWAPATR = GetSellExtensionATR(bid, vwapWeeklyBuffer[0], ReverseVWAPWeeklyLogic);
      if(distWeeklyVWAPATR > MaxSellVWAPWeeklyDistATR)
      {
         PrintLocationReject("SELL", "Weekly VWAP", distWeeklyVWAPATR, MaxSellVWAPWeeklyDistATR);
         return false;
      }
   }

   return true;
}

//+------------------------------------------------------------------+
//| Signal Validation                                                |
//+------------------------------------------------------------------+
bool IsValidBuySignal(double ask)
{
    return true;
}

bool IsValidSellSignal(double bid)
{
    return true;
}


bool IsValidWiseDayLineBuySignal(double ask)
{
    if (!UseWiseDayLineFilter) return true;

    double dayLineValue;
    if (CopyBuffer(handleWiseDayLine, WiseDayLineBuffer, 0, 1, dayLineBuffer) < 1)
    {
        Print("Error reading WiseDayLine buffer.");
        return false;
    }
    dayLineValue = dayLineBuffer[0];

    return ask > dayLineValue;
}

bool IsValidWiseDayLineSellSignal(double bid)
{
    if (!UseWiseDayLineFilter) return true;

    double dayLineValue;
    if (CopyBuffer(handleWiseDayLine, WiseDayLineBuffer, 0, 1, dayLineBuffer) < 1)
    {
        Print("Error reading WiseDayLine buffer.");
        return false;
    }
    dayLineValue = dayLineBuffer[0];

    return bid < dayLineValue;
}

bool IsValidVWAPDailyBuySignal(double ask)
{
   if(!UseVWAPDailyFilter) return true;
   double vwapDailyValue = vwapDailyBuffer[0];
   if(ReverseVWAPDailyLogic)
      return ask < vwapDailyValue;
   else
      return ask > vwapDailyValue;
}

bool IsValidVWAPDailySellSignal(double bid)
{
   if(!UseVWAPDailyFilter) return true;
   double vwapDailyValue = vwapDailyBuffer[0];
   if(ReverseVWAPDailyLogic)
      return bid > vwapDailyValue;
   else
      return bid < vwapDailyValue;
}

bool IsValidVWAPWeeklyBuySignal(double ask)
{
   if(!UseVWAPWeeklyFilter) return true;
   double vwapWeeklyValue = vwapWeeklyBuffer[0];
   if(ReverseVWAPWeeklyLogic)
      return ask < vwapWeeklyValue;
   else
      return ask > vwapWeeklyValue;
}

bool IsValidVWAPWeeklySellSignal(double bid)
{
   if(!UseVWAPWeeklyFilter) return true;
   double vwapWeeklyValue = vwapWeeklyBuffer[0];
   if(ReverseVWAPWeeklyLogic)
      return bid > vwapWeeklyValue;
   else
      return bid < vwapWeeklyValue;
}

bool IsValidTrendBuySignal(double ask)
{
    if (!EnableTrendFiltering)
        return true;

    bool isValidWiseNet = IsValidWiseNetBuySignal(ask);
    bool isValidWiseDayLine = IsValidWiseDayLineBuySignal(ask);
    bool isValidVWAPDaily = IsValidVWAPDailyBuySignal(ask);
    bool isValidVWAPWeekly = IsValidVWAPWeeklyBuySignal(ask);

    return isValidWiseNet && isValidWiseDayLine && isValidVWAPDaily && isValidVWAPWeekly;
}

bool IsValidTrendSellSignal(double bid)
{
    if (!EnableTrendFiltering)
        return true;

    bool isValidWiseNet = IsValidWiseNetSellSignal(bid);
    bool isValidWiseDayLine = IsValidWiseDayLineSellSignal(bid);
    bool isValidVWAPDaily = IsValidVWAPDailySellSignal(bid);
    bool isValidVWAPWeekly = IsValidVWAPWeeklySellSignal(bid);

    return isValidWiseNet && isValidWiseDayLine && isValidVWAPDaily && isValidVWAPWeekly;
}

bool IsValidWiseNetBuySignal(double ask)
{
    if (!UseWiseNetFilter) return true;

    double netValue;
    if (CopyBuffer(WiseNetFilterHandle, 0, 0, 1, netBuffer) < 1)
    {
        Print("Error reading WiseNet buffer.");
        return false;
    }
    netValue = netBuffer[0];

    return ask > netValue;
}

bool IsValidWiseNetSellSignal(double bid)
{
    if (!UseWiseNetFilter) return true;

    double netValue;
    if (CopyBuffer(WiseNetFilterHandle, 0, 0, 1, netBuffer) < 1)
    {
        Print("Error reading WiseNet buffer.");
        return false;
    }
    netValue = netBuffer[0];

    return bid < netValue;
}

void CloseByTime()
{
   datetime currentTime = TimeCurrent();
   MqlDateTime struct_time;
   TimeToStruct(currentTime, struct_time);
   
   // Check if it's time to close
   if(struct_time.hour == CloseHour && struct_time.min == CloseMinute)
   {
      int total = PositionsTotal();
      
      // Loop through all positions
      for(int i = total - 1; i >= 0; i--)
      {
         ulong ticket = PositionGetTicket(i);
         
         if(ticket <= 0)
         {
            Print("PositionGetTicket failed " + IntegerToString(GetLastError()) + ".");
            continue;
         }
         
         if(PositionSelectByTicket(ticket) == false)
         {
            int Error = GetLastError();
            string ErrorText = GetLastErrorText(Error);
            Print("ERROR - Unable to select the position #", IntegerToString(ticket), " - ", Error);
            Print("ERROR - ", ErrorText);
            continue;
         }
         
         if(PositionGetString(POSITION_SYMBOL) != Symbol())
            continue;
         
         if(PositionGetInteger(POSITION_MAGIC) != MagicNumber)
            continue;
         
         // Close the position
         if(!Trade.PositionClose(ticket))
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
