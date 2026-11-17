process.env.TZ = 'Asia/Tokyo';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCityTime } from '../cityTime.js';

const utcTime = (d: Date) => d.toLocaleTimeString(undefined, { timeZone: 'UTC' });

describe('formatCityTime', () => {
  it('formats in a city east of UTC', () => {
    assert.equal(formatCityTime(0, 3600), utcTime(new Date(Date.UTC(1970, 0, 1, 1, 0, 0))));
  });

  it('formats in a city west of UTC', () => {
    assert.equal(formatCityTime(0, -18000), utcTime(new Date(Date.UTC(1969, 11, 31, 19, 0, 0))));
  });

  it('does not use the host timezone', () => {
    assert.notEqual(formatCityTime(0, 3600), new Date(0).toLocaleTimeString());
  });

  it('treats a non-finite offset as 0', () => {
    assert.equal(formatCityTime(0, NaN), formatCityTime(0, 0));
  });
});
