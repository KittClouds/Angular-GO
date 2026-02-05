import { Adapter, Document } from './types';

/**
 * Memory adapter for in-memory storage
 * Data is lost when the application restarts
 */
export class MemoryAdapter implements Adapter {
  private data: Record<string, Document[]> = {};

  /**
   * Load data from memory
   */
  async load(): Promise<Record<string, Document[]>> {
    // Return a deep copy to prevent external modifications
    return JSON.parse(JSON.stringify(this.data));
  }

  /**
   * Save data to memory
   */
  async save(data: Record<string, Document[]>): Promise<void> {
    // Store a deep copy to prevent external modifications
    this.data = JSON.parse(JSON.stringify(data));
  }

  /**
   * Clear all data from memory
   */
  clear(): void {
    this.data = {};
  }

  /**
   * Get the current data (for testing purposes)
   */
  getData(): Record<string, Document[]> {
    return JSON.parse(JSON.stringify(this.data));
  }
} 