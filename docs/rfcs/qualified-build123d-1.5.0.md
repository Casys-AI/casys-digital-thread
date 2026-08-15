# RFC: qualified build123d 1.5.0 — sketches + operator sugar

Executable implementation brief for one coding session. Implement **only** this lot. Do
not start 1.6.0. Do not touch D4.

Write against the analyzer that is already on this branch:
`src/adapters/analyzers/qualified-build123d-source-analyzer.ts` at version **1.4.0**.
That file already contains `parsePlacementExpression`, left-associative `Pos`/`Rot`
chains, and `Rot *` sketch. Do not re-open the 1.4.0 placement grammar and do not
rewrite it.

This adapter never imports or executes Python/build123d. It proves a closed AST subset.
Anything D4 allows but this frontend cannot prove stays an explicit unresolved
construct. Previously qualified 1.2 / 1.3 / 1.4 bundles stay bit-identical.

## Écart vs draft (code réel)

D4 `ALLOWED_OPS` in `src/domain/engineering/geometry-script-validation.ts` does **not**
contain `&` or `|`. `validateGeometryScript` therefore throws `unrecognized_token`
before this frontend runs. The draft assumed `&` was already D4-admitted (like `+`/`-`).
That premise is false.

This lot **does not edit D4**. Consequence:

- `solid & solid` / `sketch & sketch` never become a passed bundle in 1.5.0.
- `analyze()` returns `policy.status === "rejected"` with
  `geometry-script-unrecognized-token` and empty `unresolvedConstructs`.
- The frontend still accepts Lezer `BitOp` `"&"` with the same-kind merge, so a later D4
  admission of `&` does not need a second frontend pass.
- `|` stays D4-rejected and is not opened here.
- Public sentences (result, module header, reference pages) do **not** claim `&` is
  qualified.

Tests that the draft named as qualified `&` scripts are replaced by
`ampersand intersection is rejected by D4 before the frontend` and
`solid bitwise or is rejected by D4 before the frontend`.

## 1. Goal

Open five reviewed sugars that the 1.4.0 frontend already sees and drops:

1. `Ellipse(x_radius, y_radius)` and `RegularPolygon(radius, side_count)` as sketches,
   through the existing `parsePositionalSketchCall` helper (today only `Rectangle` /
   `Circle`, lines 873–892).
2. `extrude(sketch, amount)` with a **positional** amount, in addition to the
   already-qualified `amount=` form. Today the two-positional branch (lines 1222–1232)
   labels `build123d-extrude-argument-not-qualified` and returns `undefined`.
3. Short positional `fillet(solid, radius)` and `chamfer(solid, length)`, plus
   positional `fillet(solid.edges(), radius)`. Today only
   `fillet(solid.edges(), radius=scalar)` and `chamfer(solid.edges(), scalar)` qualify;
   `fillet(base, 2)` is a silent `python-dynamic-call` (see the test
   `D4-admitted but unqualified build123d calls remain explicitly unresolved`).
4. Same-kind intersection `&` is implemented in the frontend (`BitOp`) but **not
   publicly qualified**: D4 rejects the token (see Écart). The 1.4.0
   `operator?.name !== "ArithOp"` guard is still split so a later D4 admission works.
5. `from math import pi` / `e` / `tau` as closed scalars in numeric expressions. Today
   every non-`build123d` import, including math, is `python-import-not-qualified` with
   `Only an explicit named import from build123d is qualified in v1.` (lines 241–247).
   D4 already admits those three names; this frontend must start proving them. They are
   **not** build123d calls.

Opening these together avoids a second pass over the same call table, the same
`parseStaticExpression` plumbing, and the same `+/-` kind check.

## 2. Non-goals (do not open)

- `Polygon(...)` / `Polygon(points)` — D4-admitted, stays `build123d-call-not-qualified`
- `from math import sin` / `cos` / `sqrt` / any other D4 math name, and any call
  `sin(...)` / `cos(...)`
- Evaluating `pi` / `e` / `tau` to a numeric literal; no constant folding
- Parenthesized `from math import (pi)` — `parseNamedImport` stays flat
- `import math` / `from math import *` (D4 already rejects)
- Named placements: `p = Pos(...); p * Shape`
- `Location(...)`, `Plane.XY`, `Vector`, `Axis`, class `Scale`
- extrude `taper=` / `both=` / `dir=` / `until=`
- `fillet` / `chamfer` method forms (`solid.fillet(2)`), `.faces()`, `filter_by`,
  `length2=` / `face=` / `angle=`
- `chamfer(..., length=scalar)` keyword length (still not reviewed)
- `|` / `^` / `intersect(...)` / `solid / solid`
- General `MemberExpression` outside the existing empty `.edges()` exception
- `ALLOWED_BUILD123D_NAMES` / `ALLOWED_MATH_NAMES` (D4)
- New analyzer modules, new `deno.json` `check` entries
- Changing `build123d-ast-identity/1.0` or profile `build123d-closed-subset-v1`
- Re-implementing 1.4.0 placement chains

## 3. Invariants the implementer must not break

