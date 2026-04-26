# Wyckoff Spring Signal Design

Saved from the Phoenix research thread on 2026-04-21.

## Core Read

A spring is not a candle pattern. It is a failed range break.

The range is the noun. The spring is an event attached to the range:

```text
Spring = range-edge excursion + failed acceptance + reclaim
```

For a bullish spring, price pierces below range support, fails to gain acceptance below the range, then reclaims back inside. For the top-side mirror, Wyckoff usually calls it an upthrust or UTAD, but mechanically it can use the same failed-excursion primitive against range resistance.

## Existing Code Fit

The current template already has most of the required substrate:

- `SRange.high`, `SRange.low`, `consec_above`, `consec_below`
- `RANGE_ACTIVE` and `RANGE_BROKEN`
- `LEVEL_BROKEN`, `LEVEL_RECLAIMED`, `max_break_dist`, `reclaim_success`
- `RegisterRangeBreak(...)`

The current gap is that the range can become broken too early. A spring lives in the suspended moment between "price left the range" and "price accepted outside the range."

## State Machine

```text
RANGE_ACTIVE
  -> SPRING_ARMED
      price touches an edge band

  -> SPRING_EXCURSION
      wick, high, or low breaches the boundary

  -> SPRING_RECLAIM_PENDING
      outside extreme exists, waiting for close back inside

  -> SPRING_CONFIRMED
      close reclaims boundary and optional follow-through passes

  -> SPRING_FAILED
      timeout, too much outside acceptance, or break too deep

  -> RANGE_BROKEN
      accepted outside after failure or timeout
```

The range should not die on first breach. It should die only after acceptance outside the boundary.

## Bullish Spring

```text
boundary = range.low

1. Price pierces below range.low.
2. The low reaches a measurable outside extreme.
3. Price closes back above range.low within N bars.
4. Follow-through confirms, ideally above the spring candle high, midpoint, or POC.
5. If price accepts below the range instead, it was a break, not a spring.
```

## Bearish Upthrust

```text
boundary = range.high

1. Price pierces above range.high.
2. The high reaches a measurable outside extreme.
3. Price closes back below range.high within N bars.
4. Follow-through confirms lower.
5. If price accepts above the range instead, it was a break, not a spring.
```

## Measurements

Every event should become measurable:

```text
boundary_price
extreme_price
penetration_pips
penetration_atr
penetration_range_fraction
bars_outside
bars_to_reclaim
wick_rejection_ratio
close_reclaim_distance
snapback_distance
snapback_atr
followthrough_distance
followthrough_atr
acceptance_debt
spring_score
```

Core formulas:

```text
penetration = abs(extreme_price - boundary_price)
penetration_atr = penetration / ATR_previous
penetration_range_fraction = penetration / max(range.high - range.low, _Point)
bars_to_reclaim = reclaim_bar_index - excursion_bar_index
snapback_distance = abs(reclaim_close - extreme_price)
spring_efficiency = snapback_distance / max(penetration, _Point)
```

Too shallow is noise. Too deep is a real break. Depth should score like a useful band, not "more is always better."

Suggested defaults to test:

```text
ideal penetration: 0.15 to 0.60 ATR
too deep: above 1.0 ATR or above 35-50% of range width
```

## Acceptance Rules

Acceptance is the border between spring and break.

Bullish:

```text
outside if close < range.low - buffer
reclaimed if close > range.low
failed if closes outside for K bars
failed if low travels too far below range.low
confirmed if reclaimed within N bars
```

Bearish:

```text
outside if close > range.high + buffer
reclaimed if close < range.high
failed if closes outside for K bars
failed if high travels too far above range.high
confirmed if reclaimed within N bars
```

`breakoutCandles` can become the acceptance threshold instead of an immediate range kill switch.

## Drawing Model

The drawing should show measurement, not only a human-readable circle.

Use three visuals:

1. Spring pocket: a thin rectangle outside the range from boundary to extreme, spanning excursion start to reclaim or timeout.
2. Reclaim arrow: a vector from the extreme back to boundary or reclaim close.
3. State label: compact metrics like `SPR 0.42ATR / 3b / 78`.

Color states:

```text
pending: yellow or orange
confirmed bullish spring: teal or green
confirmed bearish upthrust: magenta or red
failed: slate or gray
invalidated: dark red
```

## Event Struct Sketch

```cpp
enum ENUM_SPRING_SIDE {
   SPRING_BULL = -1,
   SPRING_BEAR = 1
};

enum ENUM_SPRING_STATE {
   SPRING_ARMED,
   SPRING_EXCURSION,
   SPRING_RECLAIM_PENDING,
   SPRING_CONFIRMED,
   SPRING_FAILED,
   SPRING_INVALIDATED
};

struct SSpringEvent {
   int               id;
   int               range_id;
   ENUM_SPRING_SIDE  side;
   ENUM_SPRING_STATE state;

   datetime          t_start;
   datetime          t_extreme;
   datetime          t_reclaim;
   datetime          t_end;

   double            boundary;
   double            extreme;
   double            reclaim_close;

   double            penetration_pips;
   double            penetration_atr;
   double            penetration_range_frac;

   int               bars_outside;
   int               bars_to_reclaim;

   double            wick_rejection_ratio;
   double            snapback_atr;
   double            acceptance_debt;
   double            score;
};
```

## Architecture

Keep responsibilities clean:

```text
Range Engine:
  detects boxes and owns high, low, and midpoint

Spring Engine:
  detects failed excursions around range edges

POC Engine:
  scores auction quality and rejection or acceptance context

Signal Engine:
  decides whether the event matters for entry logic
```

The POC indicator should enrich the spring score, not own the spring detection. The boundary is range truth. POC, volume, centroid, and velocity are supporting evidence.
