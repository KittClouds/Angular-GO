package graphstore

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/google/uuid"
)

type PropType string

const (
	TypeString    PropType = "string"
	TypeInt       PropType = "int"
	TypeFloat     PropType = "float"
	TypeBool      PropType = "bool"
	TypeJSON      PropType = "json"
	TypeUUID      PropType = "uuid"
	TypeTimestamp PropType = "timestamp"
)

// PropValue holds a strictly typed property value.
type PropValue struct {
	Type PropType
	Raw  []byte
}

// NewPropValue creates a PropValue inferring from the Go type.
// Only supports subset of types, defaults to JSON for complex objects.
func NewPropValue(v any) (PropValue, error) {
	switch t := v.(type) {
	case string:
		return PropValue{Type: TypeString, Raw: []byte(t)}, nil
	case int:
		b := make([]byte, 8)
		binary.BigEndian.PutUint64(b, uint64(t))
		return PropValue{Type: TypeInt, Raw: b}, nil
	case int64:
		b := make([]byte, 8)
		binary.BigEndian.PutUint64(b, uint64(t))
		return PropValue{Type: TypeInt, Raw: b}, nil
	case float64:
		b := make([]byte, 8)
		binary.BigEndian.PutUint64(b, math.Float64bits(t))
		return PropValue{Type: TypeFloat, Raw: b}, nil
	case bool:
		var b []byte
		if t {
			b = []byte{1}
		} else {
			b = []byte{0}
		}
		return PropValue{Type: TypeBool, Raw: b}, nil
	case uuid.UUID:
		return PropValue{Type: TypeUUID, Raw: t[:]}, nil
	case time.Time:
		b := make([]byte, 8)
		binary.BigEndian.PutUint64(b, uint64(t.UnixNano()))
		return PropValue{Type: TypeTimestamp, Raw: b}, nil
	default:
		// Fallback to JSON
		b, err := json.Marshal(t)
		if err != nil {
			return PropValue{}, err
		}
		return PropValue{Type: TypeJSON, Raw: b}, nil
	}
}

// Accessors

func (p PropValue) AsString() (string, error) {
	if p.Type != TypeString {
		return "", fmt.Errorf("property is %s, not string", p.Type)
	}
	return string(p.Raw), nil
}

func (p PropValue) AsInt() (int64, error) {
	if p.Type != TypeInt {
		return 0, fmt.Errorf("property is %s, not int", p.Type)
	}
	if len(p.Raw) != 8 {
		return 0, fmt.Errorf("invalid int blob length: %d", len(p.Raw))
	}
	return int64(binary.BigEndian.Uint64(p.Raw)), nil
}

func (p PropValue) AsFloat() (float64, error) {
	if p.Type != TypeFloat {
		return 0, fmt.Errorf("property is %s, not float", p.Type)
	}
	if len(p.Raw) != 8 {
		return 0, fmt.Errorf("invalid float blob length: %d", len(p.Raw))
	}
	return math.Float64frombits(binary.BigEndian.Uint64(p.Raw)), nil
}

func (p PropValue) AsBool() (bool, error) {
	if p.Type != TypeBool {
		return false, fmt.Errorf("property is %s, not bool", p.Type)
	}
	return len(p.Raw) > 0 && p.Raw[0] == 1, nil
}

func (p PropValue) AsUUID() (uuid.UUID, error) {
	if p.Type != TypeUUID {
		return uuid.Nil, fmt.Errorf("property is %s, not uuid", p.Type)
	}
	return uuid.FromBytes(p.Raw)
}

func (p PropValue) AsTime() (time.Time, error) {
	if p.Type != TypeTimestamp {
		return time.Time{}, fmt.Errorf("property is %s, not timestamp", p.Type)
	}
	if len(p.Raw) != 8 {
		return time.Time{}, fmt.Errorf("invalid timestamp blob length: %d", len(p.Raw))
	}
	nano := int64(binary.BigEndian.Uint64(p.Raw))
	return time.Unix(0, nano), nil
}

// Convert converts the raw blob to the target Go interface value based on Type.
func (p PropValue) Interface() (any, error) {
	switch p.Type {
	case TypeString:
		return p.AsString()
	case TypeInt:
		return p.AsInt()
	case TypeFloat:
		return p.AsFloat()
	case TypeBool:
		return p.AsBool()
	case TypeUUID:
		return p.AsUUID()
	case TypeTimestamp:
		return p.AsTime()
	case TypeJSON:
		var v any
		err := json.Unmarshal(p.Raw, &v)
		return v, err
	default:
		return nil, fmt.Errorf("unknown property type: %s", p.Type)
	}
}

// String returns a string representation for display (best effort).
func (p PropValue) String() string {
	val, err := p.Interface()
	if err != nil {
		return fmt.Sprintf("<error: %v>", err)
	}
	if p.Type == TypeJSON {
		return string(p.Raw)
	}
	return fmt.Sprintf("%v", val)
}

// ParseFromString attempts to parse a string into the most appropriate PropValue.
// This is useful for migrating old map[string]string attributes.
func ParseFromString(s string) PropValue {
	// Try Bool
	if b, err := strconv.ParseBool(s); err == nil {
		val, _ := NewPropValue(b)
		return val
	}
	// Try Int
	if i, err := strconv.ParseInt(s, 10, 64); err == nil {
		val, _ := NewPropValue(i)
		return val
	}
	// Try Float
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		val, _ := NewPropValue(f)
		return val
	}
	// Try UUID
	if u, err := uuid.Parse(s); err == nil {
		val, _ := NewPropValue(u)
		return val
	}
	// Fallback String
	val, _ := NewPropValue(s)
	return val
}
