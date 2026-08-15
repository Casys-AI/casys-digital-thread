> **Status: DELIVERED** — implemented on `main` as analyzer 1.4.0 (left-associative
> `Pos`/`Rot` placement chains, `Rot * sketch`). Kept as the reference RFC for that
> family. Direction context:
> [closed-language compilation](../explanations/closed-language-compilation.md).

# RFC: qualified build123d 1.4.0 — placement grammar

Executable implementation brief for one coding session. Implement **only** this lot. Do
not start 1.5.0 or 1.6.0. Do not touch D4.

This adapter never imports or executes Python/build123d. It proves a closed AST subset.
Anything D4 allows but this frontend cannot prove stays an explicit unresolved
construct. Previously qualified bundles stay bit-identical.

## 1. Goal

Unify `*` so a left-associative product of `Pos`/`Rot` calls is a placement, then that
placement may multiply a qualified solid or sketch.

Today `parsePlacementTimesShape` accepts only a **single** `Pos(...)` or `Rot(...)`
CallExpression as the immediate left child
(`src/adapters/analyzers/qualified-build123d-source-analyzer.ts`,
`parsePlacementTimesShape`). Python associates `*` to the left, so
`Pos(a) * Rot(b) * Box(c)` is `(Pos * Rot) * Box`. `Pos * Rot` is not a CallExpression →
the parse returns `undefined` → generic `python-dynamic-call` /
`python-parameter-expression-not-qualified`. The provider executes the idiom; the
frontend drops it.

Opening `Rot * sketch` in the same change avoids a special case inside the new helper: a
placement product that contains `Rot` applied to a sketch keeps the sketch kind, same as
`Pos * sketch`.

## 2. Non-goals (do not open)

- Named placements: `p = Pos(...); p * Shape`
- `Location(...)`, `Plane.XY`, `Vector`, `Axis`, class `Scale`
- `Ellipse`, `Polygon`, `RegularPolygon`
- `from math import pi`
- extrude positional amount / `taper=` / `both=` / `until=`
- `fillet(solid, r)` / `chamfer(solid, l)` positional-solid forms
- General `MemberExpression`, `.faces()`, `filter_by`
- `ALLOWED_BUILD123D_NAMES` (D4)
- New analyzer modules, new `deno.json` `check` entries
- Changing `build123d-ast-identity/1.0` or profile `build123d-closed-subset-v1`

## 3. Invariants the implementer must not break

| Invariant                      | Rule                                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Analyzer id                    | `build123d-qualified-lezer` unchanged                                                                                                                                         |
| Analyzer version               | `QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION = "1.4.0"`                                                                                                                       |
| Profile                        | `build123d-closed-subset-v1` unchanged                                                                                                                                        |
| Identity scheme                | `schemaVersion: "build123d-ast-identity/1.0"` in `astStableId` unchanged                                                                                                      |
| Call table                     | `QUALIFIED_BUILD123D_CALLS` gains **no** name                                                                                                                                 |
| Geometry kinds                 | still only `"solid" \| "sketch"` — no placement symbol kind                                                                                                                   |
| Bit-identical                  | the 1.2/1.3 corpus in `existing qualified bundles stay bit-identical under 1.3.0` keeps the same symbol/dependency ids; only the version string on the bundle becomes `1.4.0` |
| `parsePositionalCall`          | unchanged (still exact arity, no keywords, no splat)                                                                                                                          |
| `canonicalAst` / `astStableId` | unchanged                                                                                                                                                                     |
| Sketch as `result`             | still rejected                                                                                                                                                                |

`Pos * Box` and `Rot * Sphere` already qualified must take the new helper path and still
collect the same `parameterReferences` in the same order (placement params, then shape
params). That is why the corpus stays bit-identical.

## 4. Constructs

### 4.1 Placement expression (new helper)

Add `parsePlacementExpression` next to `parsePlacementTimesShape`. Reuse
`PlacementExpression` (`parameterReferences` only). Do **not** add a new type. The
helper is pure: it never calls `addUnresolved`.

