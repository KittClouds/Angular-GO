# Exposed Go API Verification

## Verification Steps
1.  **Frontend Integration**: Updated `GoKittService.ts` and `gokitt.worker.ts` with new methods and types for:
    *   Spans & Links (`storeUpsertSpan`, `storeGetSpan`, etc.)
    *   Network View (`storeUpsertNetworkInstance`, etc.)
    *   Discovery (`storeUpsertDiscoveryCandidate`, etc.)
    *   Fact Sheets (`storeUpsertEntityCard`, etc.)
2.  **Build Verification**: Ran `npm run build` (Angular CLI) which completed successfully (Exit Code: 0).
3.  **Interface Consistency**: Verified that TypeScript interfaces in `GoKittService.ts` match the Go structs defined in `internal/store/models.go` and the `main.go` exports.

## Next Steps for User
*   Update `NetworkService`, `FactSheetService`, and `DiscoveryStore` to call these new `GoKittService` methods to persist data to the SQLite backend.
*   Test the `Network View` and `Fact Sheets` UI components to ensure they display data correctly when backed by SQLite.
