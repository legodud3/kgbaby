import test from 'node:test';
import assert from 'node:assert';
import { 
    rmsToDb, 
    updateNoiseFloor
} from '../modules/audio.js';

test('rmsToDb converts RMS to decibels correctly', (t) => {
    // 255 (max byte) should be 0dB
    assert.strictEqual(Math.round(rmsToDb(255)), 0);
    // 127.5 (half) should be approx -6dB
    assert.ok(rmsToDb(127.5) < -5 && rmsToDb(127.5) > -7);
    // 1 (min safe) should be approx -48dB
    assert.ok(rmsToDb(1) < -47 && rmsToDb(1) > -49);
});

test('updateNoiseFloor tracks quiet levels and ignores sudden spikes', (t) => {
    let floor = -60;
    
    // Gradual increase in ambient noise (-58 is within 3dB margin of -60)
    floor = updateNoiseFloor(-58, 10000, floor);
    assert.ok(floor > -60, `Floor ${floor} should be > -60`);
    
    // Sudden spike (e.g., baby crying) should NOT move the floor significantly
    const floorBeforeSpike = floor;
    floor = updateNoiseFloor(-20, 100, floor); 
    assert.strictEqual(floor, floorBeforeSpike); // MarginDb check should block this
});
