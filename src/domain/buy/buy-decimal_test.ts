import { assertEquals, assertThrows } from "@std/assert";
import {
  addBuyDecimals,
  BUY_DECIMAL_SCHEMA,
  isPositiveBuyDecimal,
  multiplyBuyDecimals,
  parseBuyDecimal,
  parseNonNegativeBuyDecimal,
  roundBuyDecimal,
} from "./buy-decimal.ts";

Deno.test("parses and preserves decimal strings", () => {
  assertEquals(parseBuyDecimal("12.50", "$"), "12.50");
  assertEquals(parseBuyDecimal("0.01", "$"), "0.01");
  assertEquals(parseBuyDecimal("-3", "$"), "-3");
});

Deno.test("refuses scientific notation and non-decimals", () => {
  assertThrows(() => parseBuyDecimal("1e2", "$"), TypeError);
  assertThrows(() => parseBuyDecimal("01.0", "$"), TypeError);
});

Deno.test("adds and multiplies without binary floats", () => {
  assertEquals(addBuyDecimals("12.50", "12.50"), "25.00");
  assertEquals(multiplyBuyDecimals("2", "12.50"), "25.00");
  assertEquals(multiplyBuyDecimals("3", "0.10"), "0.30");
});

Deno.test("non-negative parser keeps zero and refuses a minus sign", () => {
  assertEquals(parseNonNegativeBuyDecimal("0", "$"), "0");
  assertEquals(parseNonNegativeBuyDecimal("0.00", "$"), "0.00");
  assertEquals(parseNonNegativeBuyDecimal("4", "$"), "4");
  assertThrows(
    () => parseNonNegativeBuyDecimal("-1", "$"),
    TypeError,
    "non-negative",
  );
});

Deno.test("positive decimal excludes zero and negatives", () => {
  assertEquals(isPositiveBuyDecimal("0.90"), true);
  assertEquals(isPositiveBuyDecimal("0"), false);
  assertEquals(isPositiveBuyDecimal("0.00"), false);
  assertEquals(isPositiveBuyDecimal("-0.90"), false);
});

Deno.test("rounds half-up at a versioned scale", () => {
  const rounding = {
    schemaVersion: BUY_DECIMAL_SCHEMA,
    scale: 2,
    mode: "half-up" as const,
  };
  assertEquals(roundBuyDecimal("1.225", rounding), "1.23");
  assertEquals(roundBuyDecimal("1.224", rounding), "1.22");
  assertEquals(roundBuyDecimal("10", rounding), "10.00");
});
