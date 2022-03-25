import fs from 'fs';
import path from 'path';
import recursiveFs from 'recursive-fs';
import slash from 'slash';
import yazl from 'yazl';

import { Package, PackageInfo } from 'code-push/script/types';
import { out } from '../util/interaction';
import { generateRandomFilename } from '../lib/file-utils';
import * as cli from '../definitions/cli';

const progress = require('progress');

import AccountManager = require('code-push');

var coreReleaseHook: cli.ReleaseHook = (
    currentCommand: cli.IReleaseCommand,
    originalCommand: cli.IReleaseCommand,
    sdk: AccountManager,
): Promise<cli.IReleaseCommand> => {
    return Promise.resolve(<void>null)
        .then(() => {
            var releaseFiles: cli.ReleaseFile[] = [];

            if (!fs.lstatSync(currentCommand.package).isDirectory()) {
                releaseFiles.push({
                    sourceLocation: currentCommand.package,
                    targetLocation: path.basename(currentCommand.package), // Put the file in the root
                });
                return Promise.resolve(releaseFiles);
            }

            return new Promise<cli.ReleaseFile[]>(async (resolve, reject) => {
                var directoryPath: string = currentCommand.package;
                var baseDirectoryPath = path.join(directoryPath, '..'); // For legacy reasons, put the root directory in the zip

                try {
                    var { files } = await recursiveFs.read(currentCommand.package);
                    files.forEach((filePath: string) => {
                        var relativePath: string = path.relative(baseDirectoryPath, filePath);
                        // yazl does not like backslash (\) in the metadata path.
                        relativePath = slash(relativePath);
                        releaseFiles.push({
                            sourceLocation: filePath,
                            targetLocation: relativePath,
                        });
                    });

                    resolve(releaseFiles);
                } catch (error) {
                    reject(error);
                }
            });
        })
        .then((releaseFiles: cli.ReleaseFile[]) => {
            return new Promise<string>((resolve, reject): void => {
                var packagePath: string = path.join(
                    process.cwd(),
                    generateRandomFilename(15) + '.zip',
                );
                var zipFile = new yazl.ZipFile();
                var writeStream: fs.WriteStream = fs.createWriteStream(packagePath);

                zipFile.outputStream
                    .pipe(writeStream)
                    .on('error', (error: Error): void => {
                        reject(error);
                    })
                    .on('close', (): void => {
                        resolve(packagePath);
                    });

                releaseFiles.forEach((releaseFile: cli.ReleaseFile) => {
                    zipFile.addFile(releaseFile.sourceLocation, releaseFile.targetLocation);
                });

                zipFile.end();
            });
        })
        .then((packagePath: string): Promise<cli.IReleaseCommand> => {
            var lastTotalProgress = 0;
            var progressBar = new progress('Upload progress:[:bar] :percent :etas', {
                complete: '=',
                incomplete: ' ',
                width: 50,
                total: 100,
            });

            var uploadProgress = (currentProgress: number): void => {
                progressBar.tick(currentProgress - lastTotalProgress);
                lastTotalProgress = currentProgress;
            };

            var updateMetadata: PackageInfo = {
                description: currentCommand.description,
                isDisabled: currentCommand.disabled,
                isMandatory: currentCommand.mandatory,
                rollout: currentCommand.rollout,
            };

            return sdk
                .isAuthenticated(true)
                .then((isAuth: boolean): Promise<Package> => {
                    return sdk.release(
                        currentCommand.appName,
                        currentCommand.deploymentName,
                        packagePath,
                        currentCommand.appStoreVersion,
                        updateMetadata,
                        uploadProgress,
                    );
                })
                .then((): void => {
                    out.text(
                        `Successfully released an update containing the "${originalCommand.package}" ` +
                            `${
                                fs.lstatSync(originalCommand.package).isDirectory()
                                    ? 'directory'
                                    : 'file'
                            }` +
                            ` to the "${currentCommand.deploymentName}" deployment of the "${currentCommand.appName}" app.`,
                    );
                })
                .then(() => currentCommand)
                .finally(() => {
                    fs.unlinkSync(packagePath);
                });
        });
};

export = coreReleaseHook;
