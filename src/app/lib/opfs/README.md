
# OPFS Graph-Object Store Experiment

This module implements a user-space file system replacement using:
- **BlobStore**: Content-Addressable Storage (CAS) for immutable data.
- **CozoDB**: Graph-based metadata layer (instead of file tables).
- **Typed WAL**: Op-log for transactional history.

## Usage

```typescript
import { BlobStore, GraphObjectStore } from '@/lib/opfs';

// 1. Initialize Adapters (Main Thread or Worker)
const opfsBackend = new RealOpfsBackend(); // You need to implement IOpfsBackend using navigator.storage
const cozoDb = ...; // Your Cozo instance

// 2. Create Store
const blobStore = new BlobStore(opfsBackend);
const store = new GraphObjectStore(blobStore, cozoDb);

// 3. Save "File"
await store.saveObject('my-note-id', 'note', '# Hello World', 'text/markdown');
```

## Running Tests
`npx vitest run src/lib/opfs`
