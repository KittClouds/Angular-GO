// Package hnsw provides serialization for HNSW index
package hnsw

import (
	"encoding/binary"
	"io"
	"math"
	"sort"

	"github.com/kittclouds/gokitt/pkg/hnsw/node"
)

// Binary format version for forward compatibility
const FormatVersion byte = 1

// Magic number "HNSW" in little-endian
const MagicNumber uint32 = 0x574E5348 // "HNSW" reversed for LE

// Header size: magic(4) + version(1) + metric(1) + dimension(2) + m(2) + efConstruction(2) + nodeCount(4) + levelMax(1) + entryPoint(4) = 21 bytes
const headerSize = 21

// Serialize writes the HNSW index to a byte slice.
//
// Binary format (version 1):
//
//	Header (21 bytes):
//	  - Magic:        4 bytes (0x574E5348 "HNSW")
//	  - Version:      1 byte  (format version, currently 1)
//	  - Metric:       1 byte  (0=Cosine, 1=Euclidean)
//	  - Dimension:    2 bytes (u16, little-endian)
//	  - M:            2 bytes (u16, little-endian)
//	  - EfConstruction: 2 bytes (u16, little-endian)
//	  - NodeCount:    4 bytes (u32, little-endian)
//	  - LevelMax:     1 byte  (u8)
//	  - EntryPoint:   4 bytes (u32, 0xFFFFFFFF if none)
//
//	Per-Node (sorted by ID for stability):
//	  - ID:           4 bytes (u32)
//	  - LevelCount:   1 byte  (u8, number of neighbor lists)
//	  - Vector:       dimension * 4 bytes (f32, little-endian)
//	  - Deleted:      1 byte  (0=false, 1=true)
//	  - Per-Level Neighbors:
//	    - Count:      2 bytes (u16)
//	    - IDs:        count * 4 bytes (u32)
func (h *Index) Serialize() []byte {
	buf := make([]byte, 0, headerSize+len(h.Nodes)*100) // Rough estimate
	buf = h.serializeHeader(buf)
	buf = h.serializeNodes(buf)
	return buf
}

// SerializeTo writes the HNSW index to an io.Writer.
func (h *Index) SerializeTo(w io.Writer) error {
	_, err := w.Write(h.Serialize())
	return err
}

func (h *Index) serializeHeader(buf []byte) []byte {
	// Magic number
	buf = binary.LittleEndian.AppendUint32(buf, MagicNumber)

	// Version
	buf = append(buf, FormatVersion)

	// Metric
	buf = append(buf, byte(h.Metric))

	// Dimension (0 if not set)
	dim := uint16(0)
	if h.dimension != nil {
		dim = uint16(*h.dimension)
	}
	buf = binary.LittleEndian.AppendUint16(buf, dim)

	// M
	buf = binary.LittleEndian.AppendUint16(buf, uint16(h.M))

	// EfConstruction
	buf = binary.LittleEndian.AppendUint16(buf, uint16(h.EfConstruction))

	// Node count
	buf = binary.LittleEndian.AppendUint32(buf, uint32(len(h.Nodes)))

	// LevelMax
	buf = append(buf, h.LevelMax)

	// EntryPoint (0xFFFFFFFF if none)
	ep := uint32(0xFFFFFFFF)
	if h.EntryPointID != nil {
		ep = *h.EntryPointID
	}
	buf = binary.LittleEndian.AppendUint32(buf, ep)

	return buf
}

func (h *Index) serializeNodes(buf []byte) []byte {
	// Sort IDs for deterministic serialization
	ids := make([]uint32, 0, len(h.Nodes))
	for id := range h.Nodes {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })

	for _, id := range ids {
		n := h.Nodes[id]
		buf = serializeNode(buf, n)
	}

	return buf
}

func serializeNode(buf []byte, n *node.HnswNode) []byte {
	// ID
	buf = binary.LittleEndian.AppendUint32(buf, n.ID)

	// LevelCount (number of neighbor lists)
	levelCount := uint8(len(n.Neighbors))
	buf = append(buf, levelCount)

	// Vector
	for _, v := range n.Vector {
		buf = binary.LittleEndian.AppendUint32(buf, math.Float32bits(v))
	}

	// Deleted flag
	if n.Deleted {
		buf = append(buf, byte(1))
	} else {
		buf = append(buf, byte(0))
	}

	// Neighbors per level
	for _, neighbors := range n.Neighbors {
		// Filter valid neighbors (non-negative)
		valid := make([]uint32, 0, len(neighbors))
		for _, nid := range neighbors {
			if nid >= 0 {
				valid = append(valid, uint32(nid))
			}
		}

		// Count
		buf = binary.LittleEndian.AppendUint16(buf, uint16(len(valid)))

		// IDs
		for _, nid := range valid {
			buf = binary.LittleEndian.AppendUint32(buf, nid)
		}
	}

	return buf
}

