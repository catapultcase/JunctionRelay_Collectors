import { MAX_DECIMAL_PLACES } from '@junctionrelay/collector-protocol';

/**
 * Detect decimal places from a string value.
 * Matches Server's Helper_DataCollector.GetDecimalPlaces(string).
 */
export function getDecimalPlaces(value: string): number {
  if (!value) return 0;
  const num = parseFloat(value);
  if (isNaN(num)) return 0;

  const str = num.toString();
  const decimalIndex = str.indexOf('.');
  if (decimalIndex === -1) return 0;
  return str.length - decimalIndex - 1;
}

/**
 * Clamp decimal places to [0, MAX_DECIMAL_PLACES].
 * Matches Server's Helper_DataCollector decimal place clamping.
 */
export function sanitizeDecimalPlaces(decimalPlaces: number): number {
  if (decimalPlaces < 0) return 0;
  if (decimalPlaces > MAX_DECIMAL_PLACES) return MAX_DECIMAL_PLACES;
  return Math.floor(decimalPlaces);
}

/**
 * Safe rounding that avoids floating-point precision issues.
 * Uses the multiply-round-divide approach matching C# Math.Round behavior.
 */
export function safeRound(value: number, decimalPlaces: number): number {
  const dp = sanitizeDecimalPlaces(decimalPlaces);
  if (dp === 0) return Math.round(value);
  const factor = Math.pow(10, dp);
  return Math.round(value * factor) / factor;
}

/**
 * Sanitize and format a numeric value to a specific number of decimal places.
 * Matches Server's Helper_DataCollector.SanitizeSensorValue(double, int).
 */
export function sanitizeSensorValue(
  value: number,
  requestedDecimalPlaces: number,
): { value: string; decimalPlaces: number } {
  const safeDecimalPlaces = sanitizeDecimalPlaces(requestedDecimalPlaces);
  const rounded = safeRound(value, safeDecimalPlaces);
  const sanitized = rounded.toFixed(safeDecimalPlaces);
  return { value: sanitized, decimalPlaces: safeDecimalPlaces };
}
