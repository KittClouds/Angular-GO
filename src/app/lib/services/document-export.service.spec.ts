// @vitest-environment jsdom

import { describe, expect, it, vi, afterEach } from 'vitest';
import { DocumentExportService } from './document-export.service';

describe('DocumentExportService', () => {
    afterEach(() => {
        delete (window as any).showSaveFilePicker;
        vi.restoreAllMocks();
    });

    it('uses the file-system picker when available', async () => {
        const writes: Blob[] = [];
        const close = vi.fn().mockResolvedValue(undefined);
        (window as any).showSaveFilePicker = vi.fn().mockResolvedValue({
            createWritable: vi.fn().mockResolvedValue({
                write: vi.fn((blob: Blob) => {
                    writes.push(blob);
                    return Promise.resolve();
                }),
                close,
            }),
        });

        const service = new DocumentExportService();
        const result = await service.exportText('My Note', 'hello');

        expect(result).toEqual({
            status: 'saved',
            fileName: 'My Note.txt',
            method: 'file-system-access',
        });
        expect(writes).toHaveLength(1);
        expect(writes[0].size).toBe(5);
        expect(writes[0].type).toBe('text/plain;charset=utf-8');
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('falls back to a download and sanitizes the filename', async () => {
        const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:note');
        const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

        const service = new DocumentExportService();
        const result = await service.exportText('Bad:/Name?', 'body');

        expect(result).toEqual({
            status: 'saved',
            fileName: 'Bad Name.txt',
            method: 'download',
        });
        expect(createUrl).toHaveBeenCalledTimes(1);
        expect(click).toHaveBeenCalledTimes(1);

        await new Promise(resolve => window.setTimeout(resolve, 0));
        expect(revokeUrl).toHaveBeenCalledWith('blob:note');
    });

    it('reports picker cancellation without falling back to download', async () => {
        (window as any).showSaveFilePicker = vi.fn().mockRejectedValue(
            new DOMException('cancelled', 'AbortError')
        );
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

        const service = new DocumentExportService();
        const result = await service.exportText('Draft', 'body');

        expect(result).toEqual({
            status: 'cancelled',
            fileName: 'Draft.txt',
            method: 'file-system-access',
        });
        expect(click).not.toHaveBeenCalled();
    });
});
