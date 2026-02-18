package graphstore

import "encoding/json"

// EncodeFunc defines how to serialize a vertex value to bytes.
type EncodeFunc[T any] func(T) ([]byte, error)

// DecodeFunc defines how to deserialize bytes to a vertex value.
type DecodeFunc[T any] func([]byte) (T, error)

// JSONEncode implements EncodeFunc using encoding/json.
func JSONEncode[T any](v T) ([]byte, error) {
	return json.Marshal(v)
}

// JSONDecode implements DecodeFunc using encoding/json.
func JSONDecode[T any](b []byte) (T, error) {
	var v T
	err := json.Unmarshal(b, &v)
	return v, err
}
