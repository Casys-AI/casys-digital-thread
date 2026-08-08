/**
 * Fail-closed AST-level Python script validator for geometry proposals (D4).
 *
 * WHY THIS MODULE EXISTS — before the server dispatches any script to the
 * build123d provider, the script must be statically verified to exclude the
 * surface area that could violate Invariant 6 (server-owned execution sequences)
 * or introduce non-determinism.  A regex allowlist would be too permissive;
 * full CPython parsing is overkill for the narrow subset we accept.
 *
 * STRATEGY — fail-closed tokenizer.  The tokenizer walks UTF-8 source
 * character by character and emits a minimal token stream.  Any byte sequence
 * that cannot be identified as one of the recognized token kinds is an
 * immediate rejection.  No backtracking, no partial acceptance.
 *
 * DESIGN RULE — every code path through the checkers must either (a) explicitly
 * accept the construct, (b) explicitly reject it, or (c) keep iterating.
 * Bare `break` / `return` on an unrecognised token is treated as a REJECT.
 * "I didn't recognise this, so I'll pass" is never correct in a fail-closed
 * validator.
 *
 * WHAT IS ACCEPTED:
 *  • imports:
 *      `from build123d import Name [as alias] [, Name2 [as alias2] …]`
 *        — every imported name must appear in ALLOWED_BUILD123D_NAMES.
 *        — wildcard `from build123d import *` is rejected (un-auditable).
 *      `from math import {approved names}` (same alias rule)
 *      `import build123d [as alias] [, math [as alias], …]`
 *        — the standalone `import` form is only allowed for the top-level
 *          packages; individual names must come through `from … import`.
 *  • name references: any [a-zA-Z_][a-zA-Z0-9_]* identifier NOT in the
 *    forbidden list and NOT matching the dunder pattern __foo__
 *  • number literals: decimal integers and floats whose parsed value is finite
 *    (inf/nan literals are rejected; 1e999 overflows to Infinity and is
 *    rejected)
 *  • string literals (single / double / triple-quoted, ASCII + UTF-8 content)
 *  • operators and punctuation from ALLOWED_OPS
 *  • line comments `# …`
 *  • whitespace (space, tab) and newlines (CR, LF, CRLF)
 *  • line continuations `\` at end of line
 *
 * WHAT IS ALWAYS REJECTED regardless of placement:
 *  • dunder references: __foo__
 *  • forbidden built-in and module names (see FORBIDDEN_NAMES below)
 *  • `result` assigned anywhere other than module level (column 0)
 *  • `result` never assigned
 *  • `result` assigned more than once at module level
 *  • raw/bytes/f-string prefixes (rb, br, b, f, rf, fr literals, case-insensitive)
 *  • walrus operator `:=`
 *  • `while` and `for` loops (v1 resource policy — geometry scripts unroll all
 *    iteration server-side; see RESOURCE POLICY below)
 *  • any literal exponent > MAX_LITERAL_EXPONENT in `a**b` expressions
 *  • chained exponentiation `a**b**c` (right-associative; inner result is
 *    unbounded even when the literals individually satisfy the exponent bound)
 *  • wildcard imports `from X import *` for any source
 *  • `from build123d import N` when N is not in ALLOWED_BUILD123D_NAMES
 *  • any byte sequence not matched by the tokenizer
 *
 * RESOURCE POLICY (v1)
 *  • `while` — forbidden entirely.  No geometry script needs an open-ended loop.
 *    The server-side renderers (CM-01, sensitivity, printability) unroll all
 *    iteration before dispatch; the agent never authors the loop.
 *  • `for` — forbidden entirely in v1.  A future v2 may allow `for x in
 *    [literal-list]` and `for i in range(N)` with N ≤ MAX_FOR_RANGE_BOUND, but
 *    implementing that check at token level without a real AST is complex and
 *    out-of-scope here.  Currently no server-rendered script uses `for`.
 *  • exponents — literal exponent bound of MAX_LITERAL_EXPONENT = 32, plus
 *    explicit rejection of chained `**`.  This prevents arithmetic bombs like
 *    `2**31**31` (right-associative evaluation produces a number with ~10^46
 *    digits before the outer exponentiation).
 *  Container-level quotas (mem_limit, cpus, pids_limit in docker-compose.yml)
 *  are recommended but out of scope for this module.  Suggested values:
 *    mem_limit: 512m, cpus: 1.0, pids_limit: 64
 *  Those limits are the deployment operator's decision and not enforced here.
 *
 * WALRUS POLICY (v2)
 *  The walrus operator `:=` is rejected in v1.  Python tokenises it as a single
 *  two-character token; our lexer would otherwise split it as `:` then `=`,
 *  both valid operators individually.  We intercept `:=` explicitly before the
 *  single-char check.  A future review may admit walrus in comprehensions once
 *  comprehension scope rules are also validated.
 *
 * SANDBOX CAVEAT — this validator is a guard, not a sandbox.  The container
 * that executes build123d remains the isolation boundary.  Deployment is
 * local single-operator; the validator raises the bar for accidental or
 * obvious misuse without pretending to be a security perimeter.
 */

export type GeometryScriptValidationErrorCode =
  | "forbidden_import"
  | "forbidden_name"
  | "dunder_access"
  | "result_not_assigned"
  | "result_multiple_assignments"
  | "result_not_at_module_level"
  | "non_finite_number"
  | "unrecognized_token"
  | "script_too_large"
  | "too_many_nodes"
  | "unterminated_string"
  | "invalid_string_prefix";