| Invariant                      | Rule                                                                                                                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Analyzer id                    | `build123d-qualified-lezer` unchanged                                                                                                                                                                                                              |
| Analyzer version               | `QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION = "1.5.0"`                                                                                                                                                                                            |
| Profile                        | `build123d-closed-subset-v1` unchanged                                                                                                                                                                                                             |
| Identity scheme                | `schemaVersion: "build123d-ast-identity/1.0"` in `astStableId` unchanged                                                                                                                                                                           |
| Call table                     | `QUALIFIED_BUILD123D_CALLS` gains **only** `Ellipse` (sketch, 2) and `RegularPolygon` (sketch, 2). Do not change existing arities, including the unused `positionalArguments: 1` on `fillet` / `chamfer` / `extrude`                               |
| Geometry kinds                 | still only `"solid" \| "sketch"` — no math-symbol kind, no placement kind                                                                                                                                                                          |
| Math names                     | **not** symbols, **not** parameters, **not** `static-value-flow` sources. `parseStaticExpression` returns `{ shape: "scalar", references: [] }`                                                                                                    |
| Bit-identical                  | the corpus in `existing qualified bundles stay bit-identical under 1.4.0` keeps the same symbol/dependency ids; only the version string on the bundle becomes `1.5.0`. Failure message stays `` `${name} must keep its 1.2.0 analysis identity` `` |
| 1.4.0 placement tests          | the scripts already qualified in 1.4.0 stay `unresolvedConstructs === []`                                                                                                                                                                          |
| `parsePositionalCall`          | still exact arity, no keywords, no splat. New `mathScalars` argument only so `Circle(pi)` resolves                                                                                                                                                 |
| `canonicalAst` / `astStableId` | unchanged                                                                                                                                                                                                                                          |
| Sketch as `result`             | still rejected, including a bare `Ellipse` / `RegularPolygon` / `sketch & sketch`                                                                                                                                                                  |
| D4                             | `src/domain/engineering/geometry-script-validation.ts` is not edited                                                                                                                                                                               |

Existing `fillet(solid.edges(), radius=scalar)`, `chamfer(solid.edges(), scalar)`,
`extrude(sketch, amount=scalar)`, and `+/-` must take the same helper path as today and
collect `parameterReferences` in the same order (shape refs, then scalar refs; left then
right for booleans). That is why the frozen corpus stays bit-identical.

Do **not** invent a `SupportedParameter` / `SourceAnalysisSymbol` for `pi` / `e` /
`tau`. Their identity lives in the assignment `canonicalAst` as a `VariableName`.
`Circle(pi)` and `Circle(e)` therefore hash differently; `Circle(pi)` twice hashes the
same; neither bundle contains a symbol named `pi`.

## 4. Constructs

### 4.1 Call table

Add to `QUALIFIED_BUILD123D_CALLS` and to `QualifiedBuild123dCallName`:

```
["Ellipse", { role: "sketch", positionalArguments: 2 }],
["RegularPolygon", { role: "sketch", positionalArguments: 2 }],
```

They become `PositionalBuild123dCallName` automatically (they are not in the
`Exclude<..., "Compound" | "scale" | "fillet" | "chamfer" | "extrude">`).

Add a sibling set, **not** in the build123d table:

```
const QUALIFIED_MATH_SCALARS = new Set(["pi", "e", "tau"]);
```

### 4.2 Sketches — `parsePositionalSketchCall`

Replace the loop body list. Keep the helper otherwise unchanged:

```
for (const imported of ["Rectangle", "Circle", "Ellipse", "RegularPolygon"] as const)
```

Each call still goes through `parsePositionalCall`: exact positional arity, every
argument a closed scalar (now including math scalars), no keywords, no splat. Wrong
arity / `align=` / `*args` stay unproven — same silent fallthrough as
`Rectangle(10, 20, 30)` today.

`Polygon` is **not** added. Importing it still emits `build123d-call-not-qualified` with
the existing sentence
`build123d name Polygon is admitted by D4 but not qualified by this frontend version.`

### 4.3 Extrude — positional amount

Keep the reviewed `amount=` path (4 `isArgumentExpression` nodes: sketch, `amount`, `=`,
scalar) **first** and unchanged.

**Delete** the two-positional rejection at lines 1222–1232
(`extrude requires the amount keyword; a positional amount is not qualified.`). After
1.5.0 no unresolved message may contain that sentence.

Replace it with: when `expressions.length === 2`, there is no `AssignOp`, and there is
no splat, parse the first argument as a qualified sketch and the second as a closed
scalar. Same kind check as the keyword path
(`extrude expects a sketch, received a solid.`). Return a `solid` with
`parameterReferences` = sketch refs then amount refs.

Keep labelling unreviewed keywords via the existing kind and sentence:

```
build123d-extrude-argument-not-qualified
extrude keyword ${keyword}= is not qualified; only amount= is reviewed.
```

`taper=` / `both=` / `until=` stay labelled. `dir=` remains a D4
`geometry-script-forbidden-name` rejection and never becomes an unresolved construct.

A lone `extrude(sketch)` (one argument, no amount) stays unproven. Label it with the
same kind and this sentence, spanning the call:

```
extrude requires amount= or a positional amount.
```

Do not label splat. Method form `sketch.extrude(...)` is not a `VariableName` callee —
leave it to the existing dynamic-attribute / dynamic-call fallthrough.

### 4.4 Fillet — three reviewed forms

`parseFilletCall` today requires `expressions.length === 4` and `radius=`. Rewrite the
body; keep the signature (plus `mathScalars`).

A call whose callee is the imported `fillet` (alias OK) and which has no splat is
reviewed **iff** it is exactly one of:

| Form                | Lezer `ArgList` expressions          | First argument                         | Scalar                   |
| ------------------- | ------------------------------------ | -------------------------------------- | ------------------------ |
| A (already 1.3/1.4) | 4 nodes: edges, `radius`, `=`, value | empty `.edges()` on a qualified solid  | `radius=` closed scalar  |
| B (new)             | 2 positional, no `AssignOp`          | empty `.edges()` on a qualified solid  | positional closed scalar |
| C (new)             | 2 positional, no `AssignOp`          | a qualified **solid** (not `.edges()`) | positional closed scalar |

