import { assertEquals, assertThrows } from "@std/assert";
import {
  closedRecord,
  deepFreeze,
  exactRecord,
  exactVersionToken,
  finite,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  positiveInteger,
  proposalParameterSlug,
  rejectDuplicates,
  safeId,
  safeVersion,
} from "./case-validation.ts";

// ---------------------------------------------------------------------------
// exactRecord — fail-closed key validation
// ---------------------------------------------------------------------------

Deno.test("case-validation never accepts an object with an extra key", () => {
  assertThrows(
    () => exactRecord({ id: "x", extra: "y" }, ["id"], "$obj"),
    TypeError,
    "unsupported field extra",
  );
});

Deno.test("case-validation never accepts an object with a missing key", () => {
  assertThrows(
    () => exactRecord({ id: "x" }, ["id", "name"], "$obj"),
    TypeError,
    ".name is required",
  );
});

Deno.test("case-validation exactRecord rejects null", () => {
  assertThrows(
    () => exactRecord(null, ["id"], "$obj"),
    TypeError,
    "must be an object",
  );
});

Deno.test("case-validation exactRecord rejects an array", () => {
  assertThrows(
    () => exactRecord([], ["id"], "$obj"),
    TypeError,
    "must be an object",
  );
});

Deno.test("case-validation exactRecord rejects a non-object primitive", () => {
  assertThrows(
    () => exactRecord("text", ["id"], "$obj"),
    TypeError,
    "must be an object",
  );
});

Deno.test("case-validation exactRecord accepts an object with exactly the declared keys", () => {
  const result = exactRecord({ id: "x", name: "y" }, ["id", "name"], "$obj");
  assertEquals(result["id"], "x");
  assertEquals(result["name"], "y");
});

Deno.test("case-validation exactRecord accepts an empty key set on an empty object", () => {
  const result = exactRecord({}, [], "$obj");
  assertEquals(Object.keys(result).length, 0);
});

Deno.test("case-validation closedRecord accepts an omitted optional key", () => {
  const result = closedRecord({ id: "x" }, ["id", "basis"], ["id"], "$obj");
  assertEquals(result["id"], "x");
  assertEquals("basis" in result, false);
});

Deno.test("case-validation closedRecord rejects an undeclared key", () => {
  assertThrows(
    () => closedRecord({ id: "x", extra: 1 }, ["id"], ["id"], "$obj"),
    TypeError,
    "unsupported field extra",
  );
});

// ---------------------------------------------------------------------------
// deepFreeze — idempotence and deep coverage
// ---------------------------------------------------------------------------

Deno.test("case-validation deepFreeze is idempotent on an already-frozen object", () => {
  const obj = Object.freeze({ value: 1 });
  const result = deepFreeze(obj);
  assertEquals(Object.isFrozen(result), true);
  assertEquals(result, obj);
});

Deno.test("case-validation deepFreeze freezes nested objects", () => {
  const obj = { outer: { inner: { value: 42 } } };
  deepFreeze(obj);
  assertEquals(Object.isFrozen(obj), true);
  assertEquals(Object.isFrozen(obj.outer), true);
  assertEquals(Object.isFrozen(obj.outer.inner), true);
});

Deno.test("case-validation deepFreeze returns the original reference", () => {
  const obj = { a: 1 };
  const result = deepFreeze(obj);
  assertEquals(result === obj, true);
});

// ---------------------------------------------------------------------------
// nonEmptyText — edge whitespace
// ---------------------------------------------------------------------------

Deno.test("case-validation nonEmptyText rejects a string with leading whitespace", () => {
  assertThrows(() => nonEmptyText(" text", "$x"), TypeError, "edge whitespace");
});

Deno.test("case-validation nonEmptyText rejects a string with trailing whitespace", () => {
  assertThrows(() => nonEmptyText("text ", "$x"), TypeError, "edge whitespace");
});

Deno.test("case-validation nonEmptyText rejects an empty string", () => {
  assertThrows(() => nonEmptyText("", "$x"), TypeError);
});

Deno.test("case-validation nonEmptyText rejects a whitespace-only string", () => {
  assertThrows(() => nonEmptyText("   ", "$x"), TypeError);
});

Deno.test("case-validation nonEmptyText accepts a trimmed non-empty string", () => {
  assertEquals(nonEmptyText("hello world", "$x"), "hello world");
});

// ---------------------------------------------------------------------------
// safeId — regex
// ---------------------------------------------------------------------------

Deno.test("case-validation safeId rejects a string starting with a hyphen", () => {
  assertThrows(() => safeId("-bad", "$x"), TypeError, "stable identifier");
});

Deno.test("case-validation safeId rejects a string with spaces", () => {
  assertThrows(() => safeId("has space", "$x"), TypeError, "stable identifier");
});

Deno.test("case-validation safeId accepts a hyphenated identifier", () => {
  assertEquals(safeId("my-id:v1.0", "$x"), "my-id:v1.0");
});

Deno.test("case-validation safeId accepts an alphanumeric identifier", () => {
  assertEquals(safeId("req1", "$x"), "req1");
});

