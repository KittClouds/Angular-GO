# Phoenix Native Performance Report

Generated at: `1774415011354`
Budget failures: `0`

## Shortrun

- Path: `\\?\C:\Users\shuga\1kittroot\1code\Angular-build\docs\shortrun.md`
- Input bytes: `159085`
- Snapshot bytes: `931859`
- Budget status: `passing`

| Phase | Wall ms | Peak delta MiB | Output bytes |
| --- | ---: | ---: | ---: |
| init_runtime | 4 | 0.03 | 0 |
| create_session | 0 | 0.02 | 0 |
| analyze_text | 69 | 23.16 | 599954 |
| excerpt_scan | 8 | 0.98 | 1240567 |
| excerpt_structure | 2 | 0.75 | 509263 |
| ingest_document | 299 | 11.43 | 57093 |
| commit_session | 32 | 4.68 | 1961 |
| rebuild_lex | 53 | 4.68 | 1967 |
| session_state | 0 | 0.02 | 1242 |
| session_stats | 0 | 0.02 | 233 |
| graph_delta | 9 | 3.06 | 108185 |
| snapshot_export | 63 | 10.38 | 931859 |
| snapshot_import | 104 | 11.01 | 931859 |
| restore_query | 0 | 0.05 | 629 |
| lexical_query_batch | 1 | 0.10 | 140 |
| graph_query_batch | 9 | 0.81 | 99 |

## Perfect Run

- Path: `\\?\C:\Users\shuga\1kittroot\1code\Angular-build\docs\perfect_run.md`
- Input bytes: `2859630`
- Snapshot bytes: `17333983`
- Budget status: `passing`

| Phase | Wall ms | Peak delta MiB | Output bytes |
| --- | ---: | ---: | ---: |
| init_runtime | 5 | 0.03 | 0 |
| create_session | 0 | 0.02 | 0 |
| analyze_text | 1554 | 365.15 | 10536371 |
| excerpt_scan | 8 | 0.98 | 1215193 |
| excerpt_structure | 1 | 0.73 | 499321 |
| ingest_document | 6236 | 173.13 | 75211 |
| commit_session | 891 | 84.87 | 1977 |
| rebuild_lex | 1442 | 84.87 | 1978 |
| session_state | 0 | 0.03 | 4706 |
| session_stats | 0 | 0.03 | 245 |
| graph_delta | 444 | 54.75 | 2127312 |
| snapshot_export | 1594 | 183.71 | 17333983 |
| snapshot_import | 2179 | 185.03 | 17333983 |
| restore_query | 1 | 0.10 | 664 |
| lexical_query_batch | 22 | 1.60 | 140 |
| graph_query_batch | 177 | 12.05 | 99 |