// Deserialize reads an HNSW index from a byte slice.
func Deserialize(data []byte) (*Index, error) {
	if len(data) < headerSize {
		return nil, ErrSerialization
	}

	idx, offset, err := deserializeHeader(data)
	if err != nil {
		return nil, err
	}

	if err := idx.deserializeNodes(data, offset); err != nil {
		return nil, err
	}

	return idx, nil
}

// DeserializeFrom reads an HNSW index from an io.Reader.
func DeserializeFrom(r io.Reader) (*Index, error) {
	// Read header first
	header := make([]byte, headerSize)
	if _, err := io.ReadFull(r, header); err != nil {
		return nil, ErrSerialization
	}

	idx, offset, err := deserializeHeader(header)
	if err != nil {
		return nil, err
	}

	// Calculate expected data size
	dim := 0
	if idx.dimension != nil {
		dim = *idx.dimension
	}

	// Read remaining data for nodes
	nodeCount := len(idx.Nodes)
	remainingSize := estimateNodeDataSize(dim, nodeCount)
	remaining := make([]byte, remainingSize)
	n, err := io.ReadFull(r, remaining)
	if err != nil && err != io.ErrUnexpectedEOF {
		return nil, ErrSerialization
	}
	remaining = remaining[:n]

	if err := idx.deserializeNodes(remaining, offset-headerSize); err != nil {
		return nil, err
	}

	return idx, nil
}

func estimateNodeDataSize(dim, nodeCount int) int {
	// Rough estimate: per node = 4(ID) + 1(level) + dim*4(vector) + 1(deleted) + ~100(neighbors)
	return nodeCount * (6 + dim*4 + 100)
}

func deserializeHeader(data []byte) (*Index, int, error) {
	offset := 0

	// Magic number
	magic := binary.LittleEndian.Uint32(data[offset:])
	offset += 4
	if magic != MagicNumber {
		return nil, 0, ErrSerialization
	}

	// Version
	version := data[offset]
	offset += 1
	if version > FormatVersion {
		return nil, 0, ErrSerialization // Unsupported version
	}

	// Metric
	metric := Metric(data[offset])
	offset += 1
	if metric > Euclidean {
		return nil, 0, ErrSerialization
	}

	// Dimension
	dim := int(binary.LittleEndian.Uint16(data[offset:]))
	offset += 2

	// M
	m := int(binary.LittleEndian.Uint16(data[offset:]))
	offset += 2

	// EfConstruction
	efConstruction := int(binary.LittleEndian.Uint16(data[offset:]))
	offset += 2

	// Node count
	nodeCount := int(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	// LevelMax
	levelMax := data[offset]
	offset += 1

	// EntryPoint
	ep := binary.LittleEndian.Uint32(data[offset:])
	offset += 4

	// Create index
	idx := NewIndex(m, efConstruction, metric)
	idx.LevelMax = levelMax

	if dim > 0 {
		idx.dimension = &dim
	}

	if ep != 0xFFFFFFFF {
		idx.EntryPointID = &ep
	}

	// Pre-allocate nodes map
	idx.Nodes = make(map[uint32]*node.HnswNode, nodeCount)

	return idx, offset, nil
}

func (h *Index) deserializeNodes(data []byte, offset int) error {
	dim := 0
	if h.dimension != nil {
		dim = *h.dimension
	}

	for offset < len(data) {
		n, bytesRead, err := deserializeNode(data, offset, dim)
		if err != nil {
			return err
		}
		h.Nodes[n.ID] = n
		offset += bytesRead
	}

	return nil
}

func deserializeNode(data []byte, offset int, dim int) (*node.HnswNode, int, error) {
	startOffset := offset

	// ID
	if offset+4 > len(data) {
		return nil, 0, ErrSerialization
	}
	id := binary.LittleEndian.Uint32(data[offset:])
	offset += 4

	// LevelCount
	if offset+1 > len(data) {
		return nil, 0, ErrSerialization
	}
	levelCount := int(data[offset])
	offset += 1

	// Vector
	vecSize := dim * 4
	if offset+vecSize > len(data) {
		return nil, 0, ErrSerialization
	}
	vector := make([]float32, dim)
	for i := 0; i < dim; i++ {
		vector[i] = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
		offset += 4
	}

	// Deleted flag
	if offset+1 > len(data) {
		return nil, 0, ErrSerialization
	}
	deleted := data[offset] != 0
	offset += 1

	// Create node
	level := uint8(0)
	if levelCount > 0 {
		level = uint8(levelCount - 1)
	}
	n := node.NewNode(id, level, vector, levelCount)
	n.Deleted = deleted

	// Neighbors per level
	for l := 0; l < levelCount; l++ {
		if offset+2 > len(data) {
			return nil, 0, ErrSerialization
		}
		neighborCount := int(binary.LittleEndian.Uint16(data[offset:]))
		offset += 2

		if offset+neighborCount*4 > len(data) {
			return nil, 0, ErrSerialization
		}

		neighbors := make([]int32, neighborCount)
		for i := 0; i < neighborCount; i++ {
			neighbors[i] = int32(binary.LittleEndian.Uint32(data[offset:]))
			offset += 4
		}
		n.Neighbors[l] = neighbors
	}

	return n, offset - startOffset, nil
}
