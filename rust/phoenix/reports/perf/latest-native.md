# Phoenix Native Performance Report

Generated at: `1775082420800`
Budget failures: `0`

## Shortrun

- Path: `\\?\C:\Users\shuga\1kittroot\1code\Angular-build\docs\shortrun.md`
- Input bytes: `159085`
- Snapshot bytes: `925431`
- Budget status: `passing`

| Phase | Wall ms | Peak delta MiB | Output bytes |
| --- | ---: | ---: | ---: |
| init_runtime | 12 | 0.03 | 0 |
| create_session | 0 | 0.02 | 0 |
| analyze_text | 84 | 23.16 | 599954 |
| excerpt_scan | 10 | 0.96 | 1235484 |
| excerpt_structure | 1 | 0.71 | 496466 |
| ingest_document | 357 | 12.84 | 57294 |
| commit_session | 30 | 4.64 | 2086 |
| rebuild_lex | 46 | 4.63 | 2092 |
| session_state | 0 | 0.02 | 2014 |
| session_stats | 0 | 0.02 | 251 |
| graph_delta | 20 | 3.56 | 127155 |
| snapshot_export | 74 | 12.17 | 925431 |
| snapshot_import | 111 | 13.00 | 925431 |
| restore_query | 0 | 0.05 | 639 |
| lexical_query_batch | 1 | 0.10 | 140 |
| graph_query_batch | 18 | 1.11 | 99 |

## Perfect Run

- Path: `\\?\C:\Users\shuga\1kittroot\1code\Angular-build\docs\perfect_run.md`
- Input bytes: `2859630`
- Snapshot bytes: `17121231`
- Budget status: `passing`

| Phase | Wall ms | Peak delta MiB | Output bytes |
| --- | ---: | ---: | ---: |
| init_runtime | 8 | 0.03 | 0 |
| create_session | 0 | 0.02 | 0 |
| analyze_text | 1307 | 365.15 | 10536371 |
| excerpt_scan | 8 | 0.96 | 1210192 |
| excerpt_structure | 1 | 0.70 | 486896 |
| ingest_document | 5860 | 176.70 | 76508 |
| commit_session | 648 | 85.39 | 2103 |
| rebuild_lex | 1073 | 85.39 | 2104 |
| session_state | 0 | 0.06 | 9092 |
| session_stats | 0 | 0.06 | 265 |
| graph_delta | 348 | 58.52 | 2499953 |
| snapshot_export | 1369 | 204.06 | 17121231 |
| snapshot_import | 2202 | 194.14 | 17121231 |
| restore_query | 1 | 0.10 | 678 |
| lexical_query_batch | 16 | 1.62 | 140 |
| graph_query_batch | 339 | 17.09 | 99 |
