import test from 'node:test';
import assert from 'node:assert';
import { 
    normalizeJoinCode, 
    isValidJoinCode, 
    hashString32,
    generateJoinCode
} from '../modules/utils.js';

test('normalizeJoinCode correctly cleans user input', (t) => {
    assert.strictEqual(normalizeJoinCode(' otter-ab12-cd34 '), 'OTTER-AB12-CD34');
    assert.strictEqual(normalizeJoinCode('otter_ab12__cd34'), 'OTTER-AB12-CD34');
    assert.strictEqual(normalizeJoinCode(''), '');
});

test('isValidJoinCode correctly validates codes', (t) => {
    assert.strictEqual(isValidJoinCode('OTTER-AB12-CD34'), true);
    assert.strictEqual(isValidJoinCode('OTTER-AB12-CD3'), false); // Too short
    assert.strictEqual(isValidJoinCode('OTTER-AB12-CD345'), false); // Too long
    assert.strictEqual(isValidJoinCode('otter-ab12-cd34'), false); // Lowercase (requires normalization first)
});

test('hashString32 is deterministic', (t) => {
    const code = 'OTTER-AB12-CD34';
    const hash1 = hashString32(code);
    const hash2 = hashString32(code);
    assert.strictEqual(hash1, hash2);
    assert.strictEqual(typeof hash1, 'number');
});

test('generateJoinCode produces a valid format', (t) => {
    const code = generateJoinCode();
    assert.strictEqual(isValidJoinCode(code), true);
});
