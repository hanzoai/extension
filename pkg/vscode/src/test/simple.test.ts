import { strictEqual } from 'assert';

suite('Simple Test Suite', () => {
    test('Basic math test', () => {
        strictEqual(2 + 2, 4);
    });

    test('String test', () => {
        strictEqual('Hanzo'.length, 5);
    });

    test('Array test', () => {
        const arr = [1, 2, 3];
        strictEqual(arr.length, 3);
    });
});