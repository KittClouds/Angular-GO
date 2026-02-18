const fs = require('fs');
const path = require('path');

const resultsPath = path.join(__dirname, '../docs/results2.md');
const outputPath = path.join(__dirname, '../docs/results2-analysis.txt');
const content = fs.readFileSync(resultsPath, 'utf8');

const queries = {};
let currentQueryId = null;

// Helper to extract ID from "CHUNK(...)" or "DOC(...)"
function extractId(str) {
    const match = str.match(/(?:CHUNK|DOC)\((.+?)\)/);
    return match ? match[1] : str;
}

// 1. Line-by-Line Parsing
const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Query Header: ### exact-001: "Ryan Romano"
    const headerMatch = line.match(/^###\s+(.+?):\s+"(.+?)"/);
    if (headerMatch) {
        const id = headerMatch[1];
        const text = headerMatch[2];
        queries[text] = {
            id,
            text,
            expected: [],
            results: { 'leaf-only': [], 'collapsed-tree': [] },
            latency: { 'leaf-only': 0, 'collapsed-tree': 0 }
        };
        currentQueryId = text;
        continue;
    }

    if (!currentQueryId) continue;

    // Expected chunks block
    if (line.includes('**Expected chunks')) {
        let jsonBlock = '';
        let j = i + 1;
        // Skip until ```json or ```
        while (j < lines.length && !lines[j].includes('```')) j++;
        if (lines[j] && lines[j].includes('json')) {
            j++; // Enter block
            while (j < lines.length && !lines[j].includes('```')) {
                jsonBlock += lines[j] + '\n';
                j++;
            }
            try {
                // The JSON might contain "chunk:..." strings
                const parsed = JSON.parse(jsonBlock);
                queries[currentQueryId].expected = parsed;
            } catch (e) {
                // ignore
            }
        }
    }
}

// 2. Parse Logs
const logLines = lines.filter(l => l.includes('[RaptorEvalService]') || l.includes('[EvalRunner]'));

logLines.forEach(line => {
    // Latency
    const latMatch = line.match(/\[RaptorEvalService\]\s+(SearchLeafOnly|Search|SearchAggregated)\s+"(.+?)"\s+in\s+([\d.]+)/);
    if (latMatch) {
        const type = latMatch[1];
        const text = latMatch[2];
        const ms = parseFloat(latMatch[3]);
        const method = type === 'Search' ? 'collapsed-tree' : (type === 'SearchLeafOnly' ? 'leaf-only' : 'aggregated');

        if (queries[text]) {
            queries[text].latency[method] = ms;
        }
    }

    // Results
    const resMatch = line.match(/\[EvalRunner\]\s+(leaf-only|collapsed-tree|aggregated)\s+query\s+"(.+?)"\s+returned\s+(\d+)\s+results:\s+(?:\(\d+\)\s+)?(\[.*?\])/);
    if (resMatch) {
        const method = resMatch[1];
        const text = resMatch[2];
        const top3ArrayStr = resMatch[4]; // ['...', ...]

        if (queries[text] && (method === 'leaf-only' || method === 'collapsed-tree')) {
            const rawItems = top3ArrayStr.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
            const cleanItems = rawItems.map(extractId).filter(s => s.length > 0);
            queries[text].results[method] = cleanItems;
        }
    }
});

// 3. Analysis
let output = 'RAPTOR Evaluation Analysis (Top-3 Check)\n========================================\n\n';

const metrics = {
    'leaf-only': { matched: 0, total_retrieved: 0, total_expected: 0, latencies: [] },
    'collapsed-tree': { matched: 0, total_retrieved: 0, total_expected: 0, latencies: [] }
};

const comparisons = [];
const anomalyThreshold = 50; // ms

Object.keys(queries).forEach(text => {
    const q = queries[text];
    if (!q.expected || q.expected.length === 0) return;

    const expectedSet = new Set(q.expected);

    ['leaf-only', 'collapsed-tree'].forEach(method => {
        const retrieved = q.results[method];
        if (!retrieved) return;

        const validRetrieved = retrieved.filter(id => id.includes('chunk:'));
        const matchedCount = validRetrieved.filter(id => expectedSet.has(id)).length;

        metrics[method].matched += matchedCount;
        metrics[method].total_retrieved += validRetrieved.length;
        metrics[method].total_expected += q.expected.length;
        metrics[method].latencies.push(q.latency[method] || 0);

        q[method + '_matched'] = matchedCount;
    });

    if (q.latency['collapsed-tree'] > anomalyThreshold) {
        comparisons.push({
            id: q.id,
            text: q.text,
            lat_leaf: q.latency['leaf-only'],
            lat_coll: q.latency['collapsed-tree'],
            match_leaf: q['leaf-only_matched'],
            match_coll: q['collapsed-tree_matched'],
            recall_impact: q['collapsed-tree_matched'] < q['leaf-only_matched']
        });
    }
});

output += '--- Overall Metrics (Top-3 Comparison) ---\n';
['leaf-only', 'collapsed-tree'].forEach(method => {
    const m = metrics[method];
    const p3 = m.total_retrieved > 0 ? (m.matched / m.total_retrieved) : 0;
    const r3 = m.total_expected > 0 ? (m.matched / m.total_expected) : 0;

    const latSum = m.latencies.reduce((a, b) => a + b, 0);
    const avgLat = m.latencies.length ? (latSum / m.latencies.length) : 0;
    const sortedLat = [...m.latencies].sort((a, b) => a - b);
    const p95 = sortedLat[Math.floor(sortedLat.length * 0.95)] || 0;
    const p99 = sortedLat[Math.floor(sortedLat.length * 0.99)] || 0;

    output += `\nMethod: ${method}\n`;
    output += `  Top-3 Precision: ${(p3 * 100).toFixed(2)}%\n`;
    output += `  Top-3 Recall:    ${(r3 * 100).toFixed(2)}%\n`;
    output += `  Latency (Avg):   ${avgLat.toFixed(2)} ms\n`;
    output += `  Latency (P95):   ${p95.toFixed(2)} ms\n`;
    output += `  Latency (P99):   ${p99.toFixed(2)} ms\n`;
});

output += '\n--- Latency & Recall Anomalies ---\n';
comparisons.sort((a, b) => b.lat_coll - a.lat_coll).forEach(c => {
    output += `[${c.id}] "${c.text}"\n`;
    output += `  Latency: Collapsed=${c.lat_coll.toFixed(2)}ms vs Leaf=${c.lat_leaf.toFixed(2)}ms\n`;
    output += `  Matched (Top-3): Collapsed=${c.match_coll} vs Leaf=${c.match_leaf}\n`;
    if (c.recall_impact) output += `  ⚠️ Recall DROP in Collapsed Mode\n`;
    output += '\n';
});

fs.writeFileSync(outputPath, output);
console.log('Analysis written to: ' + outputPath);
