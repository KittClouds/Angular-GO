package graptor

import (
	"fmt"
	"runtime"
	"sync"
	"time"
)

// MemoryStats tracks memory usage for profiling.
type MemoryStats struct {
	Timestamp     int64   `json:"timestamp"`
	AllocBytes    uint64  `json:"allocBytes"`
	TotalAlloc    uint64  `json:"totalAlloc"`
	SysBytes      uint64  `json:"sysBytes"`
	NumGC         uint32  `json:"numGC"`
	HeapObjects   uint64  `json:"heapObjects"`
	HeapAlloc     uint64  `json:"heapAlloc"`
	HeapSys       uint64  `json:"heapSys"`
	HeapInuse     uint64  `json:"heapInuse"`
	HeapIdle      uint64  `json:"heapIdle"`
	HeapReleased  uint64  `json:"heapReleased"`
	StackInuse    uint64  `json:"stackInuse"`
	StackSys      uint64  `json:"stackSys"`
	MSpanInuse    uint64  `json:"mSpanInuse"`
	MSpanSys      uint64  `json:"mSpanSys"`
	MCacheInuse   uint64  `json:"mCacheInuse"`
	MCacheSys     uint64  `json:"mCacheSys"`
	BuckHashSys   uint64  `json:"buckHashSys"`
	GCSys         uint64  `json:"gcSys"`
	OtherSys      uint64  `json:"otherSys"`
	NextGC        uint64  `json:"nextGC"`
	LastGC        uint64  `json:"lastGC"`
	PauseTotalNs  uint64  `json:"pauseTotalNs"`
	NumForcedGC   uint32  `json:"numForcedGC"`
	GCCPUFraction float64 `json:"gcCpuFraction"`
}

// GraptorStats tracks Graptor-specific memory metrics.
type GraptorStats struct {
	Timestamp         int64 `json:"timestamp"`
	EntityCount       int   `json:"entityCount"`
	AliasCount        int   `json:"aliasCount"`
	MentionCount      int   `json:"mentionCount"`
	CooccurrenceCount int   `json:"cooccurrenceCount"`
	ChapterCount      int   `json:"chapterCount"`
	InternerSize      int   `json:"internerSize"`
	RingBufferSize    int   `json:"ringBufferSize"`
}

// ProfileSnapshot combines memory and Graptor stats.
type ProfileSnapshot struct {
	Memory   MemoryStats   `json:"memory"`
	Graptor  GraptorStats  `json:"graptor"`
	Duration time.Duration `json:"duration"`
}

// MemoryProfiler provides memory profiling capabilities.
type MemoryProfiler struct {
	mu sync.RWMutex

	// Snapshots
	snapshots    []ProfileSnapshot
	maxSnapshots int

	// Baseline for delta calculations
	baseline    MemoryStats
	hasBaseline bool
}

// NewMemoryProfiler creates a new memory profiler.
func NewMemoryProfiler(maxSnapshots int) *MemoryProfiler {
	if maxSnapshots <= 0 {
		maxSnapshots = 100
	}
	return &MemoryProfiler{
		snapshots:    make([]ProfileSnapshot, 0, maxSnapshots),
		maxSnapshots: maxSnapshots,
	}
}

// CaptureSnapshot captures current memory and Graptor stats.
func (mp *MemoryProfiler) CaptureSnapshot(registry *GlobalEntityRegistry, cooccurrence *CooccurrenceStats, chapterMgr *ChapterManager) ProfileSnapshot {
	// Capture memory stats
	var m runtime.MemStats
	runtime.GC() // Force GC before reading
	runtime.ReadMemStats(&m)

	memStats := MemoryStats{
		Timestamp:     time.Now().UnixNano(),
		AllocBytes:    m.Alloc,
		TotalAlloc:    m.TotalAlloc,
		SysBytes:      m.Sys,
		NumGC:         m.NumGC,
		HeapObjects:   m.HeapObjects,
		HeapAlloc:     m.HeapAlloc,
		HeapSys:       m.HeapSys,
		HeapInuse:     m.HeapInuse,
		HeapIdle:      m.HeapIdle,
		HeapReleased:  m.HeapReleased,
		StackInuse:    m.StackInuse,
		StackSys:      m.StackSys,
		MSpanInuse:    m.MSpanInuse,
		MSpanSys:      m.MSpanSys,
		MCacheInuse:   m.MCacheInuse,
		MCacheSys:     m.MCacheSys,
		BuckHashSys:   m.BuckHashSys,
		GCSys:         m.GCSys,
		OtherSys:      m.OtherSys,
		NextGC:        m.NextGC,
		LastGC:        m.LastGC,
		PauseTotalNs:  m.PauseTotalNs,
		NumForcedGC:   m.NumForcedGC,
		GCCPUFraction: m.GCCPUFraction,
	}

	// Capture Graptor stats
	graptorStats := GraptorStats{
		Timestamp: time.Now().UnixNano(),
	}

	if registry != nil {
		stats := registry.Stats()
		graptorStats.EntityCount = stats.TotalEntities
		graptorStats.AliasCount = stats.TotalAliases
		graptorStats.MentionCount = stats.TotalMentions
		graptorStats.ChapterCount = stats.TotalChapters
		if registry.interner != nil {
			graptorStats.InternerSize = registry.interner.Size()
		}
	}

	// ZERO-COPY: Use Stats() instead of GetTopPairs() which allocates millions of structs
	if cooccurrence != nil {
		graptorStats.CooccurrenceCount = cooccurrence.Stats().TotalPairs
	}

	// ZERO-COPY: Use dedicated method instead of GetAllChapters() which allocates slices
	if chapterMgr != nil {
		graptorStats.RingBufferSize = chapterMgr.GetTotalRingBufferSize()
	}

	snapshot := ProfileSnapshot{
		Memory:  memStats,
		Graptor: graptorStats,
	}

	// Store snapshot
	mp.mu.Lock()
	defer mp.mu.Unlock()

	if !mp.hasBaseline {
		mp.baseline = memStats
		mp.hasBaseline = true
	}

	mp.snapshots = append(mp.snapshots, snapshot)
	if len(mp.snapshots) > mp.maxSnapshots {
		mp.snapshots = mp.snapshots[1:]
	}

	return snapshot
}

