declare module 'recursive-fs' {
    export function read(directoryPath: string): Promise<{
        dirs?: string[];
        files?: string[];
    }>;
}
