/**
 * Fail-closed lexical and partial-syntax Python script validator for geometry
 * proposals (D4).
 *
 * WHY THIS MODULE EXISTS — before the server dispatches any script to the
 * build123d provider, the script must be statically verified to exclude the
 * surface area that could violate Invariant 6 (server-owned execution sequences)
 * or introduce non-determinism.  A regex allowlist would be too permissive;
 * full CPython parsing is overkill for the narrow subset we accept.
 *
 * STRATEGY — fail-closed tokenizer.  The tokenizer walks source text character
 * by character and emits a minimal token stream.  Any source sequence
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
 *  • imports (the only accepted form):
 *      `from build123d import Name [as alias] [, Name2 [as alias2] …]`
 *        — every imported name must appear in ALLOWED_BUILD123D_NAMES.
 *        — wildcard `from build123d import *` is rejected (un-auditable).
 *      `from math import {approved names}` (same alias rule)
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
 *  • forbidden built-in and module names in normal identifier position (see
 *    FORBIDDEN_NAMES below)
 *  • known write/serialization methods in attribute position (see
 *    FORBIDDEN_ATTRIBUTES below)
 *  • `result` assigned anywhere other than the start of a module-level logical
 *    line (column 0, delimiter depth zero)
 *  • `result` never assigned
 *  • `result` assigned more than once at module level
 *  • raw/bytes/f-string prefixes (rb, br, b, f, rf, fr literals, case-insensitive)
 *  • walrus operator `:=`
 *  • wildcard imports `from X import *` for any source
 *  • every standalone `import X` form, including dotted module names
 *  • `from build123d import N` when N is not in ALLOWED_BUILD123D_NAMES
 *  • any byte sequence not matched by the tokenizer
 *
 * LAYER BOUNDARY — WHAT THIS VALIDATOR DOES AND DOES NOT DO
 *
 *  This validator bounds what a script can REACH: imports, filesystem, I/O,
 *  arbitrary code execution.  These are semantic properties expressible as
 *  name and import constraints — a boundary the container cannot express.
 *
 *  The BUILD123D CONTAINER bounds what a script can CONSUME: memory, CPU,
 *  processes, wall-clock time.  These are quantitative limits the container
 *  enforces correctly and that code cannot enforce reliably.
 *  Active container limits on mcp-build123d (set in docker-compose.yml):
 *    mem_limit: 2g, cpus: 2.0, pids_limit: 128, no-new-privileges, cap_drop ALL
 *    + 120 s dispatch timeout in the executor.
 *
 *  WHY LANGUAGE CONSTRUCTS ARE NOT RESTRICTED — banning `for`, `while`, or
 *  large exponents does not protect against resource exhaustion: a single
 *  statement without any loop (`Box(1e9, 1e9, 1e9)`, a giant literal list,
 *  deep nesting) can exhaust memory.  Conversely, banning loops discards
 *  legitimate idioms such as list comprehensions for algebraic placement
 *  patterns (`[Pos(i*10, 0, 0) * Box(5, 5, 5) for i in [0, 1, 2]]`).
 *  Resource bounding belongs exclusively at the container layer.
 *
 * IMPORT AUTOMATON — both allowed sources use one parameterised parser.  Every
 * token in a named import list must be explicitly recognized by that automaton;
 * an unexpected token always rejects and never silently terminates the list.
 * A comment inside parentheses behaves like a newline and only terminates an
 * import list when delimiter depth is zero.
 *
 * ATTRIBUTE DENYLIST CAVEAT — FORBIDDEN_ATTRIBUTES is incomplete by
 * construction: it knows only write/serialization method names present in the
 * reviewed third-party API when this boundary was written.  It is defense in
 * depth, not the promise of isolation.  Reachability is bounded structurally by
 * named-import allowlists and by rejecting normal dangerous identifiers; the
 * execution container remains the sandbox boundary.
 *
 * WALRUS POLICY (v2)
 *  The walrus operator `:=` is rejected in v1.  Python tokenises it as a single
 *  two-character token; our lexer would otherwise split it as `:` then `=`,
 *  both valid operators individually.  We intercept `:=` explicitly before the
 *  single-char check.  A future review may admit walrus in comprehensions once
 *  comprehension scope rules are also validated.
 *
 * SANDBOX CAVEAT — this partial validator is a guard, not a sandbox.  The container
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
 * 4. I/O backdoor functions from build123d in normal identifier position —
 *    backstop for `export_step(...)`.  These are
 *    legitimate build123d functions but must never appear in an agent-authored
 *    script; the provider itself handles all file I/O under server-fixed paths.
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
  // volume. Named import allowlists are the structural boundary; these names
  // are a defense-in-depth backstop in normal identifier position.
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
]);

/**
 * Known attribute names that write or serialize through third-party APIs.
 *
 * WHY SEPARATE FROM FORBIDDEN_NAMES — an attribute is not a free identifier:
 * `.type` is legitimate geometric API usage even though `type(...)` is a
 * forbidden introspection builtin. This list is intentionally incomplete and
 * must never be described as the isolation boundary; see the header caveat.
 */
