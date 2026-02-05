package vellum

import (
	"bytes"
	"errors"
	"sort"
)

// IndexBuilder helps build an FST index
type IndexBuilder struct {
	builder *Builder
	buffer  *bytes.Buffer
}

// NewIndexBuilder creates a new in-memory FST builder
func NewIndexBuilder() (*IndexBuilder, error) {
	buf := &bytes.Buffer{}
	b, err := New(buf, nil)
	if err != nil {
		return nil, err
	}
	return &IndexBuilder{
		builder: b,
		buffer:  buf,
	}, nil
}

// Insert adds a key-value pair. Keys MUST be sorted.
func (ib *IndexBuilder) Insert(key []byte, val uint64) error {
	return ib.builder.Insert(key, val)
}

// Finish closes the builder and returns the FST bytes
func (ib *IndexBuilder) Finish() ([]byte, error) {
	if err := ib.builder.Close(); err != nil {
		return nil, err
	}
	return ib.buffer.Bytes(), nil
}

// IndexReader wraps a read-only FST
type IndexReader struct {
	fst *FST
}

// OpenIndex opens an FST from bytes
func OpenIndex(data []byte) (*IndexReader, error) {
	f, err := Load(data)
	if err != nil {
		return nil, err
	}
	return &IndexReader{fst: f}, nil
}

// Len returns the number of keys in the FST
func (ir *IndexReader) Len() int {
	return ir.fst.Len()
}

// Get returns the value for a key
func (ir *IndexReader) Get(key []byte) (uint64, bool, error) {
	return ir.fst.Get(key)
}

// SearchPrefix returns all keys starting with prefix
func (ir *IndexReader) SearchPrefix(prefix []byte) ([]string, []uint64, error) {
	// Need to provide endKeyExclusive for prefix range
	// But Iterator also takes a startKey.

	// Simply iterate from prefix
	iterator, err := ir.fst.Iterator(prefix, nil)
	if err != nil {
		return nil, nil, err
	}

	var keys []string
	var vals []uint64

	for err == nil {
		key, val := iterator.Current()

		// Check prefix match
		if !bytes.HasPrefix(key, prefix) {
			break
		}

		// Copy key because iterator might reuse buffer
		k := make([]byte, len(key))
		copy(k, key)
		keys = append(keys, string(k))
		vals = append(vals, val)

		err = iterator.Next()
	}

	if err != nil && err != ErrIteratorDone {
		return nil, nil, err
	}

	return keys, vals, nil
}

// KeyValueTuple helper for sorting
type KeyValueTuple struct {
	Key []byte
	Val uint64
}

// BuildSortedFST is a helper that sorts keys before insertion (convenience)
func BuildSortedFST(data map[string]uint64) ([]byte, error) {
	tuples := make([]KeyValueTuple, 0, len(data))
	for k, v := range data {
		tuples = append(tuples, KeyValueTuple{Key: []byte(k), Val: v})
	}

	sort.Slice(tuples, func(i, j int) bool {
		return bytes.Compare(tuples[i].Key, tuples[j].Key) < 0
	})

	ib, err := NewIndexBuilder()
	if err != nil {
		return nil, err
	}

	for _, t := range tuples {
		if err := ib.Insert(t.Key, t.Val); err != nil {
			return nil, err
		}
	}

	return ib.Finish()
}

// Close cleans up resources
func (ir *IndexReader) Close() error {
	return ir.fst.Close()
}

// helper error
var ErrInvalidPrefix = errors.New("invalid prefix")
