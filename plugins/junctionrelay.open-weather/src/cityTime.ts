/**
 * Format a Unix timestamp as a local time string in a city's timezone.
 *
 * OpenWeather reports the city's timezone as an offset in seconds east of UTC.
 * Shifting the instant by that offset and formatting in UTC yields the city's
 * wall-clock time, independent of the host machine's timezone.
 */
export function formatCityTime(epochSeconds: number, tzOffsetSeconds: number): string {
  const offset = Number.isFinite(tzOffsetSeconds) ? tzOffsetSeconds : 0;
  return new Date((epochSeconds + offset) * 1000).toLocaleTimeString(undefined, { timeZone: 'UTC' });
}
