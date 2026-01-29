
import { IOpfsBackend } from './BlobStore';

export class RealOpfsBackend implements IOpfsBackend {
    private root: FileSystemDirectoryHandle | null = null;

    async getRoot(): Promise<FileSystemDirectoryHandle> {
        if (!this.root) {
            this.root = await navigator.storage.getDirectory();
        }
        return this.root;
    }

    private async getDirAndName(path: string): Promise<[FileSystemDirectoryHandle, string]> {
        const parts = path.split('/');
        const fileName = parts.pop()!;
        let dir = await this.getRoot();
        for (const part of parts) {
            dir = await dir.getDirectoryHandle(part, { create: true });
        }
        return [dir, fileName];
    }

    async write(path: string, data: Uint8Array): Promise<void> {
        const [dir, name] = await this.getDirAndName(path);
        const handle = await dir.getFileHandle(name, { create: true });
        // @ts-ignore
        const writable = await handle.createWritable();
        // @ts-ignore
        await writable.write(data);
        await writable.close();
    }

    async read(path: string): Promise<Uint8Array | null> {
        try {
            const [dir, name] = await this.getDirAndName(path);
            const handle = await dir.getFileHandle(name);
            const file = await handle.getFile();
            const buffer = await file.arrayBuffer();
            return new Uint8Array(buffer);
        } catch (e: any) {
            if (e.name === 'NotFoundError') return null;
            throw e;
        }
    }

    async exists(path: string): Promise<boolean> {
        try {
            const [dir, name] = await this.getDirAndName(path);
            await dir.getFileHandle(name);
            return true;
        } catch {
            return false;
        }
    }

    async delete(path: string): Promise<boolean> {
        try {
            const [dir, name] = await this.getDirAndName(path);
            await dir.removeEntry(name);
            return true;
        } catch {
            return false;
        }
    }

    async move(srcPath: string, dstPath: string): Promise<void> {
        const [srcDir, srcName] = await this.getDirAndName(srcPath);
        const [dstDir, dstName] = await this.getDirAndName(dstPath);

        const srcHandle = await srcDir.getFileHandle(srcName);

        // @ts-ignore - 'move' API
        await srcHandle.move(dstDir, dstName);
    }
}