const FORBIDDEN_ATTRIBUTES = new Set([
  "save",
  "write",
  "dump",
  "serialize",
  "to_step",
  "to_stl",
  "to_brep",
  "to_gltf",
  "to_svg",
  "to_dxf",
  "to_file",
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
]);

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
  column: number;
  startsLogicalLine: boolean;
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let column = 0;
  let delimiterDepth = 0;
  let atLogicalLineStart = true;

  function advance(): string {
    const ch = source[pos++] ?? "";
    if (ch === "\n") {
      line++;
      column = 0;
    } else {
      column++;
    }
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
    if (tokens.length >= MAX_TOKENS) {
      throw new GeometryScriptValidationError(
        "too_many_nodes",
        `Script exceeds maximum token count (${MAX_TOKENS}).`,
        currentLine(),
      );
    }

    const startLine = currentLine();
    const startColumn = column;
    const ch = peek();

    const pushToken = (kind: TokenKind, value: string): void => {
      const significant = kind !== "WHITESPACE" && kind !== "COMMENT" &&
        kind !== "NEWLINE" && kind !== "CONTINUATION";
      tokens.push({
        kind,
        value,
        line: startLine,
        column: startColumn,
        startsLogicalLine: significant && atLogicalLineStart,
      });
      if (significant) atLogicalLineStart = false;
    };

    // Whitespace (space, tab — not newline)
    if (ch === " " || ch === "\t") {
      let ws = "";
      while (peek() === " " || peek() === "\t") ws += advance();
      pushToken("WHITESPACE", ws);
      continue;
    }

    // Newlines (CR, LF, CRLF)
    if (ch === "\r" || ch === "\n") {
      let nl = advance();
      if (nl === "\r" && peek() === "\n") nl += advance();
      pushToken("NEWLINE", nl);
      if (delimiterDepth === 0) atLogicalLineStart = true;
      continue;
    }

    // Line continuation: backslash followed by newline
    if (ch === "\\") {
      const next = peek(1);
      if (next === "\n" || next === "\r") {
        advance(); // consume backslash
        let nl = advance(); // consume \n or \r
        if (nl === "\r" && peek() === "\n") nl += advance();
        pushToken("CONTINUATION", "\\" + nl);
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
      pushToken("COMMENT", comment);
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
      const strToken = consumeString(source, pos, line, startColumn, startLine);
      pos = strToken.nextPos;
      line = strToken.nextLine;
      column = strToken.nextColumn;
      pushToken("STRING", strToken.value);
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
      pushToken("NUMBER", numStr);
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

      const previous = [...tokens].reverse().find((token) =>
        token.kind !== "WHITESPACE" && token.kind !== "CONTINUATION" &&
        token.kind !== "NEWLINE" && token.kind !== "COMMENT"
      );
      const isAttribute = previous?.kind === "OP" && previous.value === ".";

      // Attribute names have a separate defense-in-depth denylist so normal
      // builtins such as `type` do not block legitimate geometric properties.
      const forbidden = isAttribute
        ? FORBIDDEN_ATTRIBUTES.has(name)
        : FORBIDDEN_NAMES.has(name);
      if (forbidden) {
        // Attributes (FORBIDDEN_ATTRIBUTES path) need no recovery hint — an
        // agent would not name a method after a file-I/O attribute.  Identifier
        // position is different: natural engineering terms such as 'socket',
        // 'time', 'open' or 'input' share names with forbidden Python modules
        // and built-ins.  Without context the error looks like a validator bug,
        // not a naming collision.  The hint below lets an agent self-correct
        // without human intervention.
        const detail = isAttribute
          ? `Forbidden attribute '${name}' at line ${startLine}.`
          : `Forbidden identifier '${name}' at line ${startLine}. ` +
            `'${name}' is reserved because it matches a restricted Python ` +
            `module or built-in name — rename the local variable ` +
            `(e.g. '${name}_shape', '${name}_part').`;
        throw new GeometryScriptValidationError("forbidden_name", detail, startLine);
      }

      pushToken("NAME", name);
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
      column += 2;
      pushToken("OP", twoChar);
      continue;
    }
    const oneChar = source[pos]!;
    if (ALLOWED_OPS.has(oneChar)) {
      pos++;
      column++;
      pushToken("OP", oneChar);
      if (oneChar === "(" || oneChar === "[" || oneChar === "{") delimiterDepth++;
      if (oneChar === ")" || oneChar === "]" || oneChar === "}") delimiterDepth--;
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
  nextColumn: number;
}

function consumeString(
  source: string,
  startPos: number,
  startLine: number,
  startColumn: number,
  _tokenLine: number,
): StringResult {
  let pos = startPos;
  let line = startLine;
  let column = startColumn;

  function advance(): string {
    const ch = source[pos++] ?? "";
    if (ch === "\n") {
      line++;
      column = 0;
    } else {
      column++;
    }
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
        return { value: content, nextPos: pos, nextLine: line, nextColumn: column };
      }
    } else {
      if (ch === q1) {
        content += advance();
        return { value: content, nextPos: pos, nextLine: line, nextColumn: column };
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
 * Validate a named import list with one fail-closed state machine.
 *
 * WHY ONE AUTOMATON — source-specific copies repeatedly diverged on unexpected
 * tokens. Parameterising the source and allowlist makes commas, aliases,
 * parentheses, newlines, comments, and rejection behavior one invariant.
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
function checkNamedImportNames(
  tokens: Token[],
  start: number,
  importLine: number,
  source: "build123d" | "math",
  allowlist: ReadonlySet<string>,
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
    throw new GeometryScriptValidationError(
      "forbidden_import",
      `Expected 'import' after 'from ${source}' at line ${importLine}.`,
      importLine,
    );
  }

  let parenDepth = 0;
  let state: "name" | "separator" | "alias" = "name";
  let importedNameCount = 0;

  while (i < tokens.length) {
    const t = tokens[i++]!;
    if (t.kind === "WHITESPACE" || t.kind === "CONTINUATION") continue;
    if (t.kind === "NEWLINE" || t.kind === "COMMENT") {
      if (parenDepth === 0) break;
      continue;
    }
    if (t.kind === "OP" && t.value === "(") {
      if (parenDepth !== 0 || importedNameCount !== 0 || state !== "name") {
        throw unexpectedImportToken(t, source, importLine);
      }
      parenDepth++;
      continue;
    }
    if (t.kind === "OP" && t.value === ")") {
      if (parenDepth !== 1 || importedNameCount === 0 || state === "alias") {
        throw unexpectedImportToken(t, source, importLine);
      }
      while (i < tokens.length && tokens[i]!.kind === "WHITESPACE") i++;
      const afterList = tokens[i];
      if (
        afterList === undefined || afterList.kind === "NEWLINE" ||
        afterList.kind === "COMMENT"
      ) return;
      throw unexpectedImportToken(afterList, source, importLine);
    }
    if (t.kind === "OP" && t.value === ",") {
      if (state !== "separator") throw unexpectedImportToken(t, source, importLine);
      state = "name";
      continue;
    }
    if (t.kind === "OP" && t.value === "*") {
      throw new GeometryScriptValidationError(
        "forbidden_import",
        `Wildcard 'from ${source} import *' is not allowed at line ${importLine}.`,
        importLine,
      );
    }
    if (t.kind === "NAME") {
      if (state === "alias") {
        state = "separator";
        continue;
      }
      if (state === "separator" && t.value === "as") {
        state = "alias";
        continue;
      }
      if (state !== "name") throw unexpectedImportToken(t, source, importLine);
      if (!allowlist.has(t.value)) {
        throw new GeometryScriptValidationError(
          "forbidden_import",
          `'${t.value}' is not in the allowed ${source} import set at line ${importLine}.`,
          importLine,
        );
      }
      importedNameCount++;
      state = "separator";
      continue;
    }
    throw unexpectedImportToken(t, source, importLine);
  }

  if (parenDepth !== 0 || importedNameCount === 0 || state !== "separator") {
    throw new GeometryScriptValidationError(
      "forbidden_import",
      `Incomplete 'from ${source} import' at line ${importLine}.`,
      importLine,
    );
  }
}

function unexpectedImportToken(
  token: Token,
  source: string,
  importLine: number,
): GeometryScriptValidationError {
  return new GeometryScriptValidationError(
    "forbidden_import",
    `Unexpected token '${token.value}' in 'from ${source} import' at line ${importLine}.`,
    importLine,
  );
}

/**
 * Scan the token stream for import statements.
 *
 * Accepted forms:
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
      throw new GeometryScriptValidationError(
        "forbidden_import",
        `Standalone 'import' is not allowed at line ${tok.line}; use a named import.`,
        tok.line,
      );
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
      if (modTok.value !== "build123d" && modTok.value !== "math") {
        throw new GeometryScriptValidationError(
          "forbidden_import",
          `Forbidden 'from ${modTok.value} import …' at line ${tok.line}.`,
          tok.line,
        );
      }
      if (modTok.value === "math") {
        checkNamedImportNames(
          tokens,
          modTok.index + 1,
          tok.line,
          "math",
          ALLOWED_MATH_NAMES,
        );
      }
      if (modTok.value === "build123d") {
        checkNamedImportNames(
          tokens,
          modTok.index + 1,
          tok.line,
          "build123d",
          ALLOWED_BUILD123D_NAMES,
        );
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
 * Verify that `result` is assigned exactly once at module level (column 0).
 *
 * LOGICAL-LINE RULE — `result` must start a new logical line at column zero and
 * delimiter depth zero. A physical newline consumed by `\\\n` or inside a
 * delimiter never creates module-level assignment authority.
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

    if (tok.column !== 0 || !tok.startsLogicalLine) {
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
  const scriptBytes = new TextEncoder().encode(script).byteLength;
  if (scriptBytes > MAX_SCRIPT_BYTES) {
    throw new GeometryScriptValidationError(
      "script_too_large",
      `Script exceeds maximum size of ${MAX_SCRIPT_BYTES} bytes (got ${scriptBytes}).`,
    );
  }

  const tokens = tokenize(script);
  checkImports(tokens);
  checkResultAssignment(tokens);
}