| Step          | Lezer node                                                               | Rule                                                                                                                  |
| ------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Unwrap        | `ParenthesizedExpression`                                                | Same as `parseShapeExpression`: `inner = node.children.find(isStaticExpressionNode)`, recurse. No inner → `undefined` |
| `Pos`         | `CallExpression`                                                         | `parsePositionalCall(..., "Pos")` — 3 positional scalars, no keywords, no splat                                       |
| `Rot`         | `CallExpression`                                                         | `parsePositionalCall(..., "Rot")` — 3 positional scalars, no keywords, no splat                                       |
| Product       | `BinaryExpression` with 3 children, operator `ArithOp` whose text is `*` | Recurse on **both** children. Both must be placements. Merge `parameterReferences` **left then right**                |
| Anything else | `VariableName`, `MemberExpression`, other calls, `+`/`-`, shape calls    | `undefined` — not a placement                                                                                         |

A `VariableName` is never a placement in 1.4.0 (named bindings are 1.6.0).

### 4.2 Placement times shape (replace the body of `parsePlacementTimesShape`)

Keep the function signature. Replace the two `parsePositionalCall` attempts with:

```
shape = parseShapeExpression(right, ...)   # first, unchanged
if (shape === undefined) return undefined  # do not label; right is not a shape

place = parsePlacementExpression(left, ...)
if (place === undefined) {
  addUnresolved(
    "build123d-placement-not-qualified",
    "The left operand of * must be a Pos or Rot call, or a product of those placements.",
    left,   # span the left operand, not the whole *
  )
  return undefined
}

return {
  geometry: shape.geometry,   # Pos * and Rot * both preserve kind
  parameterReferences: [...place.parameterReferences, ...shape.parameterReferences],
  shapeReferences: shape.shapeReferences,
}
```

**Delete** the `shape.geometry !== "solid"` branch and the
`addGeometryKindMismatch(..., "Rot *", "solid", ...)` call. After 1.4.0 no unresolved
message may contain `Rot * expects a solid`.

Emit `build123d-placement-not-qualified` **only** when `right` is already a proven shape
and `left` is not a placement. Do not emit it for `Pos * Rot` (right is not a shape) or
for `width * 2` (assignment hits `parseStaticExpression` first).

When this function returns `undefined`, the existing assignment/`result` fallthrough
still runs (`addExpressionUnresolved` + `python-parameter-expression-not-qualified` /
`build123d-result-not-qualified`). The new kind is **additional**, not a replacement.
Tests assert the dedicated kind is present; they must not require generic kinds to
vanish.

### 4.3 Forms that become qualified

Lezer `*` is left-associative. The new helper consumes that tree; the agent does not
have to parenthesize to the right.

| Source form                                                       | Tree                                 | Genre                        |
| ----------------------------------------------------------------- | ------------------------------------ | ---------------------------- |
| `Pos(1, 2, 3) * Box(10, 20, 30)`                                  | already qualified                    | `solid` — identity unchanged |
| `Rot(0, 0, 45) * Box(10, 20, 30)`                                 | already qualified                    | `solid` — identity unchanged |
| `Pos(1, 2, 3) * (Rot(0, 0, 45) * Box(10, 20, 30))`                | already qualified (right is a shape) | `solid` — identity unchanged |
| `Pos(1, 2, 3) * Rot(0, 0, 45) * Box(10, 20, 30)`                  | `*( *(Pos, Rot), Box )`              | `solid`                      |
| `(Pos(1, 2, 3) * Rot(0, 0, 45)) * Box(10, 20, 30)`                | `*( Parenthesized(Pos*Rot), Box )`   | `solid`                      |
| `Rot(0, 90, 0) * Pos(0, 0, 10) * Rot(0, 0, 45) * Cylinder(4, 12)` | left-assoc chain of 3 placements     | `solid`                      |
| `Rot(0, 0, 45) * Rectangle(10, 20)`                               | `Rot *` sketch                       | `sketch`                     |
| `extrude(Rot(0, 0, 45) * Rectangle(10, 20), amount=5)`            | extrude of that sketch               | `solid` — valid `result`     |
| `Pos(1, 2, 3) * Rot(0, 0, 45) * Circle(3)` then extrude           | chain * sketch                       | `sketch` then `solid`        |

