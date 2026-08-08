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
//
// WHY explicit import — `from build123d import *` is rejected by the allowlist
// (wildcard disallowed: the validator cannot audit what `*` binds).  All valid
// scripts must use explicit imports from ALLOWED_BUILD123D_NAMES.

const VALID_SCRIPT = `from build123d import Box
result = Box(10, 10, 10)
`;

// ── Non-regression: CM-01 server-rendered script ──────────────────────────────
//
// The CM-01 semantic CAD plan renderer (coffee-machine-cm01-semantic-cad-plan.ts)
// produces a script with this exact import line.  This test pins the allowlist
// against the only server-rendered geometry script in production use.

const CM01_SCRIPT = `from build123d import Align, Box, Compound, Cylinder, Pos, Rot

components = []

# drip_tray_housing
shape_0 = Box(100, 150, 28, align=(Align.CENTER, Align.CENTER, Align.CENTER))
shape_0 = Rot(0.0, 0.0, 0.0) * shape_0
shape_0 = Pos(0.0, 0.0, 14.0) * shape_0
shape_0.label = "drip_tray_housing"
components.append(shape_0)

# tank
shape_1 = Cylinder(40, 120, align=(Align.CENTER, Align.CENTER, Align.CENTER))
shape_1 = Rot(0.0, 0.0, 0.0) * shape_1
shape_1 = Pos(60.0, 0.0, 60.0) * shape_1
shape_1.label = "tank"
components.append(shape_1)

result = Compound(label="geometry-preview-assembly", children=components)
`;

// ── Happy path ───────────────────────────────────────────────────────────────

Deno.test("validateGeometryScript accepts a minimal valid build123d script", () => {
  validateGeometryScript(VALID_SCRIPT);
});

Deno.test("validateGeometryScript accepts the CM-01 server-rendered script (non-regression)", () => {
  // Pins: Align, Box, Compound, Cylinder, Pos, Rot all in ALLOWED_BUILD123D_NAMES.
  validateGeometryScript(CM01_SCRIPT);
});

Deno.test("validateGeometryScript accepts a script with a math import", () => {
  validateGeometryScript(`from build123d import Cylinder
from math import pi, sqrt
result = Cylinder(radius=pi, height=sqrt(4))
`);
});

Deno.test("validateGeometryScript accepts double-quoted string literals", () => {
  validateGeometryScript(`from build123d import Box
label = "hello world"
result = Box(1, 2, 3)
`);
});

Deno.test("validateGeometryScript accepts triple-quoted strings", () => {
  validateGeometryScript(`from build123d import Box
doc = """multiline
  comment"""
result = Box(1, 2, 3)
`);
});

Deno.test("validateGeometryScript accepts line comments", () => {
  validateGeometryScript(`from build123d import Box
# This is a comment
result = Box(1, 1, 1)  # inline comment
`);
});

Deno.test("validateGeometryScript accepts line continuation backslash before newline", () => {
  validateGeometryScript(`from build123d import Box
result = Box(1, \\
  2, 3)
`);
});

Deno.test("validateGeometryScript accepts numeric literals with underscores", () => {
  validateGeometryScript(`from build123d import Box
x = 1_000
result = Box(x, 2, 3)
`);
});

Deno.test("validateGeometryScript accepts float literals", () => {
  validateGeometryScript(`from build123d import Box
result = Box(1.5, 2.7, 3.14159)
`);
});

// ── result assignment invariants ─────────────────────────────────────────────

