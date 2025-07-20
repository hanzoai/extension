import * as path from 'path';
import * as Mocha from 'mocha';
import { glob } from 'glob';

export function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        timeout: 60000
    });

    const testsRoot = path.resolve(__dirname, '..');

    return new Promise((c, e) => {
        // Get test file filter from environment
        const testFile = process.env.MOCHA_TEST_FILE;
        
        let pattern = '**/**.test.js';
        if (testFile) {
            pattern = `**/${testFile}.test.js`;
        }

        glob(pattern, { cwd: testsRoot }, (err: any, files: any) => {
            if (err) {
                return e(err);
            }

            // Add files to the test suite
            files.forEach((f: any) => mocha.addFile(path.resolve(testsRoot, f)));

            try {
                // Run the mocha test
                mocha.run((failures: any) => {
                    if (failures > 0) {
                        e(new Error(`${failures} tests failed.`));
                    } else {
                        c();
                    }
                });
            } catch (err) {
                console.error(err);
                e(err);
            }
        });
    });
}