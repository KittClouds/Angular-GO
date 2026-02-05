# API Reference

This document provides detailed information about the NebulaDB API.

## Core API

### `createDb(options)`

Creates a new database instance.

**Parameters:**
- `options`: `DbOptions` - Configuration options for the database
  - `adapter`: `Adapter` - Storage adapter to use
  - `plugins?`: `Plugin[]` - Optional array of plugins

**Returns:** `IDatabase` - A database instance

**Example:**
```typescript
import { createDb } from '@nebula-db/core';
import { MemoryAdapter } from '@nebula/adapter-memory';

const db = createDb({ adapter: new MemoryAdapter() });
```

### `IDatabase`

Interface for database operations.

**Properties:**
- `collections`: `Map<string, ICollection>` - Map of collections in the database
- `adapter`: `Adapter` - The storage adapter used by the database
- `plugins`: `Plugin[]` - Array of plugins used by the database

**Methods:**
- `collection(name: string, options?: CollectionOptions): ICollection` - Get or create a collection
- `save(): Promise<void>` - Save the database state using the adapter

### `ICollection`

Interface for collection operations.

**Properties:**
- `name`: `string` - The name of the collection

**Methods:**
- `insert(doc: Omit<Document, 'id'> & { id?: string }): Promise<Document>` - Insert a document
- `find(query?: Query): Promise<Document[]>` - Find documents matching a query
- `findOne(query: Query): Promise<Document | null>` - Find a single document matching a query
- `update(query: Query, update: UpdateOperation): Promise<number>` - Update documents matching a query
- `delete(query: Query): Promise<number>` - Delete documents matching a query
- `subscribe(query: Query, callback: SubscriptionCallback): () => void` - Subscribe to changes in documents matching a query

## Query Operators

NebulaDB supports the following query operators:

### Comparison Operators

- `$eq`: Equal to
- `$ne`: Not equal to
- `$gt`: Greater than
- `$gte`: Greater than or equal to
- `$lt`: Less than
- `$lte`: Less than or equal to
- `$in`: In array
- `$nin`: Not in array
- `$regex`: Matches regular expression
- `$exists`: Field exists

**Examples:**
```typescript
// Equal to
await collection.find({ age: 30 }); // Shorthand for { age: { $eq: 30 } }

// Greater than
await collection.find({ age: { $gt: 25 } });

// In array
await collection.find({ status: { $in: ['active', 'pending'] } });

// Field exists
await collection.find({ email: { $exists: true } });
```

### Logical Operators

- `$and`: Logical AND
- `$or`: Logical OR
- `$not`: Logical NOT

**Examples:**
```typescript
// AND
await collection.find({
  $and: [
    { age: { $gt: 25 } },
    { status: 'active' }
  ]
});

// OR
await collection.find({
  $or: [
    { status: 'active' },
    { age: { $gt: 30 } }
  ]
});

// NOT
await collection.find({
  $not: [
    { status: 'inactive' }
  ]
});
```

## Update Operators

NebulaDB supports the following update operators:

- `$set`: Set field values
- `$unset`: Remove fields
- `$inc`: Increment field values
- `$push`: Add items to arrays
- `$pull`: Remove items from arrays

**Examples:**
```typescript
// Set fields
await collection.update(
  { id: '1' },
  { $set: { name: 'New Name', age: 31 } }
);

// Unset fields
await collection.update(
  { id: '1' },
  { $unset: { temporary: true } }
);

// Increment fields
await collection.update(
  { id: '1' },
  { $inc: { age: 1, count: 5 } }
);

// Push to arrays
await collection.update(
  { id: '1' },
  { $push: { tags: 'new-tag' } }
);

// Pull from arrays
await collection.update(
  { id: '1' },
  { $pull: { tags: 'old-tag' } }
);
```

## Types

### `Document`

```typescript
type Document = {
  id: string;
  [key: string]: any;
};
```

### `Query`
```

## Migration Plugin API

### `createMigrationPlugin(migrations)`

Creates a migration plugin to manage schema migrations.

**Parameters:**
- `migrations`: Array of migration objects `{ version: number, name: string, up: (db) => Promise<void> }`

**Usage:**
```typescript
import { createMigrationPlugin } from '@nebula/plugin-migration';
const plugin = createMigrationPlugin(migrations);
```

### `getSchemaVersion(db, collectionName)`
Returns the current schema version for a collection.

### `setSchemaVersion(db, collectionName, version)`
Sets the schema version for a collection.

**Usage:**
```typescript
import { getSchemaVersion, setSchemaVersion } from '@nebula/plugin-migration';
const version = await getSchemaVersion(db, 'users');
await setSchemaVersion(db, 'users', 2);
```

## Collection Index Options

The `collection` method supports advanced index definitions:

- `type`: 'single' | 'unique' | 'compound'
- `fields`: Array of field names (for compound/multi-field indexes)
- `options.partial`: `{ filter: Query }` (for partial indexes)
- `options.expireAfterSeconds`: number (for TTL)

**Example:**
```typescript
const users = db.collection('users', {
  indexes: [
    { name: 'id_idx', fields: ['id'], type: 'unique' },
    { name: 'name_age_idx', fields: ['name', 'age'], type: 'compound' },
    { name: 'active_idx', fields: ['active'], type: 'single', options: { partial: { filter: { active: true } } } }
  ]
});
```

## Devtools API

The devtools expose the following metadata for each collection:
- Index metadata (fields, type, options)
- Schema version
- Migration history

See the devtools UI for details.