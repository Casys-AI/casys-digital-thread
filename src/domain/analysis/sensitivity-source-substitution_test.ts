import { assertEquals, assertThrows } from "@std/assert";
import {
  extractFiniteNumericLiteral,
  locateModuleLevelNumericBinding,
  substituteModuleLevelNumericLiteral,
} from "./sensitivity-source-substitution.ts";

const SPAN = {
  start: { line: 1, column: 9 },
  end: { line: 1, column: 13 },
};

Deno.test(
  "substituteModuleLevelNumericLiteral replaces only the spanned finite literal",
  () => {
    const source = "size_z = 50.0\nresult = Box(size_z)\n";
    assertEquals(extractFiniteNumericLiteral(source, SPAN), 50);
    assertEquals(
      substituteModuleLevelNumericLiteral(source, SPAN, 51),
      "size_z = 51\nresult = Box(size_z)\n",
    );
  },
);

Deno.test(
  "locateModuleLevelNumericBinding reads the RHS literal from a sealed name span",
  () => {
    const source = "size_z = 50.0\nresult = Box(size_z)\n";
    const binding = locateModuleLevelNumericBinding(source, {
      start: { line: 1, column: 0 },
      end: { line: 1, column: 6 },
    }, "size_z");
    assertEquals(binding.value, 50);
    assertEquals(
      substituteModuleLevelNumericLiteral(source, binding.valueSpan, 51),
      "size_z = 51\nresult = Box(size_z)\n",
    );
  },
);

Deno.test(
  "substituteModuleLevelNumericLiteral refuses a span that is not a finite numeric literal",
  () => {
    const source = "size_z = BASE\n";
    assertThrows(
      () =>
        substituteModuleLevelNumericLiteral(source, {
          start: { line: 1, column: 9 },
          end: { line: 1, column: 13 },
        }, 51),
      TypeError,
      "finite numeric literal",
    );
  },
);
