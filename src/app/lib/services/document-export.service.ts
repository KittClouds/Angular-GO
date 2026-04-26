import { Injectable } from '@angular/core';

export interface DocumentExportResult {
    status: 'saved' | 'cancelled';
    fileName: string;
    method: 'file-system-access' | 'download';
}

interface WritableFileLike {
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
}

interface FileHandleLike {
    createWritable(): Promise<WritableFileLike>;
}

type SaveFilePicker = (options: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<FileHandleLike>;

type WindowWithSavePicker = Window & typeof globalThis & {
    showSaveFilePicker?: SaveFilePicker;
};

@Injectable({
    providedIn: 'root',
})
export class DocumentExportService {
    async exportText(title: string, text: string): Promise<DocumentExportResult> {
        const fileName = `${this.safeFileStem(title)}.txt`;
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });

        const picked = await this.trySaveWithFilePicker(fileName, blob);
        if (picked) {
            return picked;
        }

        this.downloadBlob(fileName, blob);
        return { status: 'saved', fileName, method: 'download' };
    }

    private async trySaveWithFilePicker(
        fileName: string,
        blob: Blob
    ): Promise<DocumentExportResult | null> {
        if (typeof window === 'undefined') {
            return null;
        }

        const picker = (window as WindowWithSavePicker).showSaveFilePicker;
        if (!picker) {
            return null;
        }

        try {
            const handle = await picker({
                suggestedName: fileName,
                types: [{
                    description: 'Text document',
                    accept: { 'text/plain': ['.txt'] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return { status: 'saved', fileName, method: 'file-system-access' };
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return { status: 'cancelled', fileName, method: 'file-system-access' };
            }
            return null;
        }
    }

    private downloadBlob(fileName: string, blob: Blob): void {
        if (typeof document === 'undefined') {
            throw new Error('Document export is unavailable outside the browser.');
        }

        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.rel = 'noopener';
        anchor.style.display = 'none';

        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    private safeFileStem(title: string): string {
        const trimmed = title.trim() || 'Untitled Note';
        const cleaned = trimmed
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return (cleaned || 'Untitled Note').slice(0, 120);
    }
}