export class GeometryScriptValidationError extends Error {
  constructor(
    readonly code: GeometryScriptValidationErrorCode,
    message: string,
    readonly line?: number,
  ) {
    super(message);
    this.name = "GeometryScriptValidationError";
  }
}

/** Absolute hard limits; any script exceeding them is rejected without detail. */
const MAX_SCRIPT_BYTES = 64 * 1024; // 64 KiB
const MAX_TOKENS = 8_000;

/**
 * Maximum allowed literal exponent in `a**b` expressions.
 *
 * WHY 32 — allows `x**2` (squaring), `x**3` (cubing), and up to `2**32` for
 * bit-manipulation constants while blocking the arithmetic-bomb pattern
 * `2**1000000`.  Together with the chained-exponentiation check, this prevents
 * `2**31**31` even though 31 ≤ 32: the chained check fires first.
 */
const MAX_LITERAL_EXPONENT = 32;

// ── String prefix helpers (B1) ────────────────────────────────────────────────
//
// WHY SEPARATE HELPERS — Python allows string prefixes in any case combination
// (r, R, b, B, f, F, u, U, rb, rB, Rb, RB, br, bR, Br, BR, rf, rF, Rf, RF,
// fr, fR, Fr, FR).  The tokenizer must intercept ALL of them before the NAME
// detection path absorbs uppercase letters like `F`, `R`, `B`, `U` silently.
// Top-level pure functions cost nothing and keep the inner switch readable.

/** True for the first character of ANY valid Python single-char string prefix. */
function isStringPrefix1Char(c: string): boolean {
  return (
    c === "r" || c === "R" ||
    c === "b" || c === "B" ||
    c === "f" || c === "F" ||
    c === "u" || c === "U"
  );
}

/**
 * True for a character that can appear as either the first or second character
 * of a valid Python two-character string prefix.
 * Python two-char prefixes: rb, rB, Rb, RB, br, bR, Br, BR, rf, rF, Rf, RF,
 * fr, fR, Fr, FR.  `u` has no two-char form.
 */
function isStringPrefix2Char(c: string): boolean {
  return (
    c === "r" || c === "R" ||
    c === "b" || c === "B" ||
    c === "f" || c === "F"
  );
}

/** True for a Python string delimiter character. */
function isStringQuoteChar(c: string): boolean {
  return c === '"' || c === "'";
}

/**
 * Identifiers that are never allowed, regardless of import status.
 *
 * Three families:
 *
 * 1. Dangerous built-ins and module names — established D4 list.
 * 2. Reflection / introspection paths — allow bypassing the name allowlist at
 *    runtime (`vars()["__builtins__"]`, `dir(obj)`, `type(x)`).
 * 3. Exit / abort names — `raise SystemExit(0)` terminates the container
 *    process silently before any artefact is written or attested.
 * 4. I/O backdoor functions from build123d — backstop for `export_step(...)`,
 *    `result.export_stl(...)`, `build123d.import_step(...)`, etc.  These are
 *    legitimate build123d functions but must never appear in an agent-authored
 *    script; the provider itself handles all file I/O under server-fixed paths.
 * 5. Resource-bounding keywords — `while` and `for` are Python keywords but
 *    tokenise as NAME tokens here.  Rejecting them closes the loop-DoS surface.
 */
const FORBIDDEN_NAMES = new Set([
  // ── 1. Dangerous built-ins and modules ───────────────────────────────────
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
  "__import__",
  // ── 2. Reflection and introspection ──────────────────────────────────────
  "vars",
  "dir",
  "type",
  "callable",
  "hasattr",
  "breakpoint",
  "id",
  // ── 3. Exit / abort ───────────────────────────────────────────────────────
  // `raise SystemExit(0)` would terminate the build123d container silently
  // before the export artefact is written, making the run appear as a timeout
  // rather than a failed validation.
  "SystemExit",
  "BaseException",
  "KeyboardInterrupt",
  "exit",
  "quit",
  "builtins",
  // ── 4. I/O backdoor functions from build123d ─────────────────────────────
  // These are real build123d public API names.  A script that imports * or
  // imports them explicitly gains read/write access to the shared /exports
  // volume.  Reject by name everywhere: covers `export_step(result, "/exports/x")`
  // as well as `result.export_step("/exports/x")` and
  // `build123d.export_step(...)`.
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
  // ── 5. Resource keywords (v1 resource policy) ─────────────────────────────
  // Looping constructs are not needed in server-rendered geometry scripts.
  // Both Python keywords tokenise as NAME tokens in this tokenizer.
  "while",
  "for",
]);

/** Only these top-level import sources are allowed. */
const ALLOWED_IMPORT_SOURCES = new Set(["build123d", "math"]);

/**
 * `from math import` only permits this subset.
 *
 * DESIGN — this list IS the math vocabulary for v1.  It grows by review, never
 * by passthrough.  A name absent from this list is rejected with a message that
 * includes the list so that the proposing agent can correct the import.
 */
const ALLOWED_MATH_NAMES = new Set([
  "pi",
  "e",
  "tau",
  "inf",
  "nan",
  "sqrt",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "log",
  "log10",
  "exp",
  "pow",
  "ceil",
  "floor",
  "fabs",
  "isfinite",
  "isinf",
  "isnan",
  "degrees",
  "radians",
]);