Aliases already accepted by `parsePositionalCall` (`from build123d import Pos as P`)
keep working; do not add alias-specific code.

### 4.4 Forms that stay closed, now labelled

| Source form                                     | Why it fails                                             | Kind                                                                  | Exact message                                                                                      | Span node                     |
| ----------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------- |
| `p = Pos(1, 2, 3)` then `p * Box(...)`          | `p` is `VariableName`, not a placement                   | `build123d-placement-not-qualified`                                   | `The left operand of * must be a Pos or Rot call, or a product of those placements.`               | the `p` on the `*`            |
| `Location(1, 2, 3) * Box(...)`                  | `Location` is not in the call table; left is not Pos/Rot | same new kind, plus existing import/`python-dynamic-call` labels      | same                                                                                               | the `Location(...)` call      |
| `Scale(2) * Box(...)`                           | class `Scale` is not a placement                         | same                                                                  | same                                                                                               | the `Scale(...)` call         |
| `Plane.XY * Box(...)`                           | `MemberExpression` is not a placement                    | new kind on `Plane.XY` **and** existing `python-dynamic-attribute`    | new message on left; `Attribute and subscript lookup is not qualified in v1.` on the member        | left member / attribute node  |
| `Box(1, 2, 3) * Cylinder(4, 12)`                | left is a shape, not a placement                         | new kind                                                              | same                                                                                               | the `Box(...)` call           |
| `(Pos(...) * Box(...)) * Cylinder(...)`         | left of the outer `*` is a shape                         | new kind                                                              | same                                                                                               | the parenthesized `Pos * Box` |
| `result = Pos(1, 2, 3)`                         | not a shape                                              | existing `build123d-result-not-qualified`                             | keep the result sentence; update it as in §5                                                       | `result` RHS                  |
| `result = Pos(...) * Rot(...)`                  | right of `*` is not a shape → no new kind                | existing `build123d-result-not-qualified` + `python-dynamic-call`     | do **not** emit the new kind                                                                       | RHS                           |
| `result = Rot(0, 0, 45) * Rectangle(10, 20)`    | now a proven **sketch**                                  | `build123d-geometry-kind-mismatch` + `build123d-result-not-qualified` | `result expects a solid, received a sketch.` — **not** `Rot * expects a solid, received a sketch.` | result RHS                    |
| Import `Location` / `Plane` / `Align` / `Scale` | not in `QUALIFIED_BUILD123D_CALLS`                       | `build123d-call-not-qualified`                                        | existing import sentence                                                                           | import name                   |

## 5. Docstring and result sentence

Module header (replace the placement bullets and the Next AST lock):

- Qualified shapes include: a `Pos`/`Rot` call, or a product of those placements, times
  a qualified solid or sketch (kind preserved); `Pos * sketch` and `Rot * sketch` are
  both sketches.
- Next AST lock (not opened here): Ellipse, Polygon, RegularPolygon and Plane
  placements; named `Pos`/`Rot` bindings; extrude `taper=`/`both=`/ `dir=`/`until=` and
  a positional amount; `fillet(solid, r)` and `chamfer(solid, l)` positional solid
  forms. Do not open general MemberExpression, `.faces()`, or `filter_by`.

Version comment above `QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION`:

```
* Placement chains Pos * Rot * shape, parenthesized placement products and
* Rot * sketch reuse the 1.2/1.3 positional-call and placement * shape
* identity scheme (build123d-ast-identity/1.0). Previously qualified
* bundles stay bit-identical.
```

Version constant: `"1.4.0"`.

Update the `build123d-result-not-qualified` sentence so the placement clause reads
`Pos/Rot placement chain * solid or sketch then extrude` instead of
`Pos/Rot * solid, Pos * sketch then extrude`. Do not otherwise rewrite that sentence.
This change does not touch bit-identical ids (those bundles have empty
`unresolvedConstructs`).

## 6. Tests — invariant sentences