Match **A then B then C**. Trying `.edges()` before `parseShapeExpression` prevents
`base.edges()` from being misread as a failed solid.

Kind check on the selected solid is unchanged:
`fillet expects a solid, received a sketch.` `parameterReferences` = solid refs then
radius refs — same order as today for form A, which is why the frozen fillet corpus
stays bit-identical.

**Do not** open `fillet(solid, radius=scalar)` (keyword on the short form),
`fillet(solid.faces(), ...)`, `filter_by`, extra kwargs, or the method form.

When the callee is `fillet`, there is no splat, and the call is not A/B/C, emit
`build123d-fillet-argument-not-qualified` on the **call** node, then return `undefined`.
The assignment/`result` fallthrough still runs (`python-dynamic-call` /
`python-dynamic-attribute` / `build123d-result-not-qualified`). The new kind is
**additional**, not a replacement.

| Situation                                                                                    | Exact message                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| At least one `AssignOp` keyword (including `radius=` on a non-A form, `length=`, `extra=`)   | `fillet keyword ${keyword}= is not qualified; reviewed forms are fillet(solid, scalar), fillet(solid.edges(), scalar), and fillet(solid.edges(), radius=scalar).` — one unresolved per keyword name, same scan as `extrudeKeywordNames` |
| No keyword, but not B/C (1-arg, 3+ positional, first arg neither solid nor empty `.edges()`) | `fillet arguments are not a reviewed form; reviewed forms are fillet(solid, scalar), fillet(solid.edges(), scalar), and fillet(solid.edges(), radius=scalar).`                                                                          |

Do **not** emit this kind for `solid.fillet(...)` (callee is a `MemberExpression`).

### 4.5 Chamfer — two reviewed forms

`parseChamferCall` today requires two positionals whose first argument is empty
`.edges()`. Keep that path. Add the short solid form.

Reviewed **iff**:

| Form                | ArgList                     | First argument                        | Scalar                   |
| ------------------- | --------------------------- | ------------------------------------- | ------------------------ |
| A (already 1.3/1.4) | 2 positional, no `AssignOp` | empty `.edges()` on a qualified solid | positional closed scalar |
| B (new)             | 2 positional, no `AssignOp` | a qualified **solid**                 | positional closed scalar |

Match A then B. Kind check unchanged: `chamfer expects a solid, received a sketch.`
`parameterReferences` = solid refs then length refs.

`length=` / `length2=` / `face=` / `angle=` / keyword `length=` stay closed. When the
callee is `chamfer`, there is no splat, and the call is not A/B, emit
`build123d-chamfer-argument-not-qualified` on the call, then return `undefined`.
Additional, not a replacement.

| Situation                       | Exact message                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| At least one `AssignOp` keyword | `chamfer keyword ${keyword}= is not qualified; reviewed forms are chamfer(solid, scalar) and chamfer(solid.edges(), scalar).` — one unresolved per keyword |
| No keyword, but not A/B         | `chamfer arguments are not a reviewed form; reviewed forms are chamfer(solid, scalar) and chamfer(solid.edges(), scalar).`                                 |

Do not emit this kind for `solid.chamfer(...)`.

### 4.6 Intersection `&` — same-kind boolean

In `parseShapeExpression`, the current guard

```
operator?.name !== "ArithOp"
```

rejects `BitOp` before the text is inspected. Split the operator cases:

```
if (operator?.name === "ArithOp" && operatorText === "*")
  → parsePlacementTimesShape   # unchanged 1.4.0 path

if (operator?.name === "ArithOp" && (operatorText === "+" || operatorText === "-"))
  → existing same-kind merge

if (operator?.name === "BitOp" && operatorText === "&")
  → the same same-kind merge (left then right refs, same geometry)

otherwise return undefined
```

Reuse the existing `+/-` body. A tiny local helper is allowed if and only if the frozen
`+/-` corpus stays bit-identical (left refs then right refs).

`addGeometryKindMismatch(..., "&", left.geometry, right.geometry, right)` uses the
existing template:

```
& expects a sketch, received a solid.
& expects a solid, received a sketch.
```

`|` and `^` are also `BitOp`. Leave them `undefined` — no new kind (same silence as
`solid / solid` today).

Python gives `*` higher precedence than `&`, so
`Pos(1, 2, 3) * Box(10, 20, 30) & Cylinder(4, 12)` is already `(Pos * Box) & Cylinder`.
Do not special-case precedence.

`&` is **not** added to `parseStaticExpression`. `width = 10 & 2` stays an unqualified
assignment.

### 4.7 Math scalars — import path distinct from build123d

Keep `parseNamedImport` as it is (flat `from module import name [as alias]`,
comma-separated). Do not teach it parentheses.

Restructure the import loop (today lines 236–290):

1. `parseNamedImport` returns `undefined` → `python-import-not-qualified` with the
   **new** sentence below, on the import node. This covers parenthesized
   `from math import (pi)` (Lezer puts `(` immediately after `import`, so the current
   parser returns `undefined`).
2. `module === "build123d"` → existing call-table logic. When binding a local, if that
   local is already a math scalar, treat it as `python-import-alias-ambiguous` and drop
   both bindings.