/**
 * `from build123d import` only permits names in this set.
 *
 * WHY AN ALLOWLIST — `from build123d import export_step` gives write access to
 * the shared /exports volume.  The FORBIDDEN_NAMES backstop catches the known
 * I/O function names, but a wildcard import or a new build123d API name could
 * slip past.  Inverting the model (allowlist instead of denylist) closes this
 * class of bypass structurally: every unknown name is rejected regardless of
 * what build123d happens to export in the installed version.
 *
 * WHAT IS INCLUDED — geometric primitives, combinators, boolean operations,
 * transformations/placements, sketch primitives, extrusion/revolution/sweep,
 * builder contexts, location generators, enumerations, and geometric entity
 * types used for selection.  Every I/O, display, serialisation, and file-system
 * function is excluded.
 *
 * HOW TO GROW THIS LIST — add names one at a time, by explicit human review of
 * the build123d API documentation for the entry.  Check: (a) does the function
 * read or write to the filesystem or network? (b) does it execute arbitrary
 * code or spawn processes?  Only add if both answers are no.
 */
const ALLOWED_BUILD123D_NAMES = new Set([
  // ── Primitives — 3-D solids ───────────────────────────────────────────────
  "Box",
  "Cylinder",
  "Cone",
  "Sphere",
  "Torus",
  "Wedge",
  "Ellipsoid",
  // ── Combinators ───────────────────────────────────────────────────────────
  "Compound",
  "Part",
  "add",
  "subtract",
  "intersect",
  // ── Modifying operations ──────────────────────────────────────────────────
  "fillet",
  "chamfer",
  "offset",
  "shell",
  "mirror",
  "scale",
  // ── Extrusion / revolution / sweep family ─────────────────────────────────
  "extrude",
  "revolve",
  "loft",
  "sweep",
  // ── Transformations / placements ─────────────────────────────────────────
  "Pos",
  "Rot",
  "Mirror",
  "Scale",
  "Location",
  // ── Geometric references ──────────────────────────────────────────────────
  "Plane",
  "Vector",
  "Axis",
  // ── 2-D sketch primitives ─────────────────────────────────────────────────
  "Circle",
  "Ellipse",
  "Rectangle",
  "Polygon",
  "RegularPolygon",
  "Line",
  "Polyline",
  "Arc",
  "TangentArc",
  "RadiusArc",
  "Bezier",
  "PolarLine",
  "FilletPolyline",
  "Offset2D",
  // ── Builder contexts ──────────────────────────────────────────────────────
  "BuildPart",
  "BuildSketch",
  "BuildLine",
  // ── Location generators ───────────────────────────────────────────────────
  "GridLocations",
  "HexLocations",
  "PolarLocations",
  "LinearLocations",
  // ── Enumerations / constants ──────────────────────────────────────────────
  "Align",
  "Mode",
  "Kind",
  "Until",
  "GeomType",
  "Select",
  "AngularDirection",
  "PositionMode",
  "RotationMode",
  "SortBy",
  "CenterOf",
  "LengthMode",
  // ── Geometric entity types (selection / typing) ────────────────────────────
  "Solid",
  "Shell",
  "Face",
  "Edge",
  "Vertex",
  "Wire",
  "Shape",
  "ShapeList",
]);

/**
 * Punctuation and operators that are legal in build123d geometry scripts.
 * Anything else is rejected.
 *
 * NOTE — `:=` (walrus) is NOT in this list and is also not a two-char entry.
 * It is intercepted explicitly in the tokenizer before this set is consulted
 * (see WALRUS POLICY in the module header).
 */
const ALLOWED_OPS = new Set([
  "+",
  "-",
  "*",
  "/",
  "**",
  "//",
  "%",
  "=",
  "==",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "+=",
  "-=",
  "*=",
  "/=",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ",",
  ".",
  ":",
  ";",
  "@", // used for matrix multiplication in some contexts
  "~",
]);

// ── Token kinds (internal) ───────────────────────────────────────────────────

type TokenKind =
  | "NAME"
  | "NUMBER"
  | "STRING"
  | "OP"
  | "NEWLINE"
  | "COMMENT"
  | "WHITESPACE"
  | "CONTINUATION"; // backslash at end of line

interface Token {
  kind: TokenKind;
  value: string;
  line: number;
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;

  function advance(): string {
    const ch = source[pos++] ?? "";
    if (ch === "\n") line++;
    return ch;
  }

  function peek(offset = 0): string {
    return source[pos + offset] ?? "";
  }

  function currentLine(): number {
    return line;
  }

  function isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  function isNameStart(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
  }

  function isNamePart(ch: string): boolean {
    return isNameStart(ch) || isDigit(ch);
  }

