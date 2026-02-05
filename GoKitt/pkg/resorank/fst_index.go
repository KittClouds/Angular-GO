package resorank

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"sort"

	vellum "github.com/kittclouds/gokitt/pkg/fst"
)

// FSTIndex is a memory-efficient read-only index
type FSTIndex struct {
	Index    *vellum.IndexReader
	Postings []byte
}

// BuildFSTIndex converts the map-based index to FSTIndex
func BuildFSTIndex(tokenIndex map[string]map[string]TokenMetadata) (*FSTIndex, error) {
	// 1. Collect and sort terms
	terms := make([]string, 0, len(tokenIndex))
	for term := range tokenIndex {
		terms = append(terms, term)
	}
	sort.Strings(terms)

	// 2. Prepare FST builder and Postings buffer
	fstBuilder, err := vellum.NewIndexBuilder()
	if err != nil {
		return nil, err
	}

	var postingsBuf bytes.Buffer

	// 3. Iterate terms
	for _, term := range terms {
		docs := tokenIndex[term]

		// Offset is current position
		offset := uint64(postingsBuf.Len())

		// Serialize using binary encoding
		if err := encodePostings(&postingsBuf, docs); err != nil {
			return nil, fmt.Errorf("failed to encode postings for term %s: %w", term, err)
		}

		// Insert into FST
		if err := fstBuilder.Insert([]byte(term), offset); err != nil {
			return nil, fmt.Errorf("failed to insert term %s into FST: %w", term, err)
		}
	}

	// 4. Finish
	fstBytes, err := fstBuilder.Finish()
	if err != nil {
		return nil, err
	}

	idxReader, err := vellum.OpenIndex(fstBytes)
	if err != nil {
		return nil, err
	}

	return &FSTIndex{
		Index:    idxReader,
		Postings: postingsBuf.Bytes(),
	}, nil
}

// Get returns the postings map for a term
func (fi *FSTIndex) Get(term string) (map[string]TokenMetadata, bool) {
	offset, exists, err := fi.Index.Get([]byte(term))
	if err != nil || !exists {
		return nil, false
	}

	// Decode from offset
	slice := fi.Postings[offset:]
	buf := bytes.NewReader(slice)

	docs, err := decodePostings(buf)
	if err != nil {
		return nil, false
	}
	return docs, true
}

// Close releases resources
func (fi *FSTIndex) Close() error {
	return fi.Index.Close()
}

// --- Binary Encoding ---

func encodePostings(w io.Writer, docs map[string]TokenMetadata) error {
	// Write doc count
	if err := writeUvarint(w, uint64(len(docs))); err != nil {
		return err
	}

	for docID, meta := range docs {
		// DocID
		if err := writeString(w, docID); err != nil {
			return err
		}
		// SegmentMask (fixed 4 bytes)
		if err := binary.Write(w, binary.LittleEndian, meta.SegmentMask); err != nil {
			return err
		}
		// CorpusDocFreq
		if err := writeUvarint(w, uint64(meta.CorpusDocFreq)); err != nil {
			return err
		}
		// FieldOccurrences
		if err := writeUvarint(w, uint64(len(meta.FieldOccurrences))); err != nil {
			return err
		}
		for fieldName, occ := range meta.FieldOccurrences {
			if err := writeString(w, fieldName); err != nil {
				return err
			}
			if err := writeUvarint(w, uint64(occ.TF)); err != nil {
				return err
			}
			if err := writeUvarint(w, uint64(occ.FieldLength)); err != nil {
				return err
			}
		}
	}
	return nil
}

func decodePostings(r io.Reader) (map[string]TokenMetadata, error) {
	docCount, err := readUvarint(r)
	if err != nil {
		return nil, err
	}

	docs := make(map[string]TokenMetadata, docCount)
	for i := uint64(0); i < docCount; i++ {
		docID, err := readString(r)
		if err != nil {
			return nil, err
		}

		var mask uint32
		if err := binary.Read(r, binary.LittleEndian, &mask); err != nil {
			return nil, err
		}

		corpusFreq, err := readUvarint(r)
		if err != nil {
			return nil, err
		}

		fieldCount, err := readUvarint(r)
		if err != nil {
			return nil, err
		}

		fields := make(map[string]FieldOccurrence, fieldCount)
		for j := uint64(0); j < fieldCount; j++ {
			fieldName, err := readString(r)
			if err != nil {
				return nil, err
			}
			tf, err := readUvarint(r)
			if err != nil {
				return nil, err
			}
			fl, err := readUvarint(r)
			if err != nil {
				return nil, err
			}
			fields[fieldName] = FieldOccurrence{TF: int(tf), FieldLength: int(fl)}
		}

		docs[docID] = TokenMetadata{
			SegmentMask:      mask,
			CorpusDocFreq:    int(corpusFreq),
			FieldOccurrences: fields,
		}
	}
	return docs, nil
}

// --- Helpers ---

func writeUvarint(w io.Writer, v uint64) error {
	buf := make([]byte, binary.MaxVarintLen64)
	n := binary.PutUvarint(buf, v)
	_, err := w.Write(buf[:n])
	return err
}

func readUvarint(r io.Reader) (uint64, error) {
	// Read byte-by-byte for varint
	var x uint64
	var s uint
	for i := 0; i < binary.MaxVarintLen64; i++ {
		var b [1]byte
		if _, err := r.Read(b[:]); err != nil {
			return 0, err
		}
		if b[0] < 0x80 {
			return x | uint64(b[0])<<s, nil
		}
		x |= uint64(b[0]&0x7f) << s
		s += 7
	}
	return 0, fmt.Errorf("varint overflow")
}

func writeString(w io.Writer, s string) error {
	if err := writeUvarint(w, uint64(len(s))); err != nil {
		return err
	}
	_, err := w.Write([]byte(s))
	return err
}

func readString(r io.Reader) (string, error) {
	length, err := readUvarint(r)
	if err != nil {
		return "", err
	}
	buf := make([]byte, length)
	if _, err := io.ReadFull(r, buf); err != nil {
		return "", err
	}
	return string(buf), nil
}
