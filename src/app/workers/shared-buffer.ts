/**
 * SharedRingBuffer - Zero-copy communication channel with Go WASM
 *
 * Uses SharedArrayBuffer + Atomics for efficient data transfer.
 * Go writes directly to the SAB, JS reads without copying.
 *
 * REQUIREMENTS:
 * - Headers: Cross-Origin-Opener-Policy: same-origin
 * - Headers: Cross-Origin-Embedder-Policy: require-corp
 * - HTTPS in production (localhost exempt for dev)
 */

// Message types (must match Go sab package)
export const MsgType = {
    NONE: 0,
    SCAN_RESULT: 1,
    GRAPH_UPDATE: 2,
    ENTITY_SPANS: 3,
    ACK: 0xFF,
} as const;

// Header layout (first 16 bytes)
const OFFSET_READY = 0;     // int32: 0 = idle, 1 = data ready
const OFFSET_LENGTH = 4;    // uint32: payload length
const OFFSET_MSG_TYPE = 8;  // uint32: message type
const OFFSET_RESERVED = 12; // uint32: reserved
const OFFSET_PAYLOAD = 16;  // payload starts here

export interface MessageHeader {
    ready: number;
    length: number;
    msgType: number;
}

export interface EntitySpan {
    start: number;
    end: number;
    kind: number;
    labelId: number;
}

export interface GraphEdge {
    sourceHash: number;
    targetHash: number;
    relType: number;
    weight: number; // Fixed point / 1000
}

/**
 * Check if SharedArrayBuffer is available
 */
export function isSharedArrayBufferAvailable(): boolean {
    if (typeof SharedArrayBuffer === 'undefined') {
        return false;
    }
    // Also check crossOriginIsolated
    if (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated) {
        console.warn('[SharedBuffer] crossOriginIsolated is false - SharedArrayBuffer may not work');
        return false;
    }
    return true;
}

/**
 * SharedRingBuffer - Main class for zero-copy Go↔JS communication
 */
export class SharedRingBuffer {
    private sab: SharedArrayBuffer;
    private dataView: DataView;
    private int32View: Int32Array;
    private uint8View: Uint8Array;

    constructor(size = 65536) {
        if (!isSharedArrayBufferAvailable()) {
            throw new Error('SharedArrayBuffer not available - check COOP/COEP headers');
        }

        this.sab = new SharedArrayBuffer(size);
        this.dataView = new DataView(this.sab);
        this.int32View = new Int32Array(this.sab);
        this.uint8View = new Uint8Array(this.sab);

        // Clear the buffer
        this.uint8View.fill(0);
    }

    /**
     * Get the underlying SharedArrayBuffer for passing to worker
     */
    get buffer(): SharedArrayBuffer {
        return this.sab;
    }

    /**
     * Get buffer size
     */
    get length(): number {
        return this.sab.byteLength;
    }

    /**
     * Read the message header
     */
    readHeader(): MessageHeader {
        return {
            ready: Atomics.load(this.int32View, 0),
            length: this.dataView.getUint32(OFFSET_LENGTH, true),
            msgType: this.dataView.getUint32(OFFSET_MSG_TYPE, true),
        };
    }

    /**
     * Wait for Go to write data (blocking via Atomics.wait)
     * Returns the header once data is available
     */
    waitForData(timeout = 5000): MessageHeader | null {
        // Wait until ready flag becomes non-zero
        const result = Atomics.wait(this.int32View, 0, 0, timeout);

        if (result === 'timed-out') {
            return null;
        }

        return this.readHeader();
    }

    /**
     * Check if data is ready without blocking
     */
    isDataReady(): boolean {
        return Atomics.load(this.int32View, 0) !== 0;
    }

    /**
     * Get raw payload bytes (zero-copy view)
     */
    getPayloadView(length: number): Uint8Array {
        return new Uint8Array(this.sab, OFFSET_PAYLOAD, length);
    }

    /**
     * Copy payload to a new array (when you need ownership)
     */
    getPayloadCopy(length: number): Uint8Array {
        return this.uint8View.slice(OFFSET_PAYLOAD, OFFSET_PAYLOAD + length);
    }

    /**
     * Acknowledge receipt - signals Go that we've consumed the data
     */
    acknowledge(): void {
        // Reset ready flag to 0
        Atomics.store(this.int32View, 0, 0);
        // Notify Go that we're done
        Atomics.notify(this.int32View, 0, 1);
    }

    /**
     * Decode entity spans from binary payload
     */
    decodeEntitySpans(payload: Uint8Array): EntitySpan[] {
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const count = view.getUint32(0, true);
        const spans: EntitySpan[] = [];

        let offset = 4;
        for (let i = 0; i < count; i++) {
            spans.push({
                start: view.getUint32(offset, true),
                end: view.getUint32(offset + 4, true),
                kind: view.getUint16(offset + 8, true),
                labelId: view.getUint16(offset + 10, true),
            });
            offset += 12;
        }

        return spans;
    }

    /**
     * Decode graph edges from binary payload
     */
    decodeEdges(payload: Uint8Array): GraphEdge[] {
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const count = view.getUint32(0, true);
        const edges: GraphEdge[] = [];

        let offset = 4;
        for (let i = 0; i < count; i++) {
            edges.push({
                sourceHash: view.getUint32(offset, true),
                targetHash: view.getUint32(offset + 4, true),
                relType: view.getUint16(offset + 8, true),
                weight: view.getUint16(offset + 10, true) / 1000, // Convert fixed point
            });
            offset += 12;
        }

        return edges;
    }
}

/**
 * SharedBufferChannel - Higher-level async interface
 * Polls for data instead of blocking (for use in main thread)
 */
export class SharedBufferChannel {
    private buffer: SharedRingBuffer;
    private pollInterval: number = 1; // ms

    constructor(buffer: SharedRingBuffer) {
        this.buffer = buffer;
    }

    /**
     * Get the underlying SharedArrayBuffer for passing to worker
     */
    get sab(): SharedArrayBuffer {
        return this.buffer.buffer;
    }

    /**
     * Wait for data asynchronously (non-blocking poll)
     */
    async waitForDataAsync(timeout = 5000): Promise<MessageHeader | null> {
        const start = Date.now();

        while (Date.now() - start < timeout) {
            if (this.buffer.isDataReady()) {
                return this.buffer.readHeader();
            }
            await new Promise(resolve => setTimeout(resolve, this.pollInterval));
        }

        return null;
    }

    /**
     * Read and decode entity spans
     */
    async readEntitySpans(timeout = 5000): Promise<EntitySpan[] | null> {
        const header = await this.waitForDataAsync(timeout);
        if (!header || header.msgType !== MsgType.ENTITY_SPANS) {
            return null;
        }

        const payload = this.buffer.getPayloadView(header.length);
        const spans = this.buffer.decodeEntitySpans(payload);
        this.buffer.acknowledge();

        return spans;
    }

    /**
     * Read raw payload
     */
    readPayload(): { header: MessageHeader; payload: Uint8Array } | null {
        if (!this.buffer.isDataReady()) {
            return null;
        }

        const header = this.buffer.readHeader();
        const payload = this.buffer.getPayloadCopy(header.length);
        this.buffer.acknowledge();

        return { header, payload };
    }
}