  while (pos < source.length) {
    if (tokens.length > MAX_TOKENS) {
      throw new GeometryScriptValidationError(
        "too_many_nodes",
        `Script exceeds maximum token count (${MAX_TOKENS}).`,
        currentLine(),
      );
    }

    const startLine = currentLine();
    const ch = peek();

    // Whitespace (space, tab — not newline)
    if (ch === " " || ch === "\t") {
      let ws = "";
      while (peek() === " " || peek() === "\t") ws += advance();
      tokens.push({ kind: "WHITESPACE", value: ws, line: startLine });
      continue;
    }

    // Newlines (CR, LF, CRLF)
    if (ch === "\r" || ch === "\n") {
      let nl = advance();
      if (nl === "\r" && peek() === "\n") nl += advance();
      tokens.push({ kind: "NEWLINE", value: nl, line: startLine });
      continue;
    }

    // Line continuation: backslash followed by newline
    if (ch === "\\") {
      const next = peek(1);
      if (next === "\n" || next === "\r") {
        advance(); // consume backslash
        let nl = advance(); // consume \n or \r
        if (nl === "\r" && peek() === "\n") nl += advance();
        tokens.push({ kind: "CONTINUATION", value: "\\" + nl, line: startLine });
        continue;
      }
      // Otherwise backslash is not a recognized operator in our subset
      throw new GeometryScriptValidationError(
        "unrecognized_token",
        `Unrecognized character '\\' at line ${startLine}.`,
        startLine,
      );
    }

    // Comment
    if (ch === "#") {
      let comment = "";
      while (pos < source.length && peek() !== "\n" && peek() !== "\r") {
        comment += advance();
      }
      tokens.push({ kind: "COMMENT", value: comment, line: startLine });
      continue;
    }

    // String literals: detect and reject ALL illegal prefix forms (B1).
    //
    // WHY TWO CHECKS — Python string prefixes come in one- and two-character
    // forms, both case-insensitive.  The one-char check catches r/R/b/B/f/F/u/U
    // immediately before a quote.  The two-char check runs first so that `FR"`
    // is caught before `F` is silently absorbed by the NAME path.
    //
    // Without the two-char check, `FR"..."` is tokenised as NAME `FR` followed
    // by STRING `"..."` — both individually valid — which lets f-strings slip
    // through.  Without expanding to uppercase, `F"..."` falls through to NAME
    // `F` (not in FORBIDDEN_NAMES) and then STRING `"..."`.

    // Two-character prefix + quote: FR"…", rb"…", Br'…', etc.
    if (
      isStringPrefix2Char(ch) &&
      isStringPrefix2Char(peek(1)) &&
      isStringQuoteChar(peek(2))
    ) {
      const prefix = ch + peek(1);
      throw new GeometryScriptValidationError(
        "invalid_string_prefix",
        `String prefix '${prefix}' is not allowed at line ${startLine}.`,
        startLine,
      );
    }

    // Single-character prefix + quote: r"…", B"…", f'…', U"…", etc.
    // Also handles bare quotes (ch is '"' or '\'') — the prefix condition is
    // false for those so they fall through to the string consumer.
    if (
      isStringQuoteChar(ch) ||
      (isStringPrefix1Char(ch) && isStringQuoteChar(peek(1)))
    ) {
      // Any non-quote char here is a string prefix — reject it.
      if (!isStringQuoteChar(ch)) {
        throw new GeometryScriptValidationError(
          "invalid_string_prefix",
          `String prefix '${ch}' is not allowed at line ${startLine}.`,
          startLine,
        );
      }
      const strToken = consumeString(source, pos, line, startLine);
      pos = strToken.nextPos;
      line = strToken.nextLine;
      tokens.push({ kind: "STRING", value: strToken.value, line: startLine });
      continue;
    }

    // Numbers
    if (isDigit(ch) || (ch === "." && isDigit(peek(1)))) {
      let numStr = "";
      while (
        pos < source.length &&
        (isDigit(peek()) || peek() === "." || peek() === "_" ||
          peek() === "e" || peek() === "E" ||
          ((peek() === "+" || peek() === "-") &&
            (numStr.endsWith("e") || numStr.endsWith("E"))))
      ) {
        numStr += advance();
      }
      // Reject hex, octal, binary literals — only decimal allowed
      if (/^0[xXoObB]/.test(numStr)) {
        throw new GeometryScriptValidationError(
          "unrecognized_token",
          `Non-decimal integer literals are not allowed at line ${startLine}.`,
          startLine,
        );
      }
      // Reject complex number suffix j/J
      if (peek() === "j" || peek() === "J") {
        throw new GeometryScriptValidationError(
          "unrecognized_token",
          `Complex number literals are not allowed at line ${startLine}.`,
          startLine,
        );
      }
      // Check finiteness
      const numVal = parseFloat(numStr.replace(/_/g, ""));
      if (!Number.isFinite(numVal)) {
        throw new GeometryScriptValidationError(
          "non_finite_number",
          `Non-finite number literal at line ${startLine}: ${numStr}`,
          startLine,
        );
      }
      tokens.push({ kind: "NUMBER", value: numStr, line: startLine });
      continue;
    }

    // Names / identifiers / keywords
    if (isNameStart(ch)) {
      let name = "";
      while (pos < source.length && isNamePart(peek())) name += advance();

      // Reject dunder identifiers
      if (/^__[a-zA-Z_][a-zA-Z0-9_]*__$/.test(name)) {
        throw new GeometryScriptValidationError(
          "dunder_access",
          `Dunder identifier '${name}' is not allowed at line ${startLine}.`,
          startLine,
        );
      }

      // Reject forbidden names
      if (FORBIDDEN_NAMES.has(name)) {
        throw new GeometryScriptValidationError(
          "forbidden_name",
          `Forbidden identifier '${name}' at line ${startLine}.`,
          startLine,
        );
      }

      tokens.push({ kind: "NAME", value: name, line: startLine });
      continue;
    }

    // ── Walrus operator rejection (WALRUS POLICY) ─────────────────────────
    // Python's `:=` is a two-character token.  Our tokenizer would otherwise
    // split it as `:` (valid) then `=` (valid), both individually acceptable.
    // Intercept `:=` explicitly before the ALLOWED_OPS two-char check.
    if (source.slice(pos, pos + 2) === ":=") {
      throw new GeometryScriptValidationError(
        "unrecognized_token",
        `Walrus operator ':=' is not allowed at line ${startLine}.` +
          " (See WALRUS POLICY in the module header.)",
        startLine,
      );
    }

    // Operators and punctuation (two-character first, then single)
    const twoChar = source.slice(pos, pos + 2);
    if (ALLOWED_OPS.has(twoChar)) {
      pos += 2;
      tokens.push({ kind: "OP", value: twoChar, line: startLine });
      continue;
    }
    const oneChar = source[pos]!;
    if (ALLOWED_OPS.has(oneChar)) {
      pos++;
      tokens.push({ kind: "OP", value: oneChar, line: startLine });
      continue;
    }

    throw new GeometryScriptValidationError(
      "unrecognized_token",
      `Unrecognized character '${ch}' (U+${
        ch.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")
      }) at line ${startLine}.`,
      startLine,
    );
  }

