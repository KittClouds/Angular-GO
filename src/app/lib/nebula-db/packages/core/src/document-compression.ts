import { Document } from './types';
// import * as zlib from 'zlib'; // Node.js specific

/**
 * Compression options
 */
export interface CompressionOptions {
  enabled: boolean;
  threshold: number; // Size in bytes above which to compress
  level: number; // Compression level (1-9)
  fields?: string[]; // Specific fields to compress, if empty compress the whole document
}

/**
 * Document with compression metadata
 */
interface CompressedDocument extends Document {
  __compressed?: {
    fields: string[];
    originalSize: number;
  };
}

/**
 * Document compression utility
 * BROWSER-COMPATIBLE VERSION: Compression is disabled to avoid zlib dependency.
 */
export class DocumentCompression {
  private options: CompressionOptions;

  constructor(options: Partial<CompressionOptions> = {}) {
    this.options = {
      enabled: false, // Force disabled
      threshold: options.threshold ?? 1024,
      level: options.level ?? 6,
      fields: options.fields ?? []
    };
  }

  /**
   * Compress a document if it meets the threshold
   */
  compress(doc: Document): Document {
    // Pass-through
    return doc;
  }

  /**
   * Decompress a document if it has compression metadata
   */
  decompress(doc: CompressedDocument): Document {
    // Pass-through
    return doc;
  }

  /**
   * Check if a document is compressed
   */
  isCompressed(doc: Document): boolean {
    return false;
  }

  /**
   * Update compression options
   */
  setOptions(options: Partial<CompressionOptions>): void {
    this.options = {
      ...this.options,
      ...options,
      enabled: false // Force disabled
    };
  }

  /**
   * Get current compression options
   */
  getOptions(): CompressionOptions {
    return { ...this.options };
  }
}
