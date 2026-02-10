import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDecimalPlaces, sanitizeSensorValue, sanitizeDecimalPlaces, safeRound } from '../helpers.js';

describe('getDecimalPlaces', () => {
  it('returns 0 for empty string', () => {
    assert.equal(getDecimalPlaces(''), 0);
  });

  it('returns 0 for integer string', () => {
    assert.equal(getDecimalPlaces('42'), 0);
  });

  it('returns correct count for decimal values', () => {
    assert.equal(getDecimalPlaces('3.14'), 2);
    // parseFloat('1.0') -> 1 -> '1' -> no decimal -> 0
    assert.equal(getDecimalPlaces('1.0'), 0);
    assert.equal(getDecimalPlaces('0.12345'), 5);
  });

  it('returns 0 for non-numeric string', () => {
    assert.equal(getDecimalPlaces('abc'), 0);
  });

  it('handles negative numbers', () => {
    assert.equal(getDecimalPlaces('-3.14'), 2);
  });

  it('handles zero', () => {
    assert.equal(getDecimalPlaces('0'), 0);
    // parseFloat('0.0') -> 0 -> '0' -> no decimal point -> 0
    assert.equal(getDecimalPlaces('0.0'), 0);
  });

  it('strips trailing zeros per parseFloat behavior', () => {
    // parseFloat('1.200') -> 1.2 -> '1.2' -> 1 decimal place
    assert.equal(getDecimalPlaces('1.200'), 1);
  });
});

describe('sanitizeDecimalPlaces', () => {
  it('returns 0 for negative values', () => {
    assert.equal(sanitizeDecimalPlaces(-1), 0);
    assert.equal(sanitizeDecimalPlaces(-100), 0);
  });

  it('returns MAX_DECIMAL_PLACES for values above limit', () => {
    assert.equal(sanitizeDecimalPlaces(16), 15);
    assert.equal(sanitizeDecimalPlaces(100), 15);
  });

  it('passes through valid values', () => {
    assert.equal(sanitizeDecimalPlaces(0), 0);
    assert.equal(sanitizeDecimalPlaces(5), 5);
    assert.equal(sanitizeDecimalPlaces(15), 15);
  });

  it('floors fractional values', () => {
    assert.equal(sanitizeDecimalPlaces(2.7), 2);
    assert.equal(sanitizeDecimalPlaces(3.1), 3);
  });
});

describe('safeRound', () => {
  it('rounds to 0 decimal places', () => {
    assert.equal(safeRound(3.7, 0), 4);
    assert.equal(safeRound(3.2, 0), 3);
  });

  it('rounds to specified decimal places', () => {
    assert.equal(safeRound(3.14159, 2), 3.14);
    assert.equal(safeRound(3.14159, 4), 3.1416);
  });

  it('handles negative decimal places by clamping to 0', () => {
    assert.equal(safeRound(3.7, -1), 4);
  });

  it('handles values that exceed MAX_DECIMAL_PLACES', () => {
    // Should clamp to 15 decimal places
    const result = safeRound(1.123456789012345, 20);
    assert.equal(typeof result, 'number');
  });
});

describe('sanitizeSensorValue', () => {
  it('formats value to requested decimal places', () => {
    const result = sanitizeSensorValue(3.14159, 2);
    assert.equal(result.value, '3.14');
    assert.equal(result.decimalPlaces, 2);
  });

  it('adds trailing zeros', () => {
    const result = sanitizeSensorValue(3, 3);
    assert.equal(result.value, '3.000');
    assert.equal(result.decimalPlaces, 3);
  });

  it('clamps decimal places to MAX_DECIMAL_PLACES', () => {
    const result = sanitizeSensorValue(1.5, 20);
    assert.equal(result.decimalPlaces, 15);
  });

  it('handles zero decimal places', () => {
    const result = sanitizeSensorValue(3.7, 0);
    assert.equal(result.value, '4');
    assert.equal(result.decimalPlaces, 0);
  });

  it('handles negative decimal places by clamping to 0', () => {
    const result = sanitizeSensorValue(3.7, -1);
    assert.equal(result.value, '4');
    assert.equal(result.decimalPlaces, 0);
  });
});
