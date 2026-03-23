# Phoenix Native Performance Report

Generated at: `1774279139980`
Budget failures: `0`

## Perfect Run

- Path: `\\?\C:\Users\shuga\1kittroot\1code\Angular-build\docs\perfect_run.md`
- Input bytes: `2859630`
- Snapshot bytes: `20040428`
- Budget status: `passing`

| Phase | Wall ms | Peak delta MiB | Output bytes |
| --- | ---: | ---: | ---: |
| init_runtime | 5 | 0.03 | 0 |
| create_session | 0 | 0.02 | 0 |
| analyze_text | 723 | 150.48 | 10536371 |
| excerpt_scan | 11 | 0.98 | 1206688 |
| excerpt_structure | 1 | 0.73 | 493698 |
| ingest_document | 8362 | 320.07 | 75212 |
| commit_session | 829 | 205.94 | 1978 |
| rebuild_lex | 1548 | 205.94 | 1979 |
| session_state | 0 | 0.03 | 4706 |
| session_stats | 0 | 0.03 | 245 |
| graph_delta | 211 | 55.65 | 2157579 |
| snapshot_export | 1503 | 353.92 | 20040428 |
| snapshot_import | 2816 | 342.43 | 20040428 |
| restore_query | 1 | 0.10 | 664 |
| lexical_query_batch | 15 | 1.60 | 140 |
| graph_query_batch | 409 | 56.34 | 99 |
