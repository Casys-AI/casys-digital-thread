/**
 * Tests for the fail-closed Python geometry script validator (D4).
 *
 * Each test names one invariant. Forbidden identifiers are tested one by one
 * so that removing a name from FORBIDDEN_NAMES makes exactly one test red.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  GeometryScriptValidationError,
  validateGeometryScript,
} from "./geometry-script-validation.ts";

// ── Minimal valid script used as a passing baseline ──────────────────────────

const VALID_SCRIPT = `from build123d import *
result = Box(10, 10, 10)
`;

// ── Happy path ───────────────────────────────────────────────────────────────

Deno.test("validateGeometryScript accepts a minimal valid build123d script", () => {
  validateGeometryScript(VALID_SCRIPT);
});

Deno.test("validateGeometryScript accepts a script with a math import", () => {
  validateGeometryScript(`from build123d import *
from math import pi, sqrt
result = Cylinder(radius=pi, height=sqrt(4))
`);
});

Deno.test("validateGeometryScript accepts double-quoted string literals", () => {
  validateGeometryScript(`from build123d import *
label = "hello world"
result = Box(1, 2, 3)
`);
});

Deno.test("validateGeometryScript accepts triple-quoted strings", () => {
  validateGeometryScript(`from build123d import *
doc = """multiline
  comment"""
result = Box(1, 2, 3)
`);
});

Deno.test("validateGeometryScript accepts line comments", () => {
  validateGeometryScript(`from build123d import *
# This is a comment
result = Box(1, 1, 1)  # inline comment
`);
});

Deno.test("validateGeometryScript accepts line continuation backslash before newline", () => {
  validateGeometryScript(`from build123d import *
result = Box(1, \\
  2, 3)
`);
});

Deno.test("validateGeometryScript accepts numeric literals with underscores", () => {
  validateGeometryScript(`from build123d import *
x = 1_000
result = Box(x, 2, 3)
`);
});

Deno.test("validateGeometryScript accepts float literals", () => {
  validateGeometryScript(`from build123d import *
result = Box(1.5, 2.7, 3.14159)
`);
});

// ── result assignment invariants ─────────────────────────────────────────────

Deno.test("validateGeometryScript rejects a script where result is never assigned", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from build123d import *
x = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`from build123d import *
x = Box(1, 1, 1)
`);
    } catch (e) {
      return e as GeometryScriptValidationError;
    }
  })();
  assertEquals(err?.code, "result_not_assigned");
});

Deno.test("validateGeometryScript rejects a script where result is assigned twice", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from build123d import *
result = Box(1, 1, 1)
result = Cylinder(1, 2)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`from build123d import *
result = Box(1, 1, 1)
result = Cylinder(1, 2)
`);
    } catch (e) {
      return e as GeometryScriptValidationError;
    }
  })();
  assertEquals(err?.code, "result_multiple_assignments");
});

Deno.test("validateGeometryScript does not count result inside a function call as an assignment", () => {
  // result used as a keyword argument inside a call — not an assignment at depth 0
  validateGeometryScript(`from build123d import *
result = Box(result=True)
`);
});

// ── Forbidden import tests ────────────────────────────────────────────────────

Deno.test("validateGeometryScript rejects import of numpy", () => {
  assertThrows(
    () =>
      validateGeometryScript(`import numpy
from build123d import *
result = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`import numpy
from build123d import *
result = Box(1, 1, 1)
`);
    } catch (e) {
      return e as GeometryScriptValidationError;
    }
  })();
  assertEquals(err?.code, "forbidden_import");
});

Deno.test("validateGeometryScript rejects from os import path", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from os import path
from build123d import *
result = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
});

Deno.test("validateGeometryScript rejects from math import a name outside the allowlist", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from math import factorial
from build123d import *
result = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`from math import factorial
from build123d import *
result = Box(1, 1, 1)
`);
    } catch (e) {
      return e as GeometryScriptValidationError;
    }
  })();
  assertEquals(err?.code, "forbidden_import");
});

// ── Forbidden name tests (one per identifier) ────────────────────────────────

for (
  const name of [
    "os",
    "sys",
    "pathlib",
    "subprocess",
    "socket",
    "requests",
    "urllib",
    "time",
    "datetime",
    "random",
    "secrets",
    "importlib",
    "pickle",
    "exec",
    "eval",
    "compile",
    "open",
    "input",
    "globals",
    "locals",
    "getattr",
    "setattr",
    "delattr",
  ]
) {
  Deno.test(`validateGeometryScript rejects the forbidden identifier '${name}'`, () => {
    const script = `from build123d import *
x = ${name}
result = Box(1, 1, 1)
`;
    assertThrows(() => validateGeometryScript(script), GeometryScriptValidationError);
    const err = (() => {
      try {
        validateGeometryScript(script);
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "forbidden_name");
  });
}

// ── Dunder access test ────────────────────────────────────────────────────────

Deno.test("validateGeometryScript rejects a dunder identifier __class__", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from build123d import *
x = __class__
result = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`from build123d import *
x = __class__
result = Box(1, 1, 1)
`);
    } catch (e) {
      return e as GeometryScriptValidationError;
    }
  })();
  assertEquals(err?.code, "dunder_access");
});

Deno.test("validateGeometryScript rejects __import__", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from build123d import *
result = __import__("os")
`),
    GeometryScriptValidationError,
  );
});

// ── String prefix tests ───────────────────────────────────────────────────────

Deno.test("validateGeometryScript rejects f-string prefix", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from build123d import *
x = f"hello"
result = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`from build123d import *
x = f"hello"
result = Box(1, 1, 1)
`);
    } catch (e) {
      return e as GeometryScriptValidationError;
    }
  })();
  assertEquals(err?.code, "invalid_string_prefix");
});

Deno.test("validateGeometryScript rejects b-string prefix", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from build123d import *
x = b"bytes"
result = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
});

Deno.test("validateGeometryScript rejects r-string prefix", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from build123d import *
x = r"raw"
result = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
});

// ── Number tests ──────────────────────────────────────────────────────────────

Deno.test("validateGeometryScript rejects a non-finite number literal (1e999 overflows to Infinity)", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from build123d import *
x = 1e999
result = Box(x, 1, 1)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`from build123d import *
x = 1e999
result = Box(x, 1, 1)
`);
    } catch (e) {
      return e as GeometryScriptValidationError;
    }
  })();
  assertEquals(err?.code, "non_finite_number");
});

// ── Unterminated string ───────────────────────────────────────────────────────

Deno.test("validateGeometryScript rejects an unterminated single-quoted string", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from build123d import *
x = "unterminated
result = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`from build123d import *
x = "unterminated
result = Box(1, 1, 1)
`);
    } catch (e) {
      return e as GeometryScriptValidationError;
    }
  })();
  assertEquals(err?.code, "unterminated_string");
});

// ── Unrecognized token ────────────────────────────────────────────────────────

Deno.test("validateGeometryScript rejects an unrecognized character (dollar sign)", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from build123d import *
result = Box($, 1, 1)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`from build123d import *
result = Box($, 1, 1)
`);
    } catch (e) {
      return e as GeometryScriptValidationError;
    }
  })();
  assertEquals(err?.code, "unrecognized_token");
});

Deno.test("validateGeometryScript rejects a lone backslash not at end of line", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from build123d import *
result = Box(\\1, 1, 1)
`),
    GeometryScriptValidationError,
  );
});

// ── Size limits ───────────────────────────────────────────────────────────────

Deno.test("validateGeometryScript rejects a script that exceeds 64 KiB", () => {
  const huge =
    `from build123d import *\n${"# " + "x".repeat(80) + "\n".repeat(1)}\n`.padEnd(
      65 * 1024,
      "#",
    ) + "\nresult = Box(1,1,1)\n";
  assertThrows(() => validateGeometryScript(huge), GeometryScriptValidationError);
  const err = (() => {
    try {
      validateGeometryScript(huge);
    } catch (e) {
      return e as GeometryScriptValidationError;
    }
  })();
  assertEquals(err?.code, "script_too_large");
});
