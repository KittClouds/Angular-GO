//go:build js && wasm

// Package sab provides zero-copy SharedArrayBuffer access for Go WASM
package sab

import (
	"encoding/binary"
	"syscall/js"
)

// Message types for the binary protocol
const (
	MsgTypeNone        uint32 = 0
	MsgTypeScanResult  uint32 = 1
	MsgTypeGraphUpdate uint32 = 2
	MsgTypeEntitySpans uint32 = 3
	MsgTypeAck         uint32 = 0xFF
)

// Header offsets (first 16 bytes are header)
const (
	OffsetReady     = 0  // int32: 0 = idle, 1 = data ready
	OffsetLength    = 4  // uint32: payload length
	OffsetMsgType   = 8  // uint32: message type
	OffsetReserved  = 12 // uint32: reserved
	OffsetPayload   = 16 // payload starts here
	DefaultBufferSz = 65536
)

// SharedBuffer provides zero-copy access to a JS SharedArrayBuffer
type SharedBuffer struct {
	sab       js.Value // The SharedArrayBuffer itself
	uint8View js.Value // Uint8Array view for byte access
	int32View js.Value // Int32Array view for Atomics
	length    int
}

// New wraps a JavaScript SharedArrayBuffer
func New(sabValue js.Value) *SharedBuffer {
	if sabValue.IsUndefined() || sabValue.IsNull() {
		return nil
	}

	byteLength := sabValue.Get("byteLength").Int()

	return &SharedBuffer{
		sab:       sabValue,
		uint8View: js.Global().Get("Uint8Array").New(sabValue),
		int32View: js.Global().Get("Int32Array").New(sabValue),
		length:    byteLength,
	}
}

// Length returns the buffer size
func (s *SharedBuffer) Length() int {
	return s.length
}

// WriteBytes writes bytes to the buffer at offset (zero-copy to JS)
func (s *SharedBuffer) WriteBytes(offset int, data []byte) {
	if offset+len(data) > s.length {
		return // Bounds check
	}
	subarray := s.uint8View.Call("subarray", offset, offset+len(data))
	js.CopyBytesToJS(subarray, data)
}

// ReadBytes reads bytes from the buffer at offset
func (s *SharedBuffer) ReadBytes(offset, length int) []byte {
	if offset+length > s.length {
		return nil
	}
	result := make([]byte, length)
	subarray := s.uint8View.Call("subarray", offset, offset+length)
	js.CopyBytesToGo(result, subarray)
	return result
}

// WriteHeader writes the message header (length, type)
func (s *SharedBuffer) WriteHeader(payloadLen uint32, msgType uint32) {
	header := make([]byte, 16)
	binary.LittleEndian.PutUint32(header[OffsetReady:], 0) // Will set ready after payload
	binary.LittleEndian.PutUint32(header[OffsetLength:], payloadLen)
	binary.LittleEndian.PutUint32(header[OffsetMsgType:], msgType)
	binary.LittleEndian.PutUint32(header[OffsetReserved:], 0)
	s.WriteBytes(0, header)
}

// WritePayload writes the payload starting at offset 16
func (s *SharedBuffer) WritePayload(data []byte) {
	s.WriteBytes(OffsetPayload, data)
}

// SignalReady sets the ready flag and notifies waiting JS
func (s *SharedBuffer) SignalReady() {
	// Use Atomics.store to set ready = 1
	atomics := js.Global().Get("Atomics")
	atomics.Call("store", s.int32View, 0, 1)
	// Notify any waiting JS thread
	atomics.Call("notify", s.int32View, 0, 1)
}

// WaitForAck waits for JS to acknowledge receipt
func (s *SharedBuffer) WaitForAck() {
	atomics := js.Global().Get("Atomics")
	// Wait until ready flag is back to 0
	atomics.Call("wait", s.int32View, 0, 1) // Wait while value is 1
}

// WriteMessage writes a complete message (header + payload) and signals JS
func (s *SharedBuffer) WriteMessage(msgType uint32, payload []byte) {
	if len(payload)+OffsetPayload > s.length {
		// Payload too large - truncate or handle error
		payload = payload[:s.length-OffsetPayload]
	}

	s.WriteHeader(uint32(len(payload)), msgType)
	s.WritePayload(payload)
	s.SignalReady()
}

// ===== Binary Encoding Helpers =====

// EntitySpan represents a decoded entity span
type EntitySpan struct {
	Start   uint32
	End     uint32
	Kind    uint16
	LabelID uint16 // Index into label table
}

// EncodeSpans encodes entity spans into binary format
// Format per span: [start:4][end:4][kind:2][labelID:2] = 12 bytes
func EncodeSpans(spans []EntitySpan) []byte {
	data := make([]byte, 4+len(spans)*12) // 4 byte count + spans

	binary.LittleEndian.PutUint32(data[0:4], uint32(len(spans)))

	offset := 4
	for _, sp := range spans {
		binary.LittleEndian.PutUint32(data[offset:offset+4], sp.Start)
		binary.LittleEndian.PutUint32(data[offset+4:offset+8], sp.End)
		binary.LittleEndian.PutUint16(data[offset+8:offset+10], sp.Kind)
		binary.LittleEndian.PutUint16(data[offset+10:offset+12], sp.LabelID)
		offset += 12
	}

	return data
}

// Edge represents a graph edge for encoding
type Edge struct {
	SourceHash uint32
	TargetHash uint32
	RelType    uint16
	Weight     uint16 // Fixed point: weight * 1000
}

// EncodeEdges encodes edges into binary format
// Format per edge: [source:4][target:4][relType:2][weight:2] = 12 bytes
func EncodeEdges(edges []Edge) []byte {
	data := make([]byte, 4+len(edges)*12)

	binary.LittleEndian.PutUint32(data[0:4], uint32(len(edges)))

	offset := 4
	for _, e := range edges {
		binary.LittleEndian.PutUint32(data[offset:offset+4], e.SourceHash)
		binary.LittleEndian.PutUint32(data[offset+4:offset+8], e.TargetHash)
		binary.LittleEndian.PutUint16(data[offset+8:offset+10], e.RelType)
		binary.LittleEndian.PutUint16(data[offset+10:offset+12], e.Weight)
		offset += 12
	}

	return data
}