// GetSnapshots returns all captured snapshots.
// DEPRECATED: Use ForEachSnapshot for zero-copy iteration.
func (mp *MemoryProfiler) GetSnapshots() []ProfileSnapshot {
	mp.mu.RLock()
	defer mp.mu.RUnlock()
	return append([]ProfileSnapshot{}, mp.snapshots...)
}

// ForEachSnapshot iterates over all snapshots without allocating a copy.
// ZERO-COPY: The callback receives each snapshot directly from the internal slice.
// Return false from the callback to stop iteration early.
func (mp *MemoryProfiler) ForEachSnapshot(fn func(ProfileSnapshot) bool) {
	mp.mu.RLock()
	defer mp.mu.RUnlock()

	for _, snapshot := range mp.snapshots {
		if !fn(snapshot) {
			break
		}
	}
}

// GetSnapshotCount returns the number of captured snapshots.
// ZERO-COPY: O(1) operation without any allocation.
func (mp *MemoryProfiler) GetSnapshotCount() int {
	mp.mu.RLock()
	defer mp.mu.RUnlock()
	return len(mp.snapshots)
}

// GetBaseline returns the baseline memory stats.
func (mp *MemoryProfiler) GetBaseline() (MemoryStats, bool) {
	mp.mu.RLock()
	defer mp.mu.RUnlock()
	return mp.baseline, mp.hasBaseline
}

// Delta calculates the memory delta from baseline.
func (mp *MemoryProfiler) Delta(current MemoryStats) MemoryStats {
	mp.mu.RLock()
	defer mp.mu.RUnlock()

	if !mp.hasBaseline {
		return MemoryStats{}
	}

	return MemoryStats{
		Timestamp:   current.Timestamp - mp.baseline.Timestamp,
		AllocBytes:  current.AllocBytes - mp.baseline.AllocBytes,
		TotalAlloc:  current.TotalAlloc - mp.baseline.TotalAlloc,
		SysBytes:    current.SysBytes - mp.baseline.SysBytes,
		NumGC:       current.NumGC - mp.baseline.NumGC,
		HeapObjects: current.HeapObjects - mp.baseline.HeapObjects,
		HeapAlloc:   current.HeapAlloc - mp.baseline.HeapAlloc,
		HeapInuse:   current.HeapInuse - mp.baseline.HeapInuse,
	}
}

// Clear clears all snapshots.
func (mp *MemoryProfiler) Clear() {
	mp.mu.Lock()
	defer mp.mu.Unlock()
	mp.snapshots = mp.snapshots[:0]
	mp.hasBaseline = false
}

// ForceGC forces a garbage collection and returns memory stats.
func ForceGC() MemoryStats {
	runtime.GC()
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return MemoryStats{
		Timestamp:   time.Now().UnixNano(),
		AllocBytes:  m.Alloc,
		TotalAlloc:  m.TotalAlloc,
		SysBytes:    m.Sys,
		NumGC:       m.NumGC,
		HeapObjects: m.HeapObjects,
		HeapAlloc:   m.HeapAlloc,
		HeapSys:     m.HeapSys,
	}
}

// EstimateMemoryUsage estimates memory usage for given entity/mention counts.
func EstimateMemoryUsage(entityCount, mentionCount, chapterCount int) uint64 {
	// Rough estimates based on struct sizes:
	// Entity: ~200 bytes (including slices)
	// EntityMention: ~80 bytes
	// ChapterContext: ~500 bytes
	// Map overhead: ~48 bytes per entry

	entityMemory := uint64(entityCount) * 200
	mentionMemory := uint64(mentionCount) * 80
	chapterMemory := uint64(chapterCount) * 500
	mapOverhead := uint64(entityCount*3) * 48 // entities, aliases, variants

	return entityMemory + mentionMemory + chapterMemory + mapOverhead
}

// FormatBytes formats bytes as human-readable string.
func FormatBytes(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}