3. `module === "math"` → for each imported name:
   - imported ∉ `{pi, e, tau}` → `math-name-not-qualified` on the name node,
     `math name ${imported} is admitted by D4 but not qualified by this frontend version.`
   - local already bound as build123d or math → `python-import-alias-ambiguous` with the
     existing sentence `Import alias ${local} is declared more than once.` Drop the
     previous binding.
   - two locals for the same imported math name (`from math import pi as P, pi as Q`) →
     `math-import-ambiguous`,
     `Imported name ${imported} has more than one local binding.`, drop both locals
     (mirrors `build123d-import-ambiguous`).
   - otherwise record `local → imported` in `mathScalars`.
4. Any other module → `python-import-not-qualified` with the new sentence.

Replace the import sentence. The 1.4.0 text becomes false the moment math is accepted:

```
Only an explicit named import from build123d, or from math of pi, e, or tau, is qualified in v1.
```

Aliases already parsed by `parseNamedImport` work with no extra code:
`from math import pi as P` binds local `P`.

Shadowing: next to the existing `importedCalls.has(assignment.name)` check, if
`mathScalars.has(assignment.name)` then delete that math binding and emit
`python-import-shadowing` with

```
Assignment ${name} shadows a qualified math import.
```

Do not change the existing build123d shadowing sentence.

Thread a `ReadonlyMap<string, ImportedName>` (or equivalent `ReadonlySet<string>` of
locals) named `mathScalars` through every helper that already reaches
`parseStaticExpression` or `parseShapeExpression`:

- the module-level parameter assignment (`radius = pi` must become a parameter
  **before** shape parsing)
- `parseStaticExpression`
- `parsePositionalCall` / `parsePositionalSolidCall` / `parsePositionalSketchCall`
- `parsePlacementExpression` / `parsePlacementTimesShape`
- `parseShapeExpression`
- `parseScaleCall` / `parseFilletCall` / `parseChamferCall` / `parseExtrudeCall` /
  `parseEmptyEdgesSelector`

`parseCompoundCall` does not need it.

`parseStaticExpression` on `VariableName`:

1. existing parameter → `{ shape: parameter.shape, references: [parameter] }`
2. else math local → `{ shape: "scalar", references: [] }`
3. else `undefined`

Parameters **first**. A script that never imports math and uses `pi = 3` stays a normal
parameter. Do not add `&` / calls / `sin` here.

### 4.8 Forms that become qualified

| Source form                                                         | Genre                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `Ellipse(4, 2)`                                                     | `sketch`                                                     |
| `RegularPolygon(10, 6)`                                             | `sketch`                                                     |
| `extrude(Ellipse(4, 2), amount=5)`                                  | `solid` — valid `result`                                     |
| `extrude(RegularPolygon(10, 6), 5)`                                 | `solid` — positional amount                                  |
| `extrude(Rectangle(10, 20), 5)`                                     | `solid` — same sugar on an already-qualified sketch          |
| `extrude(Pos(1, 2, 3) * Rot(0, 0, 45) * Ellipse(4, 2), 5)`          | `solid`                                                      |
| `fillet(Box(10, 10, 10), 2)`                                        | `solid`                                                      |
| `fillet(base, radius)` with `base` a solid and `radius` a parameter | `solid`                                                      |
| `fillet(base.edges(), 2)`                                           | `solid`                                                      |
| `fillet(base.edges(), radius=2)`                                    | `solid` — identity unchanged                                 |
| `chamfer(Box(10, 10, 10), 2)`                                       | `solid`                                                      |
| `chamfer(base.edges(), 2)`                                          | `solid` — identity unchanged                                 |
| `Box(10, 20, 30) & Cylinder(4, 12)`                                 | **not reached** — D4 `unrecognized_token` (Écart)            |
| `Rectangle(20, 20) & Circle(4)` then extrude                        | **not reached** — D4 `unrecognized_token` (Écart)            |
| `from math import pi` then `extrude(Circle(pi), 5)`                 | `solid`; no symbol `pi`                                      |
| `from math import pi as P` then `extrude(Circle(P), amount=5)`      | `solid`; no symbol `P`                                       |
| `from math import pi, e, tau` then `Box(pi, e, tau)`                | `solid`                                                      |
| `from math import pi` then `radius = pi * 2` then `Sphere(radius)`  | `solid`; `radius` is a parameter with **empty** `references` |
| `Pos(pi, 0, 0) * Box(1, 2, 3)` after `from math import pi`          | `solid`                                                      |
| `fillet(fillet(Box(10, 10, 10), 1), 2)`                             | `solid` (nested short form)                                  |

Aliases already accepted for build123d callees keep working. Do not add alias-specific
code.

### 4.9 Forms that stay closed, now labelled