  return tokens;
}

interface StringResult {
  value: string;
  nextPos: number;
  nextLine: number;
}

function consumeString(
  source: string,
  startPos: number,
  startLine: number,
  _tokenLine: number,
): StringResult {
  let pos = startPos;
  let line = startLine;

  function advance(): string {
    const ch = source[pos++] ?? "";
    if (ch === "\n") line++;
    return ch;
  }

  const q1 = advance(); // first quote char
  let content = q1;
  let triple = false;

  if (source[pos] === q1 && source[pos + 1] === q1) {
    // Triple-quoted string
    triple = true;
    content += advance() + advance();
  }

  while (pos < source.length) {
    const ch = source[pos];
    if (ch === "\\") {
      content += advance(); // backslash
      const next = advance(); // escaped char
      content += next;
      continue;
    }
    if (triple) {
      if (ch === q1 && source[pos + 1] === q1 && source[pos + 2] === q1) {
        content += advance() + advance() + advance();
        return { value: content, nextPos: pos, nextLine: line };
      }
    } else {
      if (ch === q1) {
        content += advance();
        return { value: content, nextPos: pos, nextLine: line };
      }
      if (ch === "\n" || ch === "\r") {
        throw new GeometryScriptValidationError(
          "unterminated_string",
          `Unterminated string literal at line ${_tokenLine}.`,
          _tokenLine,
        );
      }
    }
    content += advance();
  }

  throw new GeometryScriptValidationError(
    "unterminated_string",
    `Unterminated string literal at line ${_tokenLine}.`,
    _tokenLine,
  );
}

// ── Semantic checks on the token stream ─────────────────────────────────────

/**
 * Validate all module names in a standalone `import A [as a] [, B [as b], …]`
 * statement.
 *
 * WHY THIS FUNCTION EXISTS — Python allows comma-separated module lists in a
 * single `import` statement.  The original check called `nextSignificantName`
 * once and validated only the first module, so `import build123d, ctypes`
 * silently passed: `build123d` was validated, `ctypes` was never checked, and
 * the subsequent `ctypes.CDLL("libc.so.6").system(...)` call reached the
 * provider with access to the shared /exports volume.
 *
 * This function validates EVERY module in the comma-separated list.
 * Dotted sub-names (`import build123d.utils`) are handled by validating the
 * top-level segment only; `as alias` clauses are skipped.
 */
function checkStandaloneImportList(
  tokens: Token[],
  start: number,
  importLine: number,
): void {
  let i = start;
  let moduleCount = 0;

  outer: while (true) {
    // Skip leading whitespace / continuation.
    while (
      i < tokens.length &&
      (tokens[i]!.kind === "WHITESPACE" || tokens[i]!.kind === "CONTINUATION")
    ) {
      i++;
    }
    if (i >= tokens.length) break;

    const t = tokens[i]!;
    if (t.kind === "NEWLINE" || t.kind === "COMMENT") break;

    // Must be a NAME (the top-level module or package name).
    if (t.kind !== "NAME") {
      if (moduleCount === 0) {
        throw new GeometryScriptValidationError(
          "forbidden_import",
          `Bare 'import' without a module name at line ${importLine}.`,
          importLine,
        );
      }
      break;
    }

    moduleCount++;

    // Validate against the allowlist (only the first segment matters for
    // dotted names: `import build123d.X` — `build123d` is the package).
    if (!ALLOWED_IMPORT_SOURCES.has(t.value)) {
      throw new GeometryScriptValidationError(
        "forbidden_import",
        `Forbidden import of '${t.value}' at line ${importLine}. ` +
          `Only build123d and math are allowed.`,
        importLine,
      );
    }
    i++;

    // Skip dotted suffix: `.sub.module` after the top-level package name.
    while (i < tokens.length) {
      const dt = tokens[i]!;
      if (dt.kind === "WHITESPACE" || dt.kind === "CONTINUATION") {
        i++;
        continue;
      }
      if (dt.kind !== "OP" || dt.value !== ".") break;
      i++; // skip "."
      while (
        i < tokens.length &&
        (tokens[i]!.kind === "WHITESPACE" || tokens[i]!.kind === "CONTINUATION")
      ) {
        i++;
      }
      if (tokens[i]?.kind === "NAME") i++; // skip sub-name
    }

    // Skip optional `as alias`.
    while (
      i < tokens.length &&
      (tokens[i]!.kind === "WHITESPACE" || tokens[i]!.kind === "CONTINUATION")
    ) {
      i++;
    }
    if (i < tokens.length && tokens[i]?.kind === "NAME" && tokens[i]!.value === "as") {
      i++; // skip "as"
      while (
        i < tokens.length &&
        (tokens[i]!.kind === "WHITESPACE" || tokens[i]!.kind === "CONTINUATION")
      ) {
        i++;
      }
      if (i < tokens.length && tokens[i]?.kind === "NAME") i++; // skip alias
    }

    // Look for a comma (more modules) or end of statement.
    while (
      i < tokens.length &&
      (tokens[i]!.kind === "WHITESPACE" || tokens[i]!.kind === "CONTINUATION")
    ) {
      i++;
    }
    if (i >= tokens.length) break outer;
    const sep = tokens[i]!;
    if (sep.kind === "NEWLINE" || sep.kind === "COMMENT") break outer;
    if (sep.kind === "OP" && sep.value === ",") {
      i++; // consume comma; loop to read next module
      continue;
    }
    break; // any other token — end of import statement
  }

  if (moduleCount === 0) {
    throw new GeometryScriptValidationError(
      "forbidden_import",
      `Bare 'import' without a module name at line ${importLine}.`,
      importLine,
    );
  }
}