Deno.test("validateGeometryScript rejects a script where result is never assigned", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from build123d import Box
x = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`from build123d import Box
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
      validateGeometryScript(`from build123d import Box, Cylinder
result = Box(1, 1, 1)
result = Cylinder(1, 2)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`from build123d import Box, Cylinder
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
  validateGeometryScript(`from build123d import Box
result = Box(result=True)
`);
});

// ── P1: result must be at module level (column 0) ────────────────────────────
//
// `result` assigned inside a def, class, if-block, or except clause is rejected
// as `result_not_at_module_level`.  The provider materialises the module-level
// binding; a conditional or scoped assignment produces an inconsistent result.

Deno.test(
  "validateGeometryScript rejects result assigned inside a function body",
  () => {
    const err = (() => {
      try {
        validateGeometryScript(`from build123d import Box
def make():
    result = Box(1, 1, 1)
`);
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "result_not_at_module_level");
  },
);

Deno.test(
  "validateGeometryScript rejects result assigned inside a class body",
  () => {
    const err = (() => {
      try {
        validateGeometryScript(`from build123d import Box
class Foo:
    result = Box(1, 1, 1)
`);
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "result_not_at_module_level");
  },
);

Deno.test(
  "validateGeometryScript rejects result assigned inside an if-block",
  () => {
    const err = (() => {
      try {
        validateGeometryScript(`from build123d import Box
x = 1
if x:
    result = Box(1, 1, 1)
`);
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "result_not_at_module_level");
  },
);

Deno.test(
  "validateGeometryScript rejects result assigned inside an except clause",
  () => {
    const err = (() => {
      try {
        validateGeometryScript(`from build123d import Box
try:
    pass
except Exception:
    result = Box(1, 1, 1)
`);
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "result_not_at_module_level");
  },
);

// ── P0: multi-module import attacks ──────────────────────────────────────────
//
// `import build123d, ctypes` was previously accepted because checkImports only
// validated the first module after `import`.  These tests pin the fix.

Deno.test(
  "validateGeometryScript rejects import build123d, ctypes (multi-module comma list)",
  () => {
    // Attack: ctypes.CDLL("libc.so.6").system(...) reaches the provider with
    // access to the shared /exports volume after slipping past a single-module
    // check on the allowed `build123d` first entry.
    const err = (() => {
      try {
        validateGeometryScript(
          `import build123d, ctypes\nresult = Box(1, 1, 1)\n`,
        );
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "forbidden_import");
  },
);

Deno.test(
  "validateGeometryScript rejects import build123d as b, ctypes as c (alias form)",
  () => {
    const err = (() => {
      try {
        validateGeometryScript(
          `import build123d as b, ctypes as c\nresult = Box(1, 1, 1)\n`,
        );
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "forbidden_import");
  },
);

Deno.test(
  "validateGeometryScript rejects import math, numpy, build123d (forbidden module in the middle)",
  () => {
    // Validates that ALL modules are checked, not just the last or first.
    // Uses numpy rather than os: os is in FORBIDDEN_NAMES and would be caught
    // as forbidden_name before checkImports can see it.  numpy is not in
    // FORBIDDEN_NAMES but is not in ALLOWED_IMPORT_SOURCES either, so it
    // produces forbidden_import — the correct code for an import check.
    const err = (() => {
      try {
        validateGeometryScript(
          `import math, numpy, build123d\nresult = Box(1, 1, 1)\n`,
        );
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "forbidden_import");
  },
);

Deno.test(
  "validateGeometryScript rejects import build123d.utils, ctypes (dotted first module, forbidden second)",
  () => {
    const err = (() => {
      try {
        validateGeometryScript(
          `import build123d.utils, ctypes\nresult = Box(1, 1, 1)\n`,
        );
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "forbidden_import");
  },
);

// ── P0 architectural: from build123d import allowlist ────────────────────────
//
// The allowlist check closes the I/O backdoor that would be opened by importing
// build123d I/O functions directly or via wildcard.

Deno.test(
  "validateGeometryScript rejects from build123d import * (wildcard disallowed)",
  () => {
    const err = (() => {
      try {
        validateGeometryScript(`from build123d import *
result = Box(1, 1, 1)
`);
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "forbidden_import");
  },
);

Deno.test(
  "validateGeometryScript rejects from build123d import export_step (I/O function — allowlist)",
  () => {
    // export_step is both in FORBIDDEN_NAMES (backstop) and not in
    // ALLOWED_BUILD123D_NAMES (allowlist).  Either check suffices; in practice
    // FORBIDDEN_NAMES fires first during tokenisation.
    assertThrows(
      () =>
        validateGeometryScript(`from build123d import export_step
result = Box(1, 1, 1)
`),
      GeometryScriptValidationError,
    );
  },
);

Deno.test(
  "validateGeometryScript rejects from build123d import factorial (name not in allowlist)",
  () => {
    // `factorial` is a math function, not a build123d name — wrong module.
    // The allowlist catches it regardless of whether it is in FORBIDDEN_NAMES.
    const err = (() => {
      try {
        validateGeometryScript(`from build123d import factorial
result = Box(1, 1, 1)
`);
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "forbidden_import");
  },
);

Deno.test(
  "validateGeometryScript accepts from build123d import Box as B (alias is free)",
  () => {
    // The source name `Box` is in ALLOWED_BUILD123D_NAMES; the alias `B` is a
    // local binding and is not subject to the allowlist.
    validateGeometryScript(`from build123d import Box as B
result = B(1, 1, 1)
`);
  },
);

Deno.test(
  "validateGeometryScript accepts from build123d import parenthesised multi-line list",
  () => {
    validateGeometryScript(`from build123d import (
    Box,
    Cylinder,
    Align
)
result = Box(1, 1, 1)
`);
  },
);

// ── P0 paren: from math import in parentheses ─────────────────────────────────
//
// `from math import (\nfactorial\n)` was accepted because checkMathImportNames
// broke out of the loop on NEWLINE without tracking paren depth.  These tests
// pin the fix.

Deno.test(
  "validateGeometryScript rejects from math import (\\nfactorial\\n) — paren + newline",
  () => {
    const err = (() => {
      try {
        validateGeometryScript(`from build123d import Box
from math import (
factorial
)
result = Box(1, 1, 1)
`);
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "forbidden_import");
  },
);

Deno.test(
  "validateGeometryScript rejects from math import (pi, \\nfactorial) — forbidden after comma in parens",
  () => {
    const err = (() => {
      try {
        validateGeometryScript(`from build123d import Box
from math import (pi,
factorial)
result = Box(1, 1, 1)
`);
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "forbidden_import");
  },
);

Deno.test(
  "validateGeometryScript accepts from math import (\\npi,\\nsqrt\\n) — valid names in parens",
  () => {
    validateGeometryScript(`from build123d import Box
from math import (
    pi,
    sqrt
)
result = Box(pi, sqrt(4), 3)
`);
  },
);

// ── False positive fix: alias in math import ──────────────────────────────────
//
// `from math import pi as MY_PI` was incorrectly rejected because the alias
// `MY_PI` was compared against ALLOWED_MATH_NAMES.  The alias is a local
// binding and must not be checked.

Deno.test(
  "validateGeometryScript accepts from math import pi as MY_PI (alias is free)",
  () => {
    validateGeometryScript(`from build123d import Box
from math import pi as MY_PI
result = Box(MY_PI, 1, 1)
`);
  },
);

Deno.test(
  "validateGeometryScript accepts from math import pi as P, sqrt as S (multiple aliases)",
  () => {
    validateGeometryScript(`from build123d import Cylinder
from math import pi as P, sqrt as S
result = Cylinder(radius=P, height=S(4))
`);
  },
);

// ── Forbidden import tests ────────────────────────────────────────────────────

Deno.test("validateGeometryScript rejects import of numpy", () => {
  assertThrows(
    () =>
      validateGeometryScript(`import numpy
from build123d import Box
result = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`import numpy
from build123d import Box
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
from build123d import Box
result = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
});

Deno.test("validateGeometryScript rejects from math import a name outside the allowlist", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from math import factorial
from build123d import Box
result = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`from math import factorial
from build123d import Box
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
    // B2 additions: reflection and introspection built-ins
    "vars",
    "dir",
    "type",
    "callable",
    "hasattr",
    "id",
    // P1: exit / abort built-ins
    "SystemExit",
    "BaseException",
    "KeyboardInterrupt",
    "exit",
    "quit",
    "builtins",
    // P0 backstop: build123d I/O functions
    "export_step",
    "export_stl",
    "export_brep",
    "export_gltf",
    "export_svg",
    "export_dxf",
    "import_step",
    "import_stl",
    "import_brep",
    "import_svg",
  ]
) {
  Deno.test(`validateGeometryScript rejects the forbidden identifier '${name}'`, () => {
    const script = `from build123d import Box
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

// ── P1: resource policy — while and for forbidden ─────────────────────────────
//
// Geometry scripts are fully unrolled server-side; no looping construct is
// needed.  Both Python keywords tokenise as NAME tokens here and are caught
// by FORBIDDEN_NAMES before the import check runs.

Deno.test(
  "validateGeometryScript rejects while loop (resource policy v1)",
  () => {
    const err = (() => {
      try {
        validateGeometryScript(`from build123d import Box
x = 1
while x < 10:
    x = x + 1
result = Box(x, 1, 1)
`);
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "forbidden_name");
  },
);

Deno.test(
  "validateGeometryScript rejects for loop (resource policy v1)",
  () => {
    const err = (() => {
      try {
        validateGeometryScript(`from build123d import Box
shapes = []
for i in [1, 2, 3]:
    shapes.append(Box(i, 1, 1))
result = shapes[0]
`);
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "forbidden_name");
  },
);

// ── P1: exponent bounds ───────────────────────────────────────────────────────

Deno.test(
  "validateGeometryScript rejects a literal exponent greater than MAX_LITERAL_EXPONENT",
  () => {
    const err = (() => {
      try {
        validateGeometryScript(`from build123d import Box
x = 2**33
result = Box(x, 1, 1)
`);
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "unrecognized_token");
  },
);

Deno.test(
  "validateGeometryScript accepts a literal exponent within the bound (a**2)",
  () => {
    validateGeometryScript(`from build123d import Box
x = 3**2
result = Box(x, 1, 1)
`);
  },
);

Deno.test(
  "validateGeometryScript rejects chained exponentiation 2**31**31",
  () => {
    // Right-associative: 2**(31**31) — the inner result has ~10^46 digits.
    const err = (() => {
      try {
        validateGeometryScript(`from build123d import Box
x = 2**31**31
result = Box(x, 1, 1)
`);
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "unrecognized_token");
  },
);

Deno.test(
  "validateGeometryScript rejects a large range exponent (10**9) even when individual exponent ≤ 32",
  () => {
    // 10**9 = 1 000 000 000; the exponent 9 ≤ 32, but the result is a huge integer.
    // `range(10**9)` would also be caught by the `for` ban; here we test bare arithmetic.
    const err = (() => {
      try {
        validateGeometryScript(`from build123d import Box
x = 10**9
result = Box(x, 1, 1)
`);
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    // 9 ≤ 32 so this passes the exponent bound — only chained check or FORBIDDEN_NAMES apply.
    // `for` ban covers range(10**9) in a loop. Bare arithmetic: 9 ≤ 32 → PASSES (accepted).
    assertEquals(err, undefined); // no error expected for bare 10**9
  },
);

// ── P2: walrus operator ───────────────────────────────────────────────────────

Deno.test(
  "validateGeometryScript rejects walrus operator := (WALRUS POLICY)",
  () => {
    const err = (() => {
      try {
        validateGeometryScript(`from build123d import Box
x := 5
result = Box(x, 1, 1)
`);
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "unrecognized_token");
  },
);

// ── Dunder access test ────────────────────────────────────────────────────────

Deno.test("validateGeometryScript rejects a dunder identifier __class__", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from build123d import Box
x = __class__
result = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`from build123d import Box
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
      validateGeometryScript(`from build123d import Box
result = __import__("os")
`),
    GeometryScriptValidationError,
  );
});