| Source form                                                              | Why it fails                           | Kind                                                                                        | Exact message                                                                                                                                                  | Span                  |
| ------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `from build123d import Polygon` then `Polygon([(0, 0), (1, 0), (0, 1)])` | not in the call table                  | `build123d-call-not-qualified` (+ `python-dynamic-call` / `build123d-result-not-qualified`) | existing import sentence with `Polygon`                                                                                                                        | import name           |
| `from math import sin` (D4-admitted)                                     | not `pi`/`e`/`tau`                     | `math-name-not-qualified`                                                                   | `math name sin is admitted by D4 but not qualified by this frontend version.`                                                                                  | the `sin` name        |
| `from math import sqrt`                                                  | same                                   | `math-name-not-qualified`                                                                   | same template with `sqrt`                                                                                                                                      | the `sqrt` name       |
| `from math import (pi)`                                                  | `parseNamedImport` returns `undefined` | `python-import-not-qualified`                                                               | new import sentence in §4.7                                                                                                                                    | the import statement  |
| `from os import path`                                                    | not build123d / math                   | `python-import-not-qualified`                                                               | new import sentence                                                                                                                                            | the import statement  |
| `from math import pi` then `pi = 3`                                      | shadows a math scalar                  | `python-import-shadowing`                                                                   | `Assignment pi shadows a qualified math import.`                                                                                                               | the assignment        |
| `from math import pi as P, pi as Q`                                      | two locals for `pi`                    | `math-import-ambiguous`                                                                     | `Imported name pi has more than one local binding.`                                                                                                            | each name node        |
| `extrude(Rectangle(10, 20), amount=5, taper=1)`                          | unreviewed kwarg                       | `build123d-extrude-argument-not-qualified`                                                  | existing `extrude keyword taper= is not qualified; only amount= is reviewed.`                                                                                  | the call              |
| `extrude(Rectangle(10, 20), amount=5, both=1)`                           | same                                   | same kind                                                                                   | `... both= ...`                                                                                                                                                | the call              |
| `extrude(Rectangle(10, 20), amount=5, until=1)`                          | same                                   | same kind                                                                                   | `... until= ...`                                                                                                                                               | the call              |
| `extrude(Rectangle(10, 20))`                                             | no amount                              | same kind                                                                                   | `extrude requires amount= or a positional amount.`                                                                                                             | the call              |
| `fillet(base, radius=2)`                                                 | keyword short form                     | `build123d-fillet-argument-not-qualified`                                                   | `fillet keyword radius= is not qualified; reviewed forms are fillet(solid, scalar), fillet(solid.edges(), scalar), and fillet(solid.edges(), radius=scalar).`  | the call              |
| `fillet(base.edges(), length=2)`                                         | wrong keyword                          | same kind                                                                                   | `fillet keyword length= ...` (same reviewed-forms tail)                                                                                                        | the call              |
| `fillet(base.edges())`                                                   | 1-arg                                  | same kind                                                                                   | `fillet arguments are not a reviewed form; reviewed forms are fillet(solid, scalar), fillet(solid.edges(), scalar), and fillet(solid.edges(), radius=scalar).` | the call              |
| `fillet(base.faces(), radius=2)`                                         | `.faces()` + keyword                   | same kind + existing `python-dynamic-attribute`                                             | keyword sentence for `radius=`                                                                                                                                 | the call / the member |
| `chamfer(base.edges(), length=2)`                                        | keyword length                         | `build123d-chamfer-argument-not-qualified`                                                  | `chamfer keyword length= is not qualified; reviewed forms are chamfer(solid, scalar) and chamfer(solid.edges(), scalar).`                                      | the call              |
| `chamfer(base.edges())`                                                  | 1-arg                                  | same kind                                                                                   | `chamfer arguments are not a reviewed form; reviewed forms are chamfer(solid, scalar) and chamfer(solid.edges(), scalar).`                                     | the call              |
| `chamfer(base.edges(), 1, 2)`                                            | extra positional                       | same kind                                                                                   | the no-keyword chamfer sentence                                                                                                                                | the call              |
| `Rectangle(10, 20) & Box(1, 2, 3)`                                       | D4 rejects `&`                         | D4 `geometry-script-unrecognized-token`                                                     | server-owned D4 sentence                                                                                                                                       | whole script          |
| `result = Ellipse(4, 2)`                                                 | proven sketch                          | kind-mismatch + `build123d-result-not-qualified`                                            | `result expects a solid, received a sketch.`                                                                                                                   | result RHS            |
| `result = RegularPolygon(10, 6)`                                         | proven sketch                          | same                                                                                        | same                                                                                                                                                           | result RHS            |
| `result = Rectangle(10, 20) & Circle(4)`                                 | D4 rejects `&`                         | D4 `geometry-script-unrecognized-token`                                                     | server-owned D4 sentence                                                                                                                                       | whole script          |
| `result = Box(10, 20, 30) \| Cylinder(4, 12)`                            | D4 rejects `\|`                        | D4 `geometry-script-unrecognized-token`                                                     | server-owned D4 sentence                                                                                                                                       | whole script          |
| `solid.fillet(2)` / `solid.chamfer(2)`                                   | method form                            | existing dynamic kinds only                                                                 | **do not** emit `*-argument-not-qualified`                                                                                                                     | the member / call     |

## 5. Docstring and result sentence

Module header (replace the sketch / fillet / chamfer / extrude / boolean bullets and the
Next AST lock):

- named imports of Box, Cylinder, Cone, Sphere, Torus, Ellipsoid, Wedge, Rectangle,
  Circle, Ellipse, RegularPolygon, Pos, Rot, Compound, scale, fillet, chamfer and
  extrude;
- unique module-level shape assignments, each carrying an explicit geometry kind `solid`
  or `sketch`: … a Rectangle/Circle/Ellipse/ RegularPolygon call, … a same-kind
  `+`/`-`/`&`, … `fillet(<qualified-solid>, <scalar>)` or
  `fillet(<qualified-solid>.edges(), radius=<scalar> or positional <scalar>)`,
  `chamfer(<qualified-solid>, <scalar>)` or
  `chamfer(<qualified-solid>.edges(), <scalar>)`,
  `extrude(<qualified-sketch>, amount=<scalar> or positional <scalar>)`, …
- unique module-level parameter assignments made only of finite decimal numbers,
  unary/binary arithmetic, earlier parameters, the imported math scalars `pi` / `e` /
  `tau`, and flat lists;