Deno.test("case-validation proposalParameterSlug accepts a hyphenated grouping key", () => {
  assertEquals(
    proposalParameterSlug("heated-stage-plate", "$slug"),
    "heated-stage-plate",
  );
  assertEquals(proposalParameterSlug("arm_plate", "$slug"), "arm_plate");
});

Deno.test("case-validation proposalParameterSlug rejects dots and colons that SAFE_ID would accept", () => {
  assertEquals(safeId("heated.stage", "$id"), "heated.stage");
  assertEquals(safeId("heated:stage", "$id"), "heated:stage");
  assertThrows(
    () => proposalParameterSlug("heated.stage", "$slug"),
    TypeError,
    "proposal parameter slug",
  );
  assertThrows(
    () => proposalParameterSlug("heated:stage", "$slug"),
    TypeError,
    "proposal parameter slug",
  );
});

Deno.test("case-validation safeVersion accepts bounded build metadata without widening safeId", () => {
  assertEquals(safeVersion("1.0.0+occt", "$version"), "1.0.0+occt");
  assertThrows(() => safeId("1.0.0+occt", "$id"), TypeError);
});

Deno.test("case-validation safeVersion rejects unsafe or overlong versions", () => {
  for (
    const version of ["version with space", "1.0.0/occt", "é.1", `v${"1".repeat(128)}`]
  ) {
    assertThrows(
      () => safeVersion(version, "$version"),
      TypeError,
      "safe ASCII version",
    );
  }
});

Deno.test("case-validation exactVersionToken rejects mutable aliases case-insensitively", () => {
  for (
    const alias of [
      "latest",
      "LATEST",
      "current",
      "Current",
      "stable",
      "STABLE",
      "default",
      "Default",
    ]
  ) {
    assertThrows(
      () => exactVersionToken(alias, "$version"),
      TypeError,
      "mutable version alias",
    );
  }
  assertEquals(exactVersionToken("1.0.0+occt", "$version"), "1.0.0+occt");
});

// ---------------------------------------------------------------------------
// rejectDuplicates
// ---------------------------------------------------------------------------

Deno.test("case-validation rejectDuplicates throws on a list with duplicates", () => {
  assertThrows(
    () => rejectDuplicates(["a", "b", "a"], "$list"),
    TypeError,
    "must not contain duplicates",
  );
});

Deno.test("case-validation rejectDuplicates accepts a list with no duplicates", () => {
  // Must not throw.
  rejectDuplicates(["a", "b", "c"], "$list");
});

Deno.test("case-validation rejectDuplicates accepts an empty list", () => {
  rejectDuplicates([], "$list");
});

// ---------------------------------------------------------------------------
// nonEmptyArray
// ---------------------------------------------------------------------------

Deno.test("case-validation nonEmptyArray rejects an empty array", () => {
  assertThrows(() => nonEmptyArray([], "$arr"), TypeError, "must not be empty");
});

Deno.test("case-validation nonEmptyArray rejects a non-array", () => {
  assertThrows(() => nonEmptyArray("x", "$arr"), TypeError, "must be an array");
});

Deno.test("case-validation nonEmptyArray accepts a non-empty array", () => {
  const result = nonEmptyArray([1, 2], "$arr");
  assertEquals(result.length, 2);
});

// ---------------------------------------------------------------------------
// finite
// ---------------------------------------------------------------------------

Deno.test("case-validation finite rejects Infinity", () => {
  assertThrows(() => finite(Infinity, "$x"), TypeError, "finite number");
});

Deno.test("case-validation finite rejects NaN", () => {
  assertThrows(() => finite(NaN, "$x"), TypeError, "finite number");
});

Deno.test("case-validation finite accepts a regular number", () => {
  assertEquals(finite(3.14, "$x"), 3.14);
  assertEquals(finite(0, "$x"), 0);
  assertEquals(finite(-1, "$x"), -1);
});

// ---------------------------------------------------------------------------
// positiveInteger
// ---------------------------------------------------------------------------

Deno.test("case-validation positiveInteger rejects zero", () => {
  assertThrows(() => positiveInteger(0, "$x"), TypeError, "positive integer");
});

Deno.test("case-validation positiveInteger rejects a negative integer", () => {
  assertThrows(() => positiveInteger(-1, "$x"), TypeError, "positive integer");
});

Deno.test("case-validation positiveInteger rejects a non-integer", () => {
  assertThrows(() => positiveInteger(1.5, "$x"), TypeError, "positive integer");
});

Deno.test("case-validation positiveInteger accepts 1", () => {
  assertEquals(positiveInteger(1, "$x"), 1);
});

// ---------------------------------------------------------------------------
// literalValue
// ---------------------------------------------------------------------------

Deno.test("case-validation literalValue rejects a wrong value", () => {
  assertThrows(
    () => literalValue("wrong", "expected", "$x"),
    TypeError,
    "must equal",
  );
});

Deno.test("case-validation literalValue accepts the exact expected value", () => {
  // Must not throw.
  literalValue("ok", "ok", "$x");
  literalValue(42, 42, "$x");
});