Use `@std/assert` only. Names are full sentences. Keep `INPUT` as in the existing file.
Replace hardcoded `"1.3.0"` version asserts with
`QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION` (already imported).

### 6.1 Replace

`Pos times sketch is qualified and Rot times sketch is not`

Split into two tests. Do not keep the `Rot * expects a solid` assertion.

1. `Pos times a sketch then extrude stays a qualified solid` — existing
   `Pos * Rectangle` extrude script, `unresolvedConstructs === []`.
2. `Rot times a sketch then extrude is a qualified solid` — the current `rotated` script
   must now have `unresolvedConstructs === []`, `policy.status === "passed"`, `result`
   kind `"artifact"`.

### 6.2 Add

Use these exact names and these exact scripts (whitespace as written).

**`a left-associative Pos times Rot times solid is qualified`**

```python
from build123d import Box, Pos, Rot
result = Pos(1, 2, 3) * Rot(0, 0, 45) * Box(10, 20, 30)
```

Assert: no unresolved, status `passed`, `result` is `artifact`.

**`a parenthesized Pos times Rot product times a solid is qualified`**

```python
from build123d import Box, Pos, Rot
result = (Pos(1, 2, 3) * Rot(0, 0, 45)) * Box(10, 20, 30)
```

Same asserts. This is the form that still failed when only the right child was
parenthesized in the other direction — both directions must pass.

**`a longer Pos and Rot placement chain times a solid is qualified`**

```python
from build123d import Cylinder, Pos, Rot
result = Rot(0, 90, 0) * Pos(0, 0, 10) * Rot(0, 0, 45) * Cylinder(4, 12)
```

Same asserts.

**`a left-associative placement chain times a sketch then extrude is a qualified solid`**

```python
from build123d import Circle, Pos, Rot, extrude
result = extrude(Pos(1, 2, 3) * Rot(0, 0, 45) * Circle(3), amount=5)
```

Same asserts.

**`Rot times a sketch is still not a valid result`**

```python
from build123d import Rectangle, Rot
result = Rot(0, 0, 45) * Rectangle(10, 20)
```

Assert: status `passed` (D4 + parse ok), `build123d-geometry-kind-mismatch` message
`result expects a solid, received a sketch.`, `build123d-result-not-qualified` present,
no message containing `Rot * expects a solid`.

**`a named Pos applied to a solid stays an explicit placement gap`**

```python
from build123d import Box, Pos
p = Pos(1, 2, 3)
result = p * Box(10, 20, 30)
```

Assert: `unresolvedConstructs` contains kind `build123d-placement-not-qualified` with
the exact message in §4.4. `result` is not fully qualified
(`build123d-result-not-qualified`).

**`Location or Scale times a solid stays an explicit placement gap`**

Two scripts, one assertion each:

```python
from build123d import Box, Location
result = Location(1, 2, 3) * Box(10, 20, 30)
```

```python
from build123d import Box, Scale
result = Scale(2) * Box(10, 20, 30)
```

Each: `build123d-placement-not-qualified` **and** `build123d-call-not-qualified`
(import). Do not qualify `result`.

**`a solid times a solid is not a placement product`**

```python
from build123d import Box, Cylinder
result = Box(10, 20, 30) * Cylinder(4, 12)
```

Assert: `build123d-placement-not-qualified` on the `*` left,
`build123d-result-not-qualified`.

**`a bare Pos times Rot product is not a solid`**

```python
from build123d import Pos, Rot
result = Pos(1, 2, 3) * Rot(0, 0, 45)
```

Assert: `build123d-result-not-qualified`. Assert the new placement kind is **absent**
(right is not a shape, so §4.2 must not label).

### 6.3 Keep, retitle

Rename `existing qualified bundles stay bit-identical under 1.3.0` →
`existing qualified bundles stay bit-identical under 1.4.0`.

Keep the same `scripts` / `expected` tables (ids are the 1.2.0 identities). Change only:

- `assertEquals(bundle.analyzer.version, "1.3.0")` →
  `QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION`
- failure message stays `` `${name} must keep its 1.2.0 analysis identity` ``

