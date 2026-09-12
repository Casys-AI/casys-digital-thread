/**
 * Versioned exact decimal arithmetic for Buy cost sums.
 *
 * Representation is a decimal string. Scientific notation, non-finite
 * numbers, and implicit zero-fill of unknown amounts are refused.
 */

import { nonEmptyText } from "../kernel/case-validation.ts";

export const BUY_DECIMAL_SCHEMA = "buy-decimal/1.0" as const;

export const BUY_DECIMAL_ROUNDING_MODES = ["half-up"] as const;
export type BuyDecimalRoundingMode = typeof BUY_DECIMAL_ROUNDING_MODES[number];

const DECIMAL_PATTERN = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export interface BuyDecimalRounding {
  readonly schemaVersion: typeof BUY_DECIMAL_SCHEMA;
  readonly scale: number;
  readonly mode: BuyDecimalRoundingMode;
}

interface DecimalParts {
  readonly negative: boolean;
  readonly unscaled: bigint;
  readonly scale: number;
}

export function parseBuyDecimal(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!DECIMAL_PATTERN.test(text)) {
    throw new TypeError(
      `${path} must be a decimal string without scientific notation.`,
    );
  }
  return formatParts(parseParts(text));
}

export function parseNonNegativeBuyDecimal(value: unknown, path: string): string {
  const text = parseBuyDecimal(value, path);
  if (text.startsWith("-")) {
    throw new TypeError(`${path} must be a non-negative decimal.`);
  }
  return text;
}

export function isPositiveBuyDecimal(value: string): boolean {
  const parts = parseParts(value);
  return !parts.negative && parts.unscaled > 0n;
}

export function addBuyDecimals(left: string, right: string): string {
  const a = parseParts(left);
  const b = parseParts(right);
  const scale = Math.max(a.scale, b.scale);
  const sum = signedUnscaled(rescale(a, scale)) + signedUnscaled(rescale(b, scale));
  return formatParts(fromSigned(sum, scale));
}

export function multiplyBuyDecimals(left: string, right: string): string {
  const a = parseParts(left);
  const b = parseParts(right);
  return formatParts({
    negative: a.negative !== b.negative && a.unscaled !== 0n && b.unscaled !== 0n,
    unscaled: a.unscaled * b.unscaled,
    scale: a.scale + b.scale,
  });
}

export function roundBuyDecimal(
  value: string,
  rounding: BuyDecimalRounding,
): string {
  if (rounding.schemaVersion !== BUY_DECIMAL_SCHEMA) {
    throw new TypeError("Buy decimal rounding schema is divergent.");
  }
  if (rounding.mode !== "half-up") {
    throw new TypeError("Buy decimal rounding mode is not versioned here.");
  }
  if (
    !Number.isSafeInteger(rounding.scale) || rounding.scale < 0 || rounding.scale > 12
  ) {
    throw new TypeError("Buy decimal rounding scale must be an integer 0..12.");
  }
  return formatParts(roundHalfUp(parseParts(value), rounding.scale));
}

export function validateBuyDecimalRounding(
  value: unknown,
  path: string,
): BuyDecimalRounding {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const rec = value as Record<string, unknown>;
  if (rec.schemaVersion !== BUY_DECIMAL_SCHEMA) {
    throw new TypeError(`${path}.schemaVersion must be ${BUY_DECIMAL_SCHEMA}.`);
  }
  if (rec.mode !== "half-up") {
    throw new TypeError(`${path}.mode must be half-up.`);
  }
  if (
    !Number.isSafeInteger(rec.scale) || Number(rec.scale) < 0 || Number(rec.scale) > 12
  ) {
    throw new TypeError(`${path}.scale must be an integer 0..12.`);
  }
  return {
    schemaVersion: BUY_DECIMAL_SCHEMA,
    scale: Number(rec.scale),
    mode: "half-up",
  };
}

function parseParts(text: string): DecimalParts {
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const dot = unsigned.indexOf(".");
  if (dot < 0) {
    return { negative, unscaled: BigInt(unsigned), scale: 0 };
  }
  const whole = unsigned.slice(0, dot);
  const fraction = unsigned.slice(dot + 1);
  return {
    negative,
    unscaled: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function rescale(parts: DecimalParts, scale: number): DecimalParts {
  if (scale < parts.scale) {
    throw new TypeError("Cannot rescale a decimal down without rounding.");
  }
  const zeros = scale - parts.scale;
  return {
    negative: parts.negative,
    unscaled: parts.unscaled * 10n ** BigInt(zeros),
    scale,
  };
}

function roundHalfUp(parts: DecimalParts, scale: number): DecimalParts {
  if (parts.scale <= scale) return rescale(parts, scale);
  const drop = parts.scale - scale;
  const divisor = 10n ** BigInt(drop);
  const remainder = parts.unscaled % divisor;
  const truncated = parts.unscaled / divisor;
  const half = divisor / 2n;
  const bump = remainder >= half ? 1n : 0n;
  return {
    negative: parts.negative && (truncated + bump) !== 0n,
    unscaled: truncated + bump,
    scale,
  };
}

function signedUnscaled(parts: DecimalParts): bigint {
  return parts.negative ? -parts.unscaled : parts.unscaled;
}

function fromSigned(signed: bigint, scale: number): DecimalParts {
  return {
    negative: signed < 0n,
    unscaled: signed < 0n ? -signed : signed,
    scale,
  };
}

function formatParts(parts: DecimalParts): string {
  const digits = parts.unscaled.toString().padStart(parts.scale + 1, "0");
  const whole = parts.scale === 0 ? digits : digits.slice(0, -parts.scale);
  const fraction = parts.scale === 0 ? "" : digits.slice(-parts.scale);
  const unsigned = parts.scale === 0 ? whole : `${whole}.${fraction}`;
  if (parts.unscaled === 0n) return unsigned;
  return parts.negative ? `-${unsigned}` : unsigned;
}