- Next AST lock (not opened here): Polygon; Plane placements; named `Pos`/`Rot`
  bindings; extrude `taper=`/`both=`/`dir=`/`until=`; fillet / chamfer method forms;
  general `MemberExpression`, `.faces()`, `filter_by`; math `sin`/`cos` and every other
  D4 math name.

Version comment above `QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION`:

```
* Ellipse/RegularPolygon sketches, positional extrude amount, short
* fillet/chamfer solids, fillet(edges(), positional radius), same-kind
* intersection &, and math scalars pi/e/tau reuse the 1.2/1.3/1.4
* identity scheme (build123d-ast-identity/1.0). Previously qualified
* bundles stay bit-identical.
```

Version constant: `"1.5.0"`.

Update the `build123d-result-not-qualified` sentence. Replace only the boolean / fillet
/ chamfer / extrude clauses so it reads:

```
result must be one qualified solid: Box/Cylinder/Cone/Sphere/Torus/Ellipsoid/Wedge, Pos/Rot placement chain * solid or sketch then extrude, solid +/− solid, scale(solid, scalar), fillet(solid, scalar) or fillet(solid.edges(), radius=scalar or positional scalar), chamfer(solid, scalar) or chamfer(solid.edges(), scalar), extrude(sketch, amount=scalar or positional scalar), or Compound(children=[...]). A sketch is never a valid result.
```

Do not otherwise rewrite that sentence. This change does not touch bit-identical ids
(those bundles have empty `unresolvedConstructs`).

Update the `python-dynamic-call` sentence in `addExpressionUnresolved` so the
reviewed-call list includes `Ellipse` and `RegularPolygon` after `Circle`.

## 6. Tests — invariant sentences

Use `@std/assert` only. Names are full sentences. Keep `INPUT` as in the existing file.
Version asserts stay on `QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION`.

### 6.1 Replace

**`D4-admitted but unqualified build123d calls remain explicitly unresolved`**

The current script is `fillet(base, 2)`, which this lot qualifies. Replace the script
(keep the test name and the “D4-admitted but not proven” intent):

```python
from build123d import Polygon
result = Polygon([(0, 0), (1, 0), (0, 1)])
```

Assert: `build123d-call-not-qualified`, `build123d-result-not-qualified`,
`python-dynamic-call`. This is also the Polygon non-goal guard.

**`extrude requires the amount keyword on a qualified sketch`**

Rename to `extrude accepts amount= or a positional amount on a qualified sketch`.

Both scripts must now have `unresolvedConstructs === []`, `policy.status === "passed"`,
`result` kind `"artifact"`:

```python
from build123d import Rectangle, extrude
result = extrude(Rectangle(10, 20), amount=5)
```

```python
from build123d import Rectangle, extrude
result = extrude(Rectangle(10, 20), 5)
```

**`extrude rejects taper, both, dir, until, and positional amount`**

Rename to `extrude rejects taper, both, dir, and until`. Drop the positional-amount
script from `frontendRejected`. Keep taper / both / until labelled
`build123d-extrude-argument-not-qualified`. Keep the `dir=` D4 rejection block
unchanged.

### 6.2 Extend

**`a sketch is never a valid result`** — append:

```python
from build123d import Ellipse
result = Ellipse(4, 2)
```

```python
from build123d import RegularPolygon
result = RegularPolygon(10, 6)
```

Same asserts as the Rectangle/Circle cases.

**`Rectangle and Circle reject extra, keyword, or splat arguments`** — either retitle to
mention Ellipse/RegularPolygon or add a sibling test with the same asserts:

```python
from build123d import Ellipse, extrude
result = extrude(Ellipse(4, 2, 1), 5)
```

```python
from build123d import Ellipse, extrude
result = extrude(Ellipse(x_radius=4, y_radius=2), 5)
```

```python
from build123d import RegularPolygon, extrude
result = extrude(RegularPolygon(10), 5)
```

```python
from build123d import RegularPolygon, extrude
result = extrude(RegularPolygon(radius=10, side_count=6), 5)
```

**`chamfer keyword length, extra args, method form, or faces stay unresolved`** — keep
every script. Additionally assert `build123d-chamfer-argument-not-qualified` on every
script **except** `base.chamfer(2)` (method form: the new kind must be **absent**).

**`fillet method, 1-arg, extra kwargs, or Scale stay unresolved`** — keep every script.
Additionally assert `build123d-fillet-argument-not-qualified` on the 1-arg, extra-kwarg,
`length=`, `faces()`, and `filter_by` scripts. The kind must be **absent** on
`base.fillet(2)`, on `result = base.edges()`, and on `Scale(2) * Box`.

**`sketch plus or minus sketch stays a sketch and sketch plus solid is unresolved`** —
leave `+/-` behaviour unchanged.

### 6.3 Add

Use these exact names and these exact scripts (whitespace as written).

**`Ellipse and RegularPolygon extrude to a qualified solid`**

```python
from build123d import Ellipse, extrude
result = extrude(Ellipse(4, 2), amount=5)
```

```python
from build123d import RegularPolygon, extrude
result = extrude(RegularPolygon(10, 6), 5)
```

Each: no unresolved, status `passed`, `result` is `artifact`.

**`a left-associative placement chain times an Ellipse then extrude is a qualified solid`**

```python
from build123d import Ellipse, Pos, Rot, extrude
result = extrude(Pos(1, 2, 3) * Rot(0, 0, 45) * Ellipse(4, 2), 5)
```

Same asserts.

