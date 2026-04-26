// src/app/services/playground-log.service.ts
// Shared log service for the Research Playground — all modules write here.

import { Injectable, signal, computed } from '@angular/core';

export type LogSource = 'raptor' | 'memory' | 'numerology' | 'rlm' | 'system';
export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export interface LogEntry {
    id: number;
    timestamp: Date;
    level: LogLevel;
    source: LogSource;
    message: string;
}

@Injectable({ providedIn: 'root' })
export class PlaygroundLogService {
    private _idSeq = 0;
    private _all = signal<LogEntry[]>([]);

    /** All log entries (latest first for display). */
    readonly all = computed(() => this._all());

    /** Active source filter — null means show all. */
    readonly filter = signal<LogSource | null>(null);

    /** Filtered view for the log panel. */
    readonly visible = computed(() => {
        const f = this.filter();
        return f ? this._all().filter(e => e.source === f) : this._all();
    });

    log(level: LogLevel, source: LogSource, message: string): void {
        const entry: LogEntry = {
            id: ++this._idSeq,
            timestamp: new Date(),
            level,
            source,
            message,
        };
        this._all.update(all => [...all, entry]);
    }

    info(source: LogSource, message: string): void { this.log('info', source, message); }
    warn(source: LogSource, message: string): void { this.log('warn', source, message); }
    error(source: LogSource, message: string): void { this.log('error', source, message); }
    success(source: LogSource, message: string): void { this.log('success', source, message); }

    /** Clear all logs or only a specific source. */
    clear(source?: LogSource): void {
        if (source) {
            this._all.update(all => all.filter(e => e.source !== source));
        } else {
            this._all.set([]);
        }
    }
}
