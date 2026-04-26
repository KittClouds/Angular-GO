type RangeLike = {
    start?: number;
    end?: number;
    from?: number;
    to?: number;
} | null | undefined;

export interface TextRange {
    from: number;
    to: number;
}

interface Utf8ToUtf16Index {
    byteOffsets: Uint32Array;
    utf16Offsets: Uint32Array;
    totalBytes: number;
}

export interface Utf8ByteRangeConverter {
    toUtf16Range(range: RangeLike): TextRange | null;
    slice(range: RangeLike): string;
}

export function createUtf8ByteRangeConverter(text: string): Utf8ByteRangeConverter {
    const index = buildUtf8ToUtf16Index(text);

    const toUtf16Range = (range: RangeLike): TextRange | null => {
        const from = readOffset(range, 'start', 'from');
        const to = readOffset(range, 'end', 'to');
        if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) {
            return null;
        }

        if (!index) {
            return {
                from: clampOffset(from, text.length),
                to: clampOffset(to, text.length),
            };
        }

        const utf16From = utf8ByteOffsetToUtf16Offset(index, from, false);
        const utf16To = utf8ByteOffsetToUtf16Offset(index, to, true);
        if (utf16To <= utf16From) {
            return null;
        }

        return { from: utf16From, to: utf16To };
    };

    return {
        toUtf16Range,
        slice(range: RangeLike): string {
            const normalized = toUtf16Range(range);
            return normalized ? text.slice(normalized.from, normalized.to) : '';
        },
    };
}

function buildUtf8ToUtf16Index(text: string): Utf8ToUtf16Index | null {
    const byteOffsets: number[] = [0];
    const utf16Offsets: number[] = [0];
    let sawNonAscii = false;
    let utf16Offset = 0;
    let byteOffset = 0;

    for (let index = 0; index < text.length;) {
        const codePoint = text.codePointAt(index);
        if (codePoint === undefined) {
            break;
        }

        const utf16Width = codePoint > 0xffff ? 2 : 1;
        const utf8Width = utf8WidthForCodePoint(codePoint);
        if (utf8Width !== utf16Width) {
            sawNonAscii = true;
        }

        utf16Offset += utf16Width;
        byteOffset += utf8Width;
        utf16Offsets.push(utf16Offset);
        byteOffsets.push(byteOffset);
        index += utf16Width;
    }

    if (!sawNonAscii) {
        return null;
    }

    return {
        byteOffsets: Uint32Array.from(byteOffsets),
        utf16Offsets: Uint32Array.from(utf16Offsets),
        totalBytes: byteOffset,
    };
}

function utf8ByteOffsetToUtf16Offset(
    index: Utf8ToUtf16Index,
    byteOffset: number,
    preferCeil: boolean,
): number {
    if (byteOffset <= 0) {
        return 0;
    }
    if (byteOffset >= index.totalBytes) {
        return index.utf16Offsets[index.utf16Offsets.length - 1] ?? 0;
    }

    let left = 0;
    let right = index.byteOffsets.length - 1;
    while (left <= right) {
        const middle = (left + right) >>> 1;
        const current = index.byteOffsets[middle] ?? 0;
        if (current === byteOffset) {
            return index.utf16Offsets[middle] ?? 0;
        }
        if (current < byteOffset) {
            left = middle + 1;
        } else {
            right = middle - 1;
        }
    }

    if (preferCeil) {
        const ceilIndex = Math.min(left, index.utf16Offsets.length - 1);
        return index.utf16Offsets[ceilIndex] ?? 0;
    }

    const floorIndex = Math.max(0, right);
    return index.utf16Offsets[floorIndex] ?? 0;
}

function utf8WidthForCodePoint(codePoint: number): number {
    if (codePoint <= 0x7f) {
        return 1;
    }
    if (codePoint <= 0x7ff) {
        return 2;
    }
    if (codePoint <= 0xffff) {
        return 3;
    }
    return 4;
}

function readOffset(range: RangeLike, primaryKey: 'start' | 'end', fallbackKey: 'from' | 'to'): number {
    const value = range && typeof range === 'object'
        ? (range[primaryKey] ?? range[fallbackKey])
        : Number.NaN;
    return Number(value);
}

function clampOffset(offset: number, upperBound: number): number {
    return Math.max(0, Math.min(offset, upperBound));
}