/**
 * Validate the name list in `from build123d import N1 [as a1] [, N2 [as a2]…]`.
 *
 * WHY AN EXPLICIT CHECKER — `from build123d import export_step` grants write
 * access to /exports without any obviously forbidden name in the script body.
 * Inverting the check to an allowlist ensures unknown names are rejected even
 * if FORBIDDEN_NAMES is incomplete.
 *
 * ALIAS RULE — the SOURCE name (`Box`) must be in ALLOWED_BUILD123D_NAMES; the
 * alias (`B`) is a local binding chosen by the script author and is not checked
 * against the allowlist.
 *
 * PAREN RULE — `from build123d import (\n    Box,\n    Cylinder\n)` is legal
 * Python; parentheses span multiple lines.  Depth tracking handles this.
 *
 * FAIL-CLOSED — any token that is not whitespace, comma, open/close paren,
 * a valid name, `as`, or an alias is a REJECT, not a silent pass.
 */
function checkBuild123dImportNames(
  tokens: Token[],
  start: number,
  importLine: number,
): void {
  // Skip to the `import` keyword following the module name.
  let i = start;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.kind === "WHITESPACE" || t.kind === "CONTINUATION") {
      i++;
      continue;
    }
    if (t.kind === "NAME" && t.value === "import") {
      i++;
      break;
    }
    return; // No `import` keyword — handled upstream.
  }

  let parenDepth = 0;
  let expectingAlias = false; // true immediately after consuming `as`

  while (i < tokens.length) {
    const t = tokens[i++]!;
    if (t.kind === "WHITESPACE" || t.kind === "CONTINUATION") continue;
    if (t.kind === "NEWLINE") {
      if (parenDepth === 0) break; // single-line import ended
      continue; // inside parens — multi-line continuation
    }
    if (t.kind === "COMMENT") break;
    if (t.kind === "OP" && t.value === "(") {
      parenDepth++;
      continue;
    }
    if (t.kind === "OP" && t.value === ")") {
      if (parenDepth > 0) parenDepth--;
      if (parenDepth === 0) break; // closing paren ends the import list
      continue;
    }
    if (t.kind === "OP" && t.value === ",") {
      expectingAlias = false;
      continue;
    }
    if (t.kind === "OP" && t.value === "*") {
      throw new GeometryScriptValidationError(
        "forbidden_import",
        `Wildcard 'from build123d import *' is not allowed at line ${importLine}. ` +
          `Import only the names you need from ALLOWED_BUILD123D_NAMES.`,
        importLine,
      );
    }
    if (t.kind === "NAME") {
      if (expectingAlias) {
        // This is the alias token — accept any valid identifier.
        expectingAlias = false;
        continue;
      }
      if (t.value === "as") {
        expectingAlias = true;
        continue;
      }
      // Source name — must be in the allowlist.
      if (!ALLOWED_BUILD123D_NAMES.has(t.value)) {
        throw new GeometryScriptValidationError(
          "forbidden_import",
          `'${t.value}' is not in the allowed build123d import set at line ${importLine}. ` +
            `Allowed: ${[...ALLOWED_BUILD123D_NAMES].sort().join(", ")}`,
          importLine,
        );
      }
      continue;
    }
    // Any other token — REJECT (fail-closed, see DESIGN RULE in module header).
    throw new GeometryScriptValidationError(
      "forbidden_import",
      `Unexpected token '${t.value}' in 'from build123d import' at line ${importLine}.`,
      importLine,
    );
  }
}

/**
 * Scan the token stream for import statements.
 *
 * Accepted forms:
 *   import build123d
 *   import build123d, math           (comma list — each module validated)
 *   import build123d as b            (alias — module still validated)
 *   from build123d import Foo, Bar   (each name checked against allowlist)
 *   from math import pi, sqrt        (each name checked against allowlist)
 *
 * Everything else is rejected as a forbidden import.
 *
 * WHY WE PRE-MARK from-import INDICES — `from build123d import *` tokenizes the
 * `import` keyword as a plain NAME token.  Without pre-marking, the main loop
 * would see that `import` token and enter the standalone-import branch, fail to
 * find a NAME after `*`, and throw "bare import".  We collect these indices in a
 * first pass so the second pass can skip them.
 */
