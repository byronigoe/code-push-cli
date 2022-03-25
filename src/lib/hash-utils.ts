/**
 * NOTE!!! This utility file is duplicated for use by the CodePush service (for server-driven hashing/
 * integrity checks) and Management SDK (for end-to-end code signing), please keep them in sync.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import recursiveFs from 'recursive-fs';
import stream from 'stream';

const HASH_ALGORITHM = 'sha256';

export function generatePackageHashFromDirectory(
    directoryPath: string,
    basePath: string,
): Promise<string> {
    if (!fs.lstatSync(directoryPath).isDirectory()) {
        throw new Error('Not a directory. Please either create a directory, or use hashFile().');
    }

    return generatePackageManifestFromDirectory(directoryPath, basePath).then(
        (manifest: PackageManifest) => {
            return manifest.computePackageHash();
        },
    );
}

export function generatePackageManifestFromDirectory(
    directoryPath: string,
    basePath: string,
): Promise<PackageManifest> {
    return new Promise<PackageManifest>(async (resolve, reject) => {
        var fileHashesMap = new Map<string, string>();

        try {
            const { files } = await recursiveFs.read(directoryPath);
            if (!files || files.length === 0) {
                reject("Error: Can't sign the release because no files were found.");
                return;
            }

            // Hash the files sequentially, because streaming them in parallel is not necessarily faster
            var generateManifestPromise: Promise<void> = files.reduce(
                (soFar: Promise<void>, filePath: string) => {
                    return soFar.then(() => {
                        var relativePath: string = PackageManifest.normalizePath(
                            path.relative(basePath, filePath),
                        );
                        if (!PackageManifest.isIgnored(relativePath)) {
                            return hashFile(filePath).then((hash: string) => {
                                fileHashesMap.set(relativePath, hash);
                            });
                        }
                    });
                },
                Promise.resolve(null as void),
            );

            generateManifestPromise.then(() => {
                resolve(new PackageManifest(fileHashesMap));
            }, reject);
        } catch (error) {
            reject(error);
        }
    });
}

export function hashFile(filePath: string): Promise<string> {
    var readStream: fs.ReadStream = fs.createReadStream(filePath);
    return hashStream(readStream);
}

export function hashStream(readStream: stream.Readable): Promise<string> {
    var hashStream = <stream.Transform>(<any>crypto.createHash(HASH_ALGORITHM));

    let isPending = true;
    return new Promise<string>((resolve, reject) => {
        readStream
            .on('error', (error: any): void => {
                if (isPending) {
                    isPending = false;
                    hashStream.end();
                    reject(error);
                }
            })
            .on('end', (): void => {
                if (isPending) {
                    isPending = false;
                    hashStream.end();

                    var buffer = <Buffer>hashStream.read();
                    var hash: string = buffer.toString('hex');

                    resolve(hash);
                }
            });

        readStream.pipe(hashStream);
    });
}

export class PackageManifest {
    private _map: Map<string, string>;

    public constructor(map?: Map<string, string>) {
        if (!map) {
            map = new Map<string, string>();
        }
        this._map = map;
    }

    public toMap(): Map<string, string> {
        return this._map;
    }

    public computePackageHash(): string {
        var entries: string[] = [];
        this._map.forEach((hash: string, name: string): void => {
            entries.push(name + ':' + hash);
        });

        // Make sure this list is alphabetically ordered so that other clients
        // can also compute this hash easily given the update contents.
        entries = entries.sort();

        return crypto.createHash(HASH_ALGORITHM).update(JSON.stringify(entries)).digest('hex');
    }

    public serialize(): string {
        var obj: any = {};

        this._map.forEach(function (value, key) {
            obj[key] = value;
        });

        return JSON.stringify(obj);
    }

    public static deserialize(serializedContents: string): PackageManifest {
        try {
            var obj: any = JSON.parse(serializedContents);
            var map = new Map<string, string>();

            for (var key of Object.keys(obj)) {
                map.set(key, obj[key]);
            }

            return new PackageManifest(map);
        } catch (e) {}
    }

    public static normalizePath(filePath: string): string {
        //replace all backslashes coming from cli running on windows machines by slashes
        return filePath.replace(/\\/g, '/');
    }

    public static isIgnored(relativeFilePath: string): boolean {
        const __MACOSX = '__MACOSX/';
        const DS_STORE = '.DS_Store';
        const CODEPUSH_METADATA = '.codepushrelease';
        return (
            startsWith(relativeFilePath, __MACOSX) ||
            relativeFilePath === DS_STORE ||
            endsWith(relativeFilePath, '/' + DS_STORE) ||
            relativeFilePath === CODEPUSH_METADATA ||
            endsWith(relativeFilePath, '/' + CODEPUSH_METADATA)
        );
    }
}

function startsWith(str: string, prefix: string): boolean {
    return str && str.substring(0, prefix.length) === prefix;
}

function endsWith(str: string, suffix: string): boolean {
    return str && str.indexOf(suffix, str.length - suffix.length) !== -1;
}