**`fillet of a solid by a positional radius is qualified`**

```python
from build123d import Box, fillet
result = fillet(Box(10, 10, 10), 2)
```

```python
from build123d import Box, fillet
base = Box(10, 10, 10)
radius = 2
result = fillet(base, radius)
```

```python
from build123d import Box, fillet
base = Box(10, 10, 10)
result = fillet(base.edges(), 2)
```

Each: no unresolved, status `passed`, `result` is `artifact`. The named-radius script
must expose symbols `base` (variable), `radius` (parameter), `result` (artifact) and the
same two `structural-incidence` edges as the existing keyword fillet graph
(`base → result`, `radius → result`).

**`chamfer of a solid by a positional length is qualified`**

```python
from build123d import Box, chamfer
result = chamfer(Box(10, 10, 10), 2)
```

Same asserts.

**`ampersand intersection is rejected by D4 before the frontend`**

Four scripts (whitespace as written). Each must have `policy.status === "rejected"`,
empty `unresolvedConstructs`, empty `symbols`, and a finding whose code is
`geometry-script-unrecognized-token`:

```python
from build123d import Box, Cylinder
result = Box(10, 20, 30) & Cylinder(4, 12)
```

```python
from build123d import Circle, Rectangle, extrude
result = extrude(Rectangle(20, 20) & Circle(4), 5)
```

```python
from build123d import Box, Rectangle
mixed = Rectangle(20, 20) & Box(10, 10, 10)
result = Box(1, 2, 3)
```

```python
from build123d import Circle, Rectangle
result = Rectangle(20, 20) & Circle(4)
```

**`solid bitwise or is rejected by D4 before the frontend`**

```python
from build123d import Box, Cylinder
result = Box(10, 20, 30) | Cylinder(4, 12)
```

Same D4-rejection asserts. No fillet / chamfer argument kind (the bundle has no
unresolved constructs).

**`from math import pi qualifies a Circle radius`**

```python
from build123d import Circle, extrude
from math import pi
result = extrude(Circle(pi), 5)
```

Assert: no unresolved, status `passed`, `result` is `artifact`, **no** symbol named
`pi`, **no** dependency whose `from` is `pi`.

**`from math import e and tau are closed scalars`**

```python
from build123d import Box
from math import e, tau
result = Box(e, tau, 1)
```

Same no-unresolved / no-symbol-`e` / no-symbol-`tau` asserts.

**`from math import pi as P qualifies an aliased scalar`**

```python
from build123d import Circle, extrude
from math import pi as P
result = extrude(Circle(P), amount=5)
```

Same asserts; no symbol named `P` or `pi`.

**`a math scalar assigned to a parameter carries no math symbol`**

```python
from build123d import Sphere
from math import pi
radius = pi * 2
result = Sphere(radius)
```

Assert: symbols are only `radius` (parameter) and `result` (artifact); one
`structural-incidence` `radius → result`; no `static-value-flow` out of a math name.

**`Circle of pi and Circle of e do not share an artifact identity`**

Analyze `extrude(Circle(pi), 5)` and `extrude(Circle(e), 5)` (each with the matching
`from math import` and `from build123d import Circle, extrude`). Assert the two `result`
symbol ids differ. This is the fingerprint guard: the `VariableName` is inside
`canonicalAst`; we did not fold the constant.

**`from math import sin stays an explicit math gap`**

```python
from build123d import Box
from math import sin
result = Box(1, 2, 3)
```

Assert: `math-name-not-qualified` with the exact §4.9 sentence for `sin`. `result` may
still qualify as `Box(1, 2, 3)` — the unused `sin` binding must not poison the solid.
(If the implementer drops the whole import statement instead of the one name, this test
goes red: fix the binder, do not weaken the test.)

**`from math import sqrt stays an explicit math gap`**

Same shape with `sqrt` and the matching sentence.

**`a parenthesized math import stays unqualified`**

```python
from build123d import Box
from math import (
pi
)
result = Box(1, 2, 3)
```

Assert: `python-import-not-qualified` with the new §4.7 sentence. Do **not** treat `pi`
as a scalar afterwards (`Box(pi, 1, 1)` would fail if used; this script does not use
it).

**`assignment of pi after importing it is shadowing`**

```python
from build123d import Sphere
from math import pi
pi = 3
result = Sphere(pi)
```

Assert: `python-import-shadowing` with `Assignment pi shadows a qualified math import.`
`result` is not fully qualified (the shadowing assignment is skipped, so `pi` is neither
a math scalar nor a parameter).

**`fillet keyword on a solid stays an explicit fillet gap`**

```python
from build123d import Box, fillet
result = fillet(Box(10, 10, 10), radius=2)
```

Assert: `build123d-fillet-argument-not-qualified` with the keyword `radius=` sentence in
§4.9, plus `build123d-result-not-qualified`.

### 6.4 Keep, retitle

Rename `existing qualified bundles stay bit-identical under 1.4.0` →
`existing qualified bundles stay bit-identical under 1.5.0`.

Keep the same `scripts` / `expected` tables (ids are the 1.2.0 identities already frozen
under 1.4.0). Change only the test title. Do **not** add 1.5.0 scripts to this table. Do
**not** regenerate ids.

If this test goes red, a helper changed `parameterReferences` or hashing for an
already-qualified `fillet(edges(), radius=)` / `chamfer(edges(), l)` /
`extrude(..., amount=)` / `+/-` / `Pos *` form. Stop and fix; do not regenerate the
expected ids.