function checkImports(tokens: Token[]): void {
  // Pass 1: collect the index of each `import` token that belongs to a
  // `from X import ...` form.
  const fromImportTokenIndices = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.kind !== "NAME" || tok.value !== "from") continue;
    // Module name must immediately follow (modulo whitespace).
    const modTok = nextSignificantName(tokens, i + 1);
    if (!modTok) continue;
    // `import` keyword must follow the module name.
    for (let j = modTok.index + 1; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (t.kind === "WHITESPACE" || t.kind === "CONTINUATION") continue;
      if (t.kind === "NAME" && t.value === "import") {
        fromImportTokenIndices.add(j);
      }
      break;
    }
  }

  // Pass 2: enforce import rules.
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.kind !== "NAME") continue;

    if (tok.value === "import" && !fromImportTokenIndices.has(i)) {
      // Standalone `import X [as y] [, Y [as z], …]` — validate EVERY module.
      checkStandaloneImportList(tokens, i + 1, tok.line);
    }

    if (tok.value === "from") {
      const modTok = nextSignificantName(tokens, i + 1);
      if (!modTok) {
        throw new GeometryScriptValidationError(
          "forbidden_import",
          `'from' without a module name at line ${tok.line}.`,
          tok.line,
        );
      }
      if (!ALLOWED_IMPORT_SOURCES.has(modTok.value)) {
        throw new GeometryScriptValidationError(
          "forbidden_import",
          `Forbidden 'from ${modTok.value} import …' at line ${tok.line}.`,
          tok.line,
        );
      }
      if (modTok.value === "math") {
        checkMathImportNames(tokens, modTok.index + 1, tok.line);
      }
      if (modTok.value === "build123d") {
        checkBuild123dImportNames(tokens, modTok.index + 1, tok.line);
      }
    }
  }
}

interface NameWithIndex {
  value: string;
  index: number;
}

function nextSignificantName(
  tokens: Token[],
  start: number,
): NameWithIndex | undefined {
  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === "WHITESPACE" || t.kind === "CONTINUATION") continue;
    if (t.kind === "NAME") return { value: t.value, index: i };
    return undefined;
  }
  return undefined;
}

/**
 * Validate the name list in `from math import N1 [as a1] [, N2 [as a2] …]`.
 *
 * ALIAS RULE — `from math import pi as MY_PI` is valid; the SOURCE name `pi`
 * must be in ALLOWED_MATH_NAMES; the alias `MY_PI` is a local binding and is
 * NOT checked.  Bug fixed here: the previous implementation checked the alias
 * name against the allowlist, incorrectly rejecting `pi as MY_PI`.
 *
 * PAREN RULE — `from math import (\npi,\nsqrt\n)` is legal Python; paren depth
 * tracking prevents NEWLINE inside parentheses from terminating the check early
 * (which would silently accept forbidden names that appear after the newline).
 *
 * FAIL-CLOSED — any token that is not whitespace, comma, open/close paren, a
 * valid name, or `as` is a REJECT, not a silent pass (DESIGN RULE).
 */
function checkMathImportNames(
  tokens: Token[],
  start: number,
  importLine: number,
): void {
  // Skip to the `import` keyword following the module name.
  let i = start;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.kind === "WHITESPACE" || t.kind === "CONTINUATION") {
      i++;
      continue;
    }
    if (t.kind === "NAME" && t.value === "import") {
      i++;
      break;
    }
    return; // No `import` keyword — handled upstream.
  }

  let parenDepth = 0;
  let expectingAlias = false; // true immediately after consuming `as`

  while (i < tokens.length) {
    const t = tokens[i++]!;
    if (t.kind === "WHITESPACE" || t.kind === "CONTINUATION") continue;
    if (t.kind === "NEWLINE") {
      if (parenDepth === 0) break; // single-line import ended
      continue; // inside parens — multi-line continuation
    }
    if (t.kind === "COMMENT") break;
    if (t.kind === "OP" && t.value === "(") {
      parenDepth++;
      continue;
    }
    if (t.kind === "OP" && t.value === ")") {
      if (parenDepth > 0) parenDepth--;
      if (parenDepth === 0) break; // closing paren ends the import list
      continue;
    }
    if (t.kind === "OP" && t.value === ",") {
      expectingAlias = false;
      continue;
    }
    if (t.kind === "OP" && t.value === "*") {
      throw new GeometryScriptValidationError(
        "forbidden_import",
        `Wildcard 'from math import *' is not allowed at line ${importLine}.`,
        importLine,
      );
    }
    if (t.kind === "NAME") {
      if (expectingAlias) {
        // This is the alias token — any valid identifier is acceptable.
        expectingAlias = false;
        continue;
      }
      if (t.value === "as") {
        expectingAlias = true;
        continue;
      }
      // Source name — must be in the math allowlist.
      if (!ALLOWED_MATH_NAMES.has(t.value)) {
        throw new GeometryScriptValidationError(
          "forbidden_import",
          `'${t.value}' is not in the allowed math import set at line ${importLine}.`,
          importLine,
        );
      }
      continue;
    }
    // Any other token — REJECT (fail-closed, see DESIGN RULE in module header).
    throw new GeometryScriptValidationError(
      "forbidden_import",
      `Unexpected token '${t.value}' in 'from math import' at line ${importLine}.`,
      importLine,
    );
  }
}

/**
 * Verify that `result` is assigned exactly once at module level (column 0).
 *
 * COLUMN-0 RULE — `result` must be the first significant token on its line
 * (no WHITESPACE between the preceding NEWLINE and the `result` NAME token).
 * This rejects assignments inside `def`, `class`, `if`, `except`, `with`, and
 * any other indented block — they would produce an inconsistent or conditional
 * value rather than the geometry the provider materialises.
 *
 * DOT-ACCESS EXCEPTION — `shape.result = …` is an attribute assignment, not a
 * variable assignment.  We detect this by checking for `OP(".")` immediately
 * before `result` (skipping whitespace) and skip such occurrences.
 */
