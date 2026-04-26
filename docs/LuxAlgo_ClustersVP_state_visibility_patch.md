```mql5
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
```

```mql5
int line_style = STYLE_DASH;
int line_width = 2;
color state_color = clusterColor;
color text_color = ReadableTextColor(clusterColor);

if(status == LEVEL_FRESH) { line_style = STYLE_SOLID; line_width = 2; }
else if(status == LEVEL_TESTED) { line_style = STYLE_DASH; line_width = 2; }
else if(status == LEVEL_REJECTED) { line_style = STYLE_DASHDOT; line_width = 3; }
else if(status == LEVEL_ACCEPTED) { line_style = STYLE_SOLID; line_width = 4; }
else if(status == LEVEL_BROKEN) { line_style = STYLE_DOT; line_width = 4; state_color = clusterColor; }
else if(status == LEVEL_RECLAIMED) { line_style = STYLE_DASHDOTDOT; line_width = 3; }

DrawLine(cur_lines++, calcStartTime, pocY, vpStartTime, state_color, line_style, line_width);
DrawText("POCTxt_", cur_txt_poc++, calcStartTime, pocY, FormatVolume(vol), text_color, ANCHOR_RIGHT_LOWER);

string stat_text = "[" + TfLabel(g_calc_tf) + "] Vol: " + FormatVolume(c_total_vol) + " " + GetStateString(LevelStates[c_id]);
string vel_text = StringFormat("[%s] Velocity: [%s | %s | %s]", TfLabel(g_calc_tf), LevelStates[c_id].regime_dir, LevelStates[c_id].regime_auc, LevelStates[c_id].regime_vol);

DrawText("TotTxt_", cur_txt_tot++, endXTime, pocY, stat_text, text_color, ANCHOR_LEFT_LOWER);
DrawText("VelTxt_", cur_txt_vel++, endXTime, pocY, vel_text, text_color, ANCHOR_LEFT_UPPER);
```
