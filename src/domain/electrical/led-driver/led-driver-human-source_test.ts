import { assertEquals } from "@std/assert";
import { validLedDriverHumanSourceText } from "../../../testing/led-driver-source-fixtures.ts";
import {
  LED_DRIVER_HUMAN_SOURCE_SCHEMA,
  validateLedDriverHumanSource,
} from "./led-driver-human-source.ts";

Deno.test("LED-driver human source accepts a closed fiche with unresolved unknowns", () => {
  const source = validateLedDriverHumanSource(
    JSON.parse(validLedDriverHumanSourceText()),
  );
  assertEquals(source.schemaVersion, LED_DRIVER_HUMAN_SOURCE_SCHEMA);
  assertEquals(source.id, "fiche.led-driver.desk-lamp");
  assertEquals(source.revision, 1);
  assertEquals(source.circuit.id, "circuit.led-driver");
  assertEquals(source.testCondition.id, "condition.reviewed-supply");
  assertEquals(source.unknowns.length, 5);
  assertEquals(
    source.unknowns.every((item) => item.status === "unresolved"),
    true,
  );
});

Deno.test("LED-driver human source refuses an extra field", () => {
  const input = JSON.parse(validLedDriverHumanSourceText()) as Record<
    string,
    unknown
  >;
  input.netlist = "* invented spice\n";
  const error = assertThrowsOn(() => validateLedDriverHumanSource(input));
  assertEquals(error.message.includes("netlist"), true);
});

Deno.test("LED-driver human source refuses a missing named circuit", () => {
  const input = JSON.parse(validLedDriverHumanSourceText()) as Record<
    string,
    unknown
  >;
  delete input.circuit;
  const error = assertThrowsOn(() => validateLedDriverHumanSource(input));
  assertEquals(error.message.includes("circuit"), true);
});

Deno.test("LED-driver human source refuses a missing test condition", () => {
  const input = JSON.parse(validLedDriverHumanSourceText()) as Record<
    string,
    unknown
  >;
  delete input.testCondition;
  const error = assertThrowsOn(() => validateLedDriverHumanSource(input));
  assertEquals(error.message.includes("testCondition"), true);
});

Deno.test("LED-driver human source refuses omitted unknowns status", () => {
  const input = JSON.parse(validLedDriverHumanSourceText()) as Record<
    string,
    unknown
  >;
  delete input.unknowns;
  const error = assertThrowsOn(() => validateLedDriverHumanSource(input));
  assertEquals(error.message.includes("unknowns"), true);
});

Deno.test("LED-driver human source refuses a resolved unknown status", () => {
  const input = JSON.parse(validLedDriverHumanSourceText()) as {
    unknowns: Array<Record<string, unknown>>;
  };
  input.unknowns[0]!.status = "known";
  const error = assertThrowsOn(() => validateLedDriverHumanSource(input));
  assertEquals(error.message.includes("unresolved"), true);
});

Deno.test("LED-driver human source refuses a physical number field", () => {
  const input = JSON.parse(validLedDriverHumanSourceText()) as Record<
    string,
    unknown
  >;
  input.forwardVoltage = 3.2;
  const error = assertThrowsOn(() => validateLedDriverHumanSource(input));
  assertEquals(error.message.includes("forwardVoltage"), true);
});

function assertThrowsOn(run: () => unknown): TypeError {
  try {
    run();
  } catch (error) {
    if (error instanceof TypeError) return error;
    throw error;
  }
  throw new Error("expected TypeError");
}