If this test goes red, the helper changed `parameterReferences` or hashing for an
already-qualified `Pos *` / `Rot *` form. Stop and fix; do not regenerate the expected
ids.

### 6.4 Other existing tests

Leave behaviour of fillet, chamfer, scale, extrude kwargs, Wedge arity, D4 rejections,
sketch `+`/`-` unchanged. Update only the literal `"1.3.0"` version pins in this file
(lines that currently hardcode it) to the exported constant.

`scale kwargs, one-arg, or non-uniform factors stay unresolved` already covers
`Scale(2) * Box`. After 1.4.0 that script must **also** carry
`build123d-placement-not-qualified`. Extend that case’s assertion rather than weakening
it.

## 7. Implementation order

1. Add the new tests and split the Rot-sketch test. Run them — they must fail (red).
2. Add `parsePlacementExpression`. Rewrite `parsePlacementTimesShape` as in §4.2. Delete
   the `Rot *` kind-mismatch branch.
3. Bump the version constant and the two docstrings / result sentence.
4. Flip version asserts; retitle the bit-identical test.
5. Update the three reference pages (§8).
6. Run the commands in §9. Do not run the full suite until the targeted analyzer tests
   and `deno task check` are green.

## 8. Files to touch

No new module. Do not edit `deno.json` `check`.

| File                                                                 | What                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/adapters/analyzers/qualified-build123d-source-analyzer.ts`      | helper, `parsePlacementTimesShape`, version `1.4.0`, header lock, result sentence                                                                                                                                                                         |
| `src/adapters/analyzers/qualified-build123d-source-analyzer_test.ts` | §6                                                                                                                                                                                                                                                        |
| `docs/reference/agent-workspace.md`                                  | table row `**1.4.0**`; qualify text adds left-associative `Pos`/`Rot` chains and `Rot *` sketch; paragraph after the table: 1.4.0 extends 1.3.0 with that grammar, bit-identical; **Next AST lock** drops `Rot *` sketch, adds named `Pos`/`Rot` bindings |
| `docs/reference/workspace-map.md`                                    | analyzer row `1.4.0` and the same qualify clause                                                                                                                                                                                                          |
| `docs/reference/analysis-authority-pipeline.md`                      | catalogue sentence: analyzer `1.4.0`, mention placement chains + `Rot *` sketch                                                                                                                                                                           |

Catalogues (`fixed-technical-compilation-profile-catalog-provider.ts`,
`initial-technical-source-analysis-composition.ts`) read the version constant — do not
hardcode `1.3.0` there. Only change them if a test hardcodes the string.

Do not edit `src/domain/engineering/geometry-script-validation.ts`.

## 9. Verification

Targeted (permissions as in CLAUDE.md; `deno task test` takes no path):

```bash
deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env \
  src/adapters/analyzers/qualified-build123d-source-analyzer_test.ts

deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env \
  src/adapters/compilers/initial-technical-source-analysis-composition_test.ts \
  src/adapters/compilers/technical-compilation-adapters_test.ts \
  src/adapters/compilers/fixed-technical-compilation-profile-catalog-provider.ts
```

If the catalogue test file is named `*_test.ts` beside the provider, run that file
instead of the provider module.

Then:

```bash
deno task check
deno task lint
deno fmt src/adapters/analyzers/qualified-build123d-source-analyzer.ts \
  src/adapters/analyzers/qualified-build123d-source-analyzer_test.ts \
  docs/reference/agent-workspace.md \
  docs/reference/workspace-map.md \
  docs/reference/analysis-authority-pipeline.md
```

`deno task fmt` is check-only at repo scale; write with `deno fmt <path>`.

No provider call, no Docker, no `git add` / commit unless the human asks.

## 10. Done when

- `QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION === "1.4.0"`
- Every script in §4.3 has empty `unresolvedConstructs`
- Every script in §4.4 carries the listed kind and exact message
- No unresolved message contains `Rot * expects a solid`
- The bit-identical corpus matches the frozen 1.2.0 ids
- Next AST lock no longer lists `Rot *` sketch
- D4, call table, identity scheme, and profile are untouched
- No new file under `src/` besides edits to the existing analyzer pair
