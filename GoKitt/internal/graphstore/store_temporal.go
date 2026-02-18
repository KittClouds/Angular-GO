package graphstore

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

type TimeRange struct {
	Start time.Time
	End   time.Time
}

type TemporalQuery struct {
	AsOf    *time.Time // nil = current time
	Between *TimeRange // range query
}

type VersionedProp struct {
	PropValue
	ValidFrom  time.Time
	ValidUntil *time.Time // nil = currently valid
	TxnID      int64
}

// VertexPropsAt returns properties for a vertex as they existed at a specific point in time.
func (s *SQLiteStore[T]) VertexPropsAt(id uuid.UUID, t time.Time) (map[string]PropValue, error) {
	if err := s.ensureInit(); err != nil {
		return nil, err
	}

	ts := t.UnixMilli()

	// Query: valid_from <= t AND (valid_until IS NULL OR valid_until > t)
	query := `
		SELECT key, value_type, value_blob 
		FROM graph_properties 
		WHERE owner_id = ? AND owner_type = 'vertex'
		  AND valid_from <= ? 
		  AND (valid_until IS NULL OR valid_until > ?)
	`

	rows, err := s.db.Query(query, id.String(), ts, ts)
	if err != nil {
		return nil, fmt.Errorf("query temporal props: %w", err)
	}
	defer rows.Close()

	props := make(map[string]PropValue)
	for rows.Next() {
		var key, vType string
		var vBlob []byte
		if err := rows.Scan(&key, &vType, &vBlob); err != nil {
			return nil, err
		}

		val := PropValue{
			Type: PropType(vType),
			Raw:  vBlob,
		}
		props[key] = val
	}
	return props, nil
}

// PropertyHistory returns the full history of a specific property.
func (s *SQLiteStore[T]) PropertyHistory(id uuid.UUID, key string) ([]VersionedProp, error) {
	if err := s.ensureInit(); err != nil {
		return nil, err
	}

	query := `
		SELECT value_type, value_blob, valid_from, valid_until, txn_id
		FROM graph_properties
		WHERE owner_id = ? AND key = ?
		ORDER BY valid_from ASC
	`

	rows, err := s.db.Query(query, id.String(), key)
	if err != nil {
		return nil, fmt.Errorf("query history: %w", err)
	}
	defer rows.Close()

	var history []VersionedProp
	for rows.Next() {
		var vType string
		var vBlob []byte
		var validFrom int64
		var validUntil *int64 // Nullable
		var txnID int64

		if err := rows.Scan(&vType, &vBlob, &validFrom, &validUntil, &txnID); err != nil {
			return nil, err
		}

		vp := VersionedProp{
			PropValue: PropValue{
				Type: PropType(vType),
				Raw:  vBlob,
			},
			ValidFrom: time.UnixMilli(validFrom),
			TxnID:     txnID,
		}

		if validUntil != nil {
			t := time.UnixMilli(*validUntil)
			vp.ValidUntil = &t
		}

		history = append(history, vp)
	}
	return history, nil
}