The 1.4.0 placement tests already in this file
(`a left-associative Pos times Rot times solid is qualified`,
`a parenthesized Pos times Rot product times a solid is qualified`,
`a longer Pos and Rot placement chain times a solid is qualified`,
`a left-associative placement chain times a sketch then extrude is a qualified solid`,
`Rot times a sketch then extrude is a qualified solid`) must stay empty-unresolved. Do
not rewrite them.

### 6.5 Other existing tests

Leave behaviour of scale, Wedge arity, D4 rejections, named-placement gaps, and
`solid / solid` unchanged. Do not hardcode `"1.5.0"` in asserts — keep using the
exported constant.

## 7. Implementation order

1. Apply the test replacements / extensions / additions in §6. Run them — they must fail
   (red). The bit-identical test must stay green.
2. Add `Ellipse` / `RegularPolygon` to the call table and to
   `parsePositionalSketchCall`.
3. Accept positional `extrude` amount; delete the old positional sentence.
4. Rewrite `parseFilletCall` and `parseChamferCall` as in §4.4–4.5.
5. Accept `BitOp` `"&"` with the same-kind merge; do not touch `*`.
6. Add `mathScalars` plumbing and the import-loop split in §4.7. Parameters first in
   `parseStaticExpression`.
7. Bump the version constant and the docstrings / result sentence / dynamic-call
   sentence.
8. Retitle the bit-identical test.
9. Update the three reference pages (§8).
10. Run the commands in §9. Do not run the full suite until the targeted analyzer tests
    and `deno task check` are green.

## 8. Files to touch

No new module. Do not edit `deno.json` `check`.

| File                                                                 | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/adapters/analyzers/qualified-build123d-source-analyzer.ts`      | call table, math set, import loop, `mathScalars` plumbing, sketch list, extrude / fillet / chamfer, `BitOp` `&`, version `1.5.0`, header lock, result sentence, dynamic-call sentence                                                                                                                                                                                                                                                                                                                                                      |
| `src/adapters/analyzers/qualified-build123d-source-analyzer_test.ts` | §6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docs/reference/agent-workspace.md`                                  | table row `**1.5.0**`; qualify text adds `Ellipse` / `RegularPolygon`, positional extrude, short fillet/chamfer, `fillet(edges(), positional)`, same-kind `&`, math `pi`/`e`/`tau`; paragraph after the table: 1.5.0 extends 1.4.0 with that sugar, bit-identical; **Next AST lock** drops Ellipse, RegularPolygon, positional extrude amount, `fillet(solid, r)`, `chamfer(solid, l)`; keeps Polygon, Plane, named placements, extrude `taper=`/`both=`/`dir=`/`until=`, method fillet/chamfer, `.faces()`, `filter_by`, math `sin`/`cos` |
| `docs/reference/workspace-map.md`                                    | analyzer row `1.5.0` and the same qualify clause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `docs/reference/analysis-authority-pipeline.md`                      | catalogue sentence: analyzer `1.5.0`, mention the new sugars (admission table ~line 349 and the later `1.4.0` paragraph ~line 732)                                                                                                                                                                                                                                                                                                                                                                                                         |

Catalogues (`fixed-technical-compilation-profile-catalog-provider.ts`,
`initial-technical-source-analysis-composition.ts`) read the version constant — do not
hardcode `1.4.0` there. Only change them if a test hardcodes the string.

Do not edit `src/domain/engineering/geometry-script-validation.ts`.

## 9. Verification

Targeted (permissions as in CLAUDE.md; `deno task test` takes no path):

```bash
deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env \
  src/adapters/analyzers/qualified-build123d-source-analyzer_test.ts

deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env \
  src/adapters/compilers/initial-technical-source-analysis-composition_test.ts \
  src/adapters/compilers/technical-compilation-adapters_test.ts
```

If a catalogue test file sits beside
`fixed-technical-compilation-profile-catalog-provider.ts`, run that file too.

Then:

```bash
deno task check
deno task lint
deno fmt src/adapters/analyzers/qualified-build123d-source-analyzer.ts \
  src/adapters/analyzers/qualified-build123d-source-analyzer_test.ts \
  docs/reference/agent-workspace.md \
  docs/reference/workspace-map.md \
  docs/reference/analysis-authority-pipeline.md \
  docs/rfcs/qualified-build123d-1.5.0.md
```

`deno task fmt` is check-only at repo scale; write with `deno fmt <path>`.

No provider call, no Docker, no `git add` / commit unless the human asks.

## 10. Done when

- `QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION === "1.5.0"`
- Every **reachable** script in §4.8 has empty `unresolvedConstructs` (`&` scripts are
  D4-rejected, see Écart)
- Every script in §4.9 carries the listed kind and exact message
- No unresolved message contains
  `extrude requires the amount keyword; a positional amount is not qualified.`
- The bit-identical corpus matches the frozen 1.2.0 ids (test title 1.5.0)
- 1.4.0 placement tests still have empty `unresolvedConstructs`
- `pi` / `e` / `tau` never appear as symbols or dependency endpoints
- `from math import sin` / `sqrt` cannot qualify those names
- `Polygon` remains `build123d-call-not-qualified`
- `taper=` / `both=` / `until=` remain `build123d-extrude-argument-not-qualified`
- Next AST lock no longer lists Ellipse, RegularPolygon, positional extrude amount,
  `fillet(solid, r)`, or `chamfer(solid, l)`
- D4, identity scheme, and profile are untouched
- Call table gained only `Ellipse` and `RegularPolygon`
- No new file under `src/` besides edits to the existing analyzer pair
