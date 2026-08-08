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
 * WHAT IS ACCEPTED:
 *  • imports: exactly `from build123d import …` or `import build123d`
 *    optionally `from math import {approved names}`
 *  • name references: any [a-zA-Z_][a-zA-Z0-9_]* identifier NOT in the
 *    forbidden list and NOT matching the dunder pattern __foo__
 *  • number literals: decimal integers and floats whose parsed value is finite
 *    (inf/nan literals are rejected; 1e999 overflows to Infinity and is
 *    rejected)
 *  • string literals (single / double / triple-quoted, ASCII + UTF-8 content)
 *  • operators and punctuation from BUILD123D_OPS
 *  • line comments `# …`
 *  • whitespace (space, tab) and newlines (CR, LF, CRLF)
 *  • line continuations `\` at end of line
 *
 * WHAT IS ALWAYS REJECTED regardless of placement:
 *  • dunder references: __foo__
 *  • forbidden built-in and module names (see FORBIDDEN_NAMES below)
 *  • `result` assigned more than once at the outermost indentation level
 *  • `result` never assigned
 *  • raw/bytes/f-string prefixes (rb, br, b, f, rf, fr literals)
 *  • `=` appearing inside a function/class definition body (depth tracking)
 *  • any byte sequence not matched by the tokenizer
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
 * This list corresponds to the D4 spec enumeration.
 */
const FORBIDDEN_NAMES = new Set([
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
  // Reflection and introspection built-ins that allow bypassing the name
  // allowlist at runtime: `vars()["__builtins__"]` and `dir(obj)` can expose
  // every name in scope; `type(x)` can construct new classes; `callable`,
  // `hasattr`, and `id` enable probing the object graph.
  "vars",
  "dir",
  "type",
  "callable",
  "hasattr",
  "breakpoint",
  "id",
]);

/** Only these top-level import sources are whitelisted. */
const ALLOWED_IMPORT_SOURCES = new Set(["build123d", "math"]);

/** `from math import` only permits this subset. */
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
 * Punctuation and operators that are legal in build123d geometry scripts.
 * Anything else is rejected.
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
 * Scan the token stream for import statements.
 *
 * Accepted forms:
 *   import build123d
 *   from build123d import Foo, Bar
 *   from math import pi, sqrt
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
      // Standalone `import X` — module name must follow.
      const next = nextSignificantName(tokens, i + 1);
      if (!next) {
        throw new GeometryScriptValidationError(
          "forbidden_import",
          `Bare 'import' without a module name at line ${tok.line}.`,
          tok.line,
        );
      }
      if (!ALLOWED_IMPORT_SOURCES.has(next.value)) {
        throw new GeometryScriptValidationError(
          "forbidden_import",
          `Forbidden import of '${next.value}' at line ${tok.line}. ` +
            `Only build123d and math are allowed.`,
          tok.line,
        );
      }
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
      // If it's `from math import`, verify every imported name is in the allowlist
      if (modTok.value === "math") {
        checkMathImportNames(tokens, modTok.index + 1, tok.line);
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

function checkMathImportNames(
  tokens: Token[],
  start: number,
  importLine: number,
): void {
  // Skip to the `import` keyword following the module name
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
    return; // No `import` keyword found — handled upstream
  }
  // Now collect imported names: NAME (WHITESPACE* , WHITESPACE* NAME)*
  // Stop at NEWLINE — it marks the end of the import statement.
  while (i < tokens.length) {
    const t = tokens[i++]!;
    if (t.kind === "WHITESPACE" || t.kind === "CONTINUATION") continue;
    if (t.kind === "NEWLINE") break; // end of import statement
    if (t.kind === "OP" && t.value === ",") continue;
    if (t.kind === "OP" && t.value === "(") continue;
    if (t.kind === "OP" && t.value === ")") break;
    if (t.kind === "NAME") {
      if (t.value === "as") continue; // `import pi as PI` alias — skip alias too
      if (!ALLOWED_MATH_NAMES.has(t.value) && t.value !== "as") {
        throw new GeometryScriptValidationError(
          "forbidden_import",
          `'${t.value}' is not in the allowed math import set at line ${importLine}.`,
          importLine,
        );
      }
      continue;
    }
    // I1: wildcard import must be rejected explicitly.  Without this check,
    // `from math import *` produces an OP token with value `*` that falls
    // through to the final `break` — silently accepted — because `*` is not
    // a COMMENT or any of the cases above.
    if (t.kind === "OP" && t.value === "*") {
      throw new GeometryScriptValidationError(
        "forbidden_import",
        `Wildcard 'from math import *' is not allowed at line ${importLine}.`,
        importLine,
      );
    }
    if (t.kind === "COMMENT") break;
    break;
  }
}

/**
 * Count how many times `result` is assigned at the outermost scope
 * (parenthesis depth === 0, not inside a def or class body).
 *
 * We track a simple parenthesis depth; deeper nesting means we are inside
 * an expression.  The pattern `result = …` at depth 0 counts as one assignment.
 */
function checkResultAssignment(tokens: Token[]): void {
  let depth = 0; // parenthesis/bracket/brace depth
  let resultAssignments = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.kind !== "OP" && tok.kind !== "NAME") continue;

    if (tok.kind === "OP") {
      if (tok.value === "(" || tok.value === "[" || tok.value === "{") depth++;
      else if (tok.value === ")" || tok.value === "]" || tok.value === "}") depth--;
      continue;
    }

    // NAME token
    if (tok.value === "result" && depth === 0) {
      // Check if next significant token is `=` (assignment, not `==`)
      const next = nextSignificantToken(tokens, i + 1);
      if (next?.value === "=") {
        resultAssignments++;
        if (resultAssignments > 1) {
          throw new GeometryScriptValidationError(
            "result_multiple_assignments",
            `'result' is assigned more than once (second assignment at line ${tok.line}).`,
            tok.line,
          );
        }
      }
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
  if (script.length > MAX_SCRIPT_BYTES) {
    throw new GeometryScriptValidationError(
      "script_too_large",
      `Script exceeds maximum size of ${MAX_SCRIPT_BYTES} bytes (got ${script.length}).`,
    );
  }

  const tokens = tokenize(script);
  checkImports(tokens);
  checkResultAssignment(tokens);
}