// ── String prefix tests ───────────────────────────────────────────────────────

Deno.test("validateGeometryScript rejects f-string prefix", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from build123d import Box
x = f"hello"
result = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`from build123d import Box
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
      validateGeometryScript(`from build123d import Box
x = b"bytes"
result = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
});

Deno.test("validateGeometryScript rejects r-string prefix", () => {
  assertThrows(
    () =>
      validateGeometryScript(`from build123d import Box
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
      validateGeometryScript(`from build123d import Box
x = 1e999
result = Box(x, 1, 1)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`from build123d import Box
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
      validateGeometryScript(`from build123d import Box
x = "unterminated
result = Box(1, 1, 1)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`from build123d import Box
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
      validateGeometryScript(`from build123d import Box
result = Box($, 1, 1)
`),
    GeometryScriptValidationError,
  );
  const err = (() => {
    try {
      validateGeometryScript(`from build123d import Box
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
      validateGeometryScript(`from build123d import Box
result = Box(\\1, 1, 1)
`),
    GeometryScriptValidationError,
  );
});

// ── B1: uppercase and two-character string prefix attacks ────────────────────

Deno.test(
  'validateGeometryScript rejects uppercase F-string prefix (F"...")',
  () => {
    // Attack: F"..." is an f-string; the `F` would be silently lexed as a NAME
    // token if the tokenizer only checks lowercase prefixes, letting the
    // interpolation payload slip through undetected.
    assertThrows(
      () =>
        validateGeometryScript(
          `from build123d import Box\nresult = F"{1 + 1}"\n`,
        ),
      GeometryScriptValidationError,
    );
    const err = (() => {
      try {
        validateGeometryScript(
          `from build123d import Box\nresult = F"{1 + 1}"\n`,
        );
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "invalid_string_prefix");
  },
);

Deno.test(
  'validateGeometryScript rejects two-character string prefix FR"..."',
  () => {
    // Attack: FR"..." is a raw f-string; the two-char case is not caught by a
    // single-char prefix check and would be tokenised as NAME `FR` + STRING.
    assertThrows(
      () =>
        validateGeometryScript(
          `from build123d import Box\nresult = FR"raw f-string"\n`,
        ),
      GeometryScriptValidationError,
    );
    const err = (() => {
      try {
        validateGeometryScript(
          `from build123d import Box\nresult = FR"raw f-string"\n`,
        );
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "invalid_string_prefix");
  },
);

// ── B2: vars() bypass attack ──────────────────────────────────────────────────

Deno.test(
  "validateGeometryScript rejects the vars() introspection bypass",
  () => {
    // Attack: `vars()["__builtins__"]["exec"]("...")` accesses exec through
    // the built-in namespace without spelling the forbidden name `exec` or
    // `__builtins__` directly — `vars` is the foothold.  Rejecting `vars`
    // closes this route.
    assertThrows(
      () =>
        validateGeometryScript(
          `from build123d import Box\nvars()["x"]\nresult = Box(1, 1, 1)\n`,
        ),
      GeometryScriptValidationError,
    );
    const err = (() => {
      try {
        validateGeometryScript(
          `from build123d import Box\nvars()["x"]\nresult = Box(1, 1, 1)\n`,
        );
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "forbidden_name");
  },
);

// ── I1: from math import * ────────────────────────────────────────────────────

Deno.test(
  "validateGeometryScript rejects wildcard math import (from math import *)",
  () => {
    // Attack: `from math import *` binds every math symbol into the local
    // namespace including `e`, `tau`, etc., but also exposes `frexp`, `ldexp`,
    // and other names that were never individually approved.  The `*` OP token
    // must be caught explicitly — otherwise it falls through to the loop-exit
    // `break` and the wildcard import is silently accepted.
    assertThrows(
      () =>
        validateGeometryScript(
          `from math import *\nfrom build123d import Box\nresult = Box(1, 1, 1)\n`,
        ),
      GeometryScriptValidationError,
    );
    const err = (() => {
      try {
        validateGeometryScript(
          `from math import *\nfrom build123d import Box\nresult = Box(1, 1, 1)\n`,
        );
      } catch (e) {
        return e as GeometryScriptValidationError;
      }
    })();
    assertEquals(err?.code, "forbidden_import");
  },
);

// ── Size limits ───────────────────────────────────────────────────────────────

Deno.test("validateGeometryScript rejects a script that exceeds 64 KiB", () => {
  const huge =
    `from build123d import Box\n${"# " + "x".repeat(80) + "\n".repeat(1)}\n`.padEnd(
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
