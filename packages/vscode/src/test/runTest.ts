import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    // The folder containing the Extension Manifest package.json
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');

    // The path to the extension test script
    const extensionTestsPath = path.resolve(__dirname, './index');

    // Every run gets a fresh profile in the OS temp dir. The default profile
    // lives in .vscode-test/ under the checkout and outlives the run, so one
    // run's state reached the next, and VS Code's IPC socket inside it broke
    // the 103-byte socket path limit whenever the checkout path was long.
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanzo-ide-'));
    try {
        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: ['--disable-extensions', `--user-data-dir=${userDataDir}`]
        });
    } finally {
        fs.rmSync(userDataDir, { recursive: true, force: true });
    }
}

main().catch((err) => {
    console.error('Failed to run tests', err);
    process.exit(1);
});