function checkResultAssignment(tokens: Token[]): void {
  let depth = 0; // paren / bracket / brace depth
  let resultAssignments = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;

    if (tok.kind === "OP") {
      if (tok.value === "(" || tok.value === "[" || tok.value === "{") depth++;
      else if (tok.value === ")" || tok.value === "]" || tok.value === "}") depth--;
      continue;
    }

    if (tok.kind !== "NAME" || tok.value !== "result") continue;
    if (depth !== 0) continue; // inside an expression — not a statement-level name

    // Skip if preceded by `.` (attribute access: `obj.result = …`).
    let precIdx = i - 1;
    while (
      precIdx >= 0 &&
      (tokens[precIdx]!.kind === "WHITESPACE" ||
        tokens[precIdx]!.kind === "CONTINUATION")
    ) {
      precIdx--;
    }
    if (
      precIdx >= 0 &&
      tokens[precIdx]!.kind === "OP" &&
      tokens[precIdx]!.value === "."
    ) {
      continue;
    }

    // Check if the next significant token is `=` (assignment, not `==`).
    const next = nextSignificantToken(tokens, i + 1);
    if (next?.value !== "=") continue; // not an assignment

    // Column-0 check: the token immediately before `result` (no whitespace
    // skipping!) must be NEWLINE, CONTINUATION, or absent.  If it is
    // WHITESPACE, `result` is indented — it is inside a block, not at module
    // level.
    const immediatePrev = i > 0 ? tokens[i - 1] : undefined;
    const atModuleLevel = immediatePrev === undefined ||
      immediatePrev.kind === "NEWLINE" ||
      immediatePrev.kind === "CONTINUATION";

    if (!atModuleLevel) {
      throw new GeometryScriptValidationError(
        "result_not_at_module_level",
        `'result' must be assigned at module level (column 0) — ` +
          `assignment at line ${tok.line} is inside a block or expression context.`,
        tok.line,
      );
    }

    resultAssignments++;
    if (resultAssignments > 1) {
      throw new GeometryScriptValidationError(
        "result_multiple_assignments",
        `'result' is assigned more than once (second assignment at line ${tok.line}).`,
        tok.line,
      );
    }
  }

  if (resultAssignments === 0) {
    throw new GeometryScriptValidationError(
      "result_not_assigned",
      "'result' is never assigned in the script.",
    );
  }
}

/**
 * Reject over-large literal exponents and chained exponentiation.
 *
 * WHY — `2**1000000` is a valid Python expression but allocates astronomical
 * memory.  `2**31**31` (right-associative) evaluates `31**31 ≈ 2.86 × 10^46`
 * first, producing a number with tens of billions of digits.
 *
 * POLICY:
 *  (a) Any NUMBER literal appearing as the right operand of `**` must satisfy
 *      value ≤ MAX_LITERAL_EXPONENT (= 32).
 *  (b) Chained `**` in the form `… ** NUMBER ** …` is rejected regardless of
 *      the individual values, because right-to-left evaluation makes the inner
 *      result unbounded even when both literals are within the bound.
 */
function checkExponents(tokens: Token[]): void {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.kind !== "OP" || tok.value !== "**") continue;

    // Find the right operand (next significant token).
    let j = i + 1;
    while (
      j < tokens.length &&
      (tokens[j]!.kind === "WHITESPACE" || tokens[j]!.kind === "CONTINUATION")
    ) {
      j++;
    }
    if (j >= tokens.length) continue;

    const rightTok = tokens[j]!;
    if (rightTok.kind !== "NUMBER") continue;

    const exponent = parseFloat(rightTok.value.replace(/_/g, ""));
    if (!Number.isFinite(exponent) || exponent > MAX_LITERAL_EXPONENT) {
      throw new GeometryScriptValidationError(
        "unrecognized_token",
        `Literal exponent ${rightTok.value} exceeds the maximum allowed value of ` +
          `${MAX_LITERAL_EXPONENT} at line ${rightTok.line}. ` +
          `Use a pre-computed constant instead.`,
        rightTok.line,
      );
    }

    // Reject chained exponentiation: A**B**C evaluates as A**(B**C).
    // Even when B ≤ MAX_LITERAL_EXPONENT and C ≤ MAX_LITERAL_EXPONENT,
    // the intermediate B**C can be enormous (31**31 ≈ 2.86×10^46).
    let k = j + 1;
    while (
      k < tokens.length &&
      (tokens[k]!.kind === "WHITESPACE" || tokens[k]!.kind === "CONTINUATION")
    ) {
      k++;
    }
    if (k < tokens.length && tokens[k]!.kind === "OP" && tokens[k]!.value === "**") {
      throw new GeometryScriptValidationError(
        "unrecognized_token",
        `Chained exponentiation '**…**' is not allowed at line ${rightTok.line}. ` +
          `The right-associative evaluation produces an unbounded intermediate. ` +
          `Use explicit parentheses with a pre-computed value if needed.`,
        rightTok.line,
      );
    }
  }
}

function nextSignificantToken(
  tokens: Token[],
  start: number,
): Token | undefined {
  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === "WHITESPACE" || t.kind === "CONTINUATION" || t.kind === "COMMENT") {
      continue;
    }
    return t;
  }
  return undefined;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate a Python script against the D4 allowlist.
 *
 * Throws `GeometryScriptValidationError` on any violation.
 * Returns normally if the script passes all checks.
 *
 * IMPORTANT: this function is pure and has zero I/O.  The caller is
 * responsible for invoking it before any provider dispatch.
 */
export function validateGeometryScript(script: string): void {
  if (script.length > MAX_SCRIPT_BYTES) {
    throw new GeometryScriptValidationError(
      "script_too_large",
      `Script exceeds maximum size of ${MAX_SCRIPT_BYTES} bytes (got ${script.length}).`,
    );
  }

  const tokens = tokenize(script);
  checkImports(tokens);
  checkExponents(tokens);
  checkResultAssignment(tokens);
}
