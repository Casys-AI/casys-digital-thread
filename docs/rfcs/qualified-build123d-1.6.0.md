# RFC: qualified build123d 1.6.0 — named placements + Plane + offset + revolve + taper

Executable implementation brief for one coding session. Implement **only** this lot. Do
not start 1.7.0. Do not touch D4.

Write against the analyzer that is already on this branch:
`src/adapters/analyzers/qualified-build123d-source-analyzer.ts` at version **1.5.0**.
That file already contains `parsePlacementExpression`, left-associative `Pos`/`Rot`
chains, `Rot *` sketch, Ellipse/RegularPolygon, positional extrude amount, short
fillet/chamfer, and math scalars `pi`/`e`/`tau`. Do not re-open the 1.4.0 placement
product grammar and do not rewrite the 1.5.0 call forms.

This adapter never imports or executes Python/build123d. It proves a closed AST subset.
Anything D4 allows but this frontend cannot prove stays an explicit unresolved
construct. Previously qualified 1.2 / 1.3 / 1.4 / 1.5 bundles stay bit-identical.

If the session overflows, cut after `revolve`. Do not start `taper=` in that case; do
not add half of it.

## Écart vs draft (code réel + API 0.11.1)

### D4 still rejects `&` / `|` — do not touch D4

Same fact as 1.5.0. `ALLOWED_OPS` in
`src/domain/engineering/geometry-script-validation.ts` does **not** contain `&` or `|`.
This lot does **not** edit D4. Same-kind `&` stays parsed in the frontend and rejected
by D4 before `analyze()` reaches that branch. Public sentences still do **not** claim
`&` is qualified.

### `shell` is not a build123d 0.11.1 algebra function

The coverage draft wrote `offset/shell(solid, amount)`. The installed worker pin is
`build123d==0.11.1` (`images/build123d-microsandbox-worker/requirements.lock`). On that
tag:

- `offset` exists (`src/build123d/operations_generic.py`):

  ```
  def offset(
      objects: OffsetType | Iterable[OffsetType] | None = None,
      amount: float = 0,
      openings: Face | list[Face] | None = None,
      kind: Kind = Kind.ARC,
      side: Side = Side.BOTH,
      closed: bool = True,
      min_edge_length: float | None = None,
      mode: Mode = Mode.REPLACE,
  ) -> Curve | Sketch | Part | Compound
  ```

- `revolve` exists (`src/build123d/operations_part.py`):

  ```
  def revolve(
      profiles: Face | Iterable[Face] | None = None,
      axis: Axis = Axis.Z,
      revolution_arc: float = 360.0,
      clean: bool = True,
      mode: Mode = Mode.ADD,
  ) -> Part
  ```

- `extrude` has `taper: float = 0.0` next to the already-qualified `amount`.
- `__all__` exports `offset`, `revolve`, `extrude`, and the topology type `Shell`. It
  does **not** export a function `shell`.

D4 `ALLOWED_BUILD123D_NAMES` still contains lowercase `shell`. That is a D4-admitted
name with no 0.11.1 algebra callee. This lot **does not** invent `shell(...)`. Importing
`shell` stays `build123d-call-not-qualified`. Qualifying `offset` is the reviewed
hollow/thicken operation.

### `Plane.XY` and `Axis.Z` are **not** D4-rejected

D4 admits `Plane` and `Axis` as import names, admits `.` in `ALLOWED_OPS`, and does not
forbid `XY` / `XZ` / `YZ` / `YX` / `ZX` / `ZY` / `X` / `Y` / `Z`. Those forms reach this
frontend. Do not consigne a D4 gap for them. Do not open D4 to make them work.

`dir` remains a D4-forbidden builtin. `extrude(..., dir=...)` stays a D4 rejection, as
in 1.5.0.

## 1. Goal

Open five reviewed constructs that the 1.5.0 frontend already sees and drops:

1. Named placement bindings: `p = Pos(...)` / `p = Rot(...)` /
   `p = Pos(...) * Rot(...)`, then `p * Shape`. Today `parsePlacementExpression` (lines
   839–905) returns `undefined` on every `VariableName`. The 1.4.0 test
   `a named Pos applied to a solid stays an explicit placement gap` is that hole. The
   `VariableName` of an earlier placement becomes a placement form.
2. `Plane.XY|XZ|YZ|YX|ZX|ZY * Shape` — a **narrow** `MemberExpression` table, not a
   general attribute lock. Today `Plane.XY * Box` is `build123d-placement-not-qualified`
   plus `python-dynamic-attribute`.
3. `offset(solid, amount)` according to the real 0.11.1 signature (positional or
   `amount=`). First argument a qualified **solid**, second a closed scalar.
4. `revolve(sketch, Axis.X|Y|Z)` — `Axis` by a dedicated three-name table, not a general
   enum lock.
5. `extrude` `taper=<scalar>` in addition to the already-qualified `amount=` /
   positional amount. Today `taper=` is labelled
   `build123d-extrude-argument-not-qualified` with
   `extrude keyword taper= is not qualified; only amount= is reviewed.` (lines
   1443–1449).

Opening these together avoids a second pass over `parsePlacementExpression`, the
assignment binder, and `parseExtrudeCall`.

## 2. Non-goals (do not open)

- `Polygon(...)` / `Polygon(points)` — D4-admitted, stays `build123d-call-not-qualified`
- `from math import sin` / `cos` / `sqrt` / any other D4 math name, and any call
  `sin(...)` / `cos(...)`
- `shell(...)` as a function — not a 0.11.1 algebra export (see Écart)
- `Shell(...)` the topology constructor
- `mirror(...)`, `Mirror`, `loft`, `sweep`, `Align`, `Location`, `Vector`, class `Scale`
- `Plane(...)` / `Axis(...)` constructors, `Plane.XY.offset(...)`,
  `Axis((0, 0, 0), (0, 0, 1))`
- Named `Axis` bindings: `a = Axis.Z` then `revolve(sketch, a)`
- extrude `both=` / `dir=` / `until=`
- offset `openings=` / `kind=` / `side=` / `closed=` / `min_edge_length=` / `mode=`
- revolve `revolution_arc=` / `clean=` / `mode=` / default axis (a lone
  `revolve(sketch)` stays unproven even though 0.11.1 defaults to `Axis.Z`)
- 2-D `offset` of a sketch / face / edge
- `fillet` / `chamfer` method forms, `.faces()`, `filter_by`, every other selector
- `|` / `^` / `intersect(...)` / `solid / solid`
- General `MemberExpression` outside the existing empty `.edges()` exception and the two
  new narrow tables (`Plane.*`, `Axis.*`)
- `ALLOWED_BUILD123D_NAMES` / `ALLOWED_MATH_NAMES` / `ALLOWED_OPS` (D4)
- New analyzer modules, new `deno.json` `check` entries, new `SourceAnalysisSymbolKind`
- Changing `build123d-ast-identity/1.0` or profile `build123d-closed-subset-v1`
- Re-implementing 1.4.0 placement products or 1.5.0 sugars

## 3. Invariants the implementer must not break

| Invariant                      | Rule                                                                                                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Analyzer id                    | `build123d-qualified-lezer` unchanged                                                                                                                                                                                                                |
| Analyzer version               | `QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION = "1.6.0"`                                                                                                                                                                                              |
| Profile                        | `build123d-closed-subset-v1` unchanged                                                                                                                                                                                                               |
| Identity scheme                | `schemaVersion: "build123d-ast-identity/1.0"` in `astStableId` unchanged                                                                                                                                                                             |
| Call table                     | `QUALIFIED_BUILD123D_CALLS` gains **only** `offset` and `revolve` (both `role: "transform"`, `positionalArguments: 1`, same dummy arity as `fillet` / `chamfer` / `extrude`). Do not add `Plane`, `Axis`, or `shell`. Do not change existing arities |
| Geometry kinds                 | still only `"solid" \| "sketch"` — no placement kind, no plane kind, no axis kind                                                                                                                                                                    |
| Placement symbols              | a named placement is a `SourceAnalysisSymbol` of kind `"variable"` (same kind as shapes). Do not add a symbol kind. `Plane` / `Axis` imports are **not** symbols                                                                                     |
| Bit-identical                  | the corpus in `existing qualified bundles stay bit-identical under 1.5.0` keeps the same symbol/dependency ids; only the version string on the bundle becomes `1.6.0`. Failure message stays `` `${name} must keep its 1.2.0 analysis identity` ``   |
| 1.4.0 / 1.5.0 tests            | every script already qualified in 1.4.0 or 1.5.0 stays `unresolvedConstructs === []`                                                                                                                                                                 |
| `parsePositionalCall`          | still exact arity, no keywords, no splat. Not used for `offset` / `revolve` / `Plane` / `Axis`                                                                                                                                                       |
| `canonicalAst` / `astStableId` | unchanged                                                                                                                                                                                                                                            |
| Sketch as `result`             | still rejected, including `Plane.XY * Circle(...)` and `p * Rectangle(...)` without `extrude` / `revolve`                                                                                                                                            |
| D4                             | `src/domain/engineering/geometry-script-validation.ts` is not edited                                                                                                                                                                                 |
| `&`                            | frontend `BitOp` `"&"` path stays; public sentences still do not claim it is qualified                                                                                                                                                               |

Existing `Pos *` / `Rot *` / placement-product `*` forms must take the same helper path
and still collect the same `parameterReferences` in the same order (placement params,
then shape params). Existing `extrude(sketch, amount=)` and positional-amount forms must
still collect sketch refs then amount refs, with **no** taper slot. That is why the
frozen corpus stays bit-identical.

Do **not** invent a `SupportedParameter` / `SourceAnalysisSymbol` for `Plane` or `Axis`.
Their identity lives in the `MemberExpression` `canonicalAst` (`VariableName` +
`PropertyName`). `Plane.XY * Box` and `Plane.XZ * Box` therefore hash differently;
`Plane.XY * Box` twice hashes the same; neither bundle contains a symbol named `Plane`
or `XY`.

## 4. Constructs

### 4.1 Call table and enum import set

Add to `QUALIFIED_BUILD123D_CALLS` and to `QualifiedBuild123dCallName`:

```
["offset", { role: "transform", positionalArguments: 1 }],
["revolve", { role: "transform", positionalArguments: 1 }],
```

Extend the `Exclude<..., ...>` of `PositionalBuild123dCallName` with
`"offset" | "revolve"`.

Add a sibling set, **not** in the call table (same pattern as `QUALIFIED_MATH_SCALARS`):

```
const QUALIFIED_BUILD123D_ENUMS = new Set(["Plane", "Axis"]);
```

In the `module === "build123d"` import loop (today lines 264–289), bind a name when it
is in `QUALIFIED_BUILD123D_CALLS` **or** in `QUALIFIED_BUILD123D_ENUMS`. Otherwise keep
emitting `build123d-call-not-qualified` with the existing sentence
`build123d name ${imported} is admitted by D4 but not qualified by this frontend version.`

Record `Plane` / `Axis` in the existing `importedCalls` map. Do **not** give them a
`QUALIFIED_BUILD123D_CALLS` policy. `parsePositionalCall` never asks for them. Two
locals for `Plane` or for `Axis` reuse `build123d-import-ambiguous` (the existing
`aliasesByImported` scan already covers any `importedCalls` entry). Shadowing reuses
`python-import-shadowing` (`importedCalls.has(assignment.name)` already covers them).

Aliases already parsed by `parseNamedImport` work with no extra code:
`from build123d import Plane as P` then `P.XY * Box`.

### 4.2 Placement expression — named bindings + named planes

`PlacementExpression` today is `{ parameterReferences }`. Add
`placementReferences: readonly SupportedPlacement[]`. Every existing `Pos` / `Rot` /
product return sets `placementReferences: []`.

Add:

```
interface SupportedPlacement {
  readonly assignment: SimpleAssignment;
  readonly symbol: SourceAnalysisSymbol; // kind "variable"
  readonly parameterReferences: readonly SupportedParameter[];
  readonly placementReferences: readonly SupportedPlacement[];
}
```

`parsePlacementExpression` stays **pure** (never calls `addUnresolved`). Extend its
signature with `placements: ReadonlyMap<string, SupportedPlacement>`. Keep the existing
unwrap / `Pos` / `Rot` / `placement * placement` steps. Insert two new steps **after**
unwrap and **before** the `Pos` call:

| Step            | Lezer node                                                                                 | Rule                                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unwrap          | `ParenthesizedExpression`                                                                  | unchanged                                                                                                                                                                                                             |
| Named placement | `VariableName`                                                                             | look up `placements`. Miss, or `assignment.from >= before` → `undefined`. Hit → `{ parameterReferences: [], placementReferences: [placement] }` — **do not flatten**, same as `parseShapeExpression` on a named shape |
| Named plane     | `MemberExpression` of 3 children                                                           | `parseNamedPlane` (§4.3). Hit → `{ parameterReferences: [], placementReferences: [] }`                                                                                                                                |
| `Pos` / `Rot`   | `CallExpression`                                                                           | unchanged `parsePositionalCall`                                                                                                                                                                                       |
| Product         | `BinaryExpression` / `ArithOp` `*`                                                         | both children placements; merge `parameterReferences` **left then right** and `placementReferences` **left then right**                                                                                               |
| Anything else   | other `VariableName`, other `MemberExpression`, `Location(...)`, `Axis.*`, shapes, `+`/`-` | `undefined`                                                                                                                                                                                                           |

A `VariableName` that names a **shape** is still not a placement.

### 4.3 Named plane — narrow `MemberExpression`

Add `parseNamedPlane(node, importedCalls)` — pure.

Reviewed **iff** all of:

- `node.name === "MemberExpression"` and `node.children.length === 3`
- `[object, dot, property]`
- `object.name === "VariableName"` and
  `importedCalls.get(text(object))?.imported === "Plane"`
- `text(dot) === "."`
- `property.name === "PropertyName"`
- `text(property)` ∈ `{XY, XZ, YZ, YX, ZX, ZY}`

No arguments, no call, no further attribute (`Plane.XY.offset` is a nested
`MemberExpression` — reject). Do not accept `VariableName` as the property node. Do not
accept `Plane.X` / `Plane.Z` / `Plane.front`.

This is the only new `MemberExpression` that `parsePlacementExpression` may prove.
`.edges()` stays confined to fillet/chamfer. Do not teach `addExpressionUnresolved` to
ignore `MemberExpression` in general.

When `parseNamedPlane` succeeds, the assignment / `*` path never reaches
`addExpressionUnresolved`, so a reviewed `Plane.XY` does **not** carry
`python-dynamic-attribute`.

### 4.4 Placement times shape — updated left-operand sentence

Keep `parsePlacementTimesShape` structure (shape on the right first; do not label when
the right is not a shape). Thread `placements`. Replace only the unresolved sentence.
After 1.6.0 no unresolved message may contain the 1.4.0 / 1.5.0 text
`The left operand of * must be a Pos or Rot call, or a product of those placements.`

New exact message, still spanning **`left`**:

```
The left operand of * must be a Pos or Rot call, a product of those placements, a name bound to one of those placements, or Plane.XY|XZ|YZ|YX|ZX|ZY.
```

When `place === undefined` **and** `left` is a `MemberExpression` whose object is the
imported `Plane` and whose property is a `PropertyName` **not** in the six-name table,
**also** emit, on `left`:

```
build123d-plane-not-qualified
Plane.${name} is not a reviewed plane; reviewed planes are Plane.XY, Plane.XZ, Plane.YZ, Plane.YX, Plane.ZX, and Plane.ZY.
```

That kind is **additional**, not a replacement of `build123d-placement-not-qualified`.

Return:

```
{
  geometry: shape.geometry,
  parameterReferences: [...place.parameterReferences, ...shape.parameterReferences],
  shapeReferences: shape.shapeReferences,
  placementReferences: [...place.placementReferences, ...shape.placementReferences],
}
```

Every other `ShapeExpression` return in the file sets `placementReferences: []`.
TypeScript `check` fails if a site is forgotten; do not make the field optional.

### 4.5 Assignment binder — placements after shapes

In the module-level assignment loop (today lines 420–484), **after** the numeric branch
and **after** the shape branch, try `parsePlacementExpression` on the RHS. Shape
**before** placement is mandatory: `p = Pos(...) * Box(...)` is a shape, not a
placement.

On success:

- `symbol.kind === "variable"`, `astStableId("variable", ...)` — same prefix as shapes;
  the assignment AST differs so the digest differs
- record `SupportedPlacement` in `placementByName`
- `parameterReferences` / `placementReferences` taken from the expression, each passed
  through `uniqueParameters` / `uniquePlacements`
- `continue` — do **not** call `addExpressionUnresolved`

`result` is still skipped in this loop and still parsed only as a shape. A bare
`result = Pos(...)` / `result = p` / `result = Plane.XY` stays
`build123d-result-not-qualified`. Do not emit `build123d-placement-not-qualified` for
those (right of `result =` is not a `*` whose right child is a shape).

Replace the assignment fallthrough sentence. The 1.5.0 text becomes false the moment a
placement binding is accepted:

```
Assignment ${name} is not a closed qualified numeric expression, solid, sketch, or placement.
```

Thread `placements` through every helper that already reaches `parseShapeExpression` or
`parsePlacementExpression`:

- the module-level binder and the `result` parse (filter
  `assignment.from < result.assignment.from`, same as parameters / shapes)
- `parseShapeExpression`
- `parsePlacementExpression` / `parsePlacementTimesShape`
- `parseScaleCall` / `parseFilletCall` / `parseChamferCall` / `parseExtrudeCall` /
  `parseEmptyEdgesSelector`
- the new `parseOffsetCall` / `parseRevolveCall`

`parseCompoundCall` and `parsePositionalCall` do not need it. `parseNamedPlane` /
`parseNamedAxis` only need `importedCalls`.

Emit dependencies, empty on the frozen corpus:

- each placement: `static-value-flow` from its parameter refs, then
  `structural-incidence` from its placement refs
- each shape: existing flows, plus `structural-incidence` from its placement refs
- `result`: existing flows, plus `structural-incidence` from its placement refs

Symbol order: `[...parameters, ...placements, ...shapes, result]`. When `placements` is
empty the 1.2/1.3/1.4/1.5 array is unchanged.

Add `uniquePlacements` next to `uniqueShapes` (dedupe by `symbol.id`, first wins).

### 4.6 Offset — 0.11.1 `offset(objects, amount=...)`

Add `parseOffsetCall` next to `parseScaleCall`. Signature mirrors scale (plus
`placements`). Callee is the imported `offset` (alias OK). No splat.

Reviewed **iff** it is exactly one of:

| Form | ArgList                              | First argument        | Scalar                   |
| ---- | ------------------------------------ | --------------------- | ------------------------ |
| A    | 2 positional, no `AssignOp`          | a qualified **solid** | positional closed scalar |
| B    | 4 nodes: solid, `amount`, `=`, value | a qualified **solid** | `amount=` closed scalar  |

Match **A then B**. Kind check: `offset expects a solid, received a sketch.`
`parameterReferences` = solid refs then amount refs. `shapeReferences` /
`placementReferences` taken from the solid. Return `geometry: "solid"`.

Do **not** open `openings=` / `kind=` / `side=` / `closed=` / `min_edge_length=` /
`mode=`, a lone `offset(solid)`, `offset(amount=...)` with no object, method form, or
sketch offset.

When the callee is `offset`, there is no splat, and the call is not A/B, emit
`build123d-offset-argument-not-qualified` on the **call** node, then return `undefined`.
Additional, not a replacement of the assignment / `result` fallthrough.

| Situation                                                                                                                   | Exact message                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| At least one `AssignOp` keyword other than the reviewed B form (including `openings=`, `kind=`, `amount=` on a non-B shape) | `offset keyword ${keyword}= is not qualified; reviewed forms are offset(solid, scalar) and offset(solid, amount=scalar).` — one unresolved per keyword name, same scan as `extrudeKeywordNames` |
| No unreviewed-keyword label applied, but not A/B                                                                            | `offset arguments are not a reviewed form; reviewed forms are offset(solid, scalar) and offset(solid, amount=scalar).`                                                                          |

Do **not** emit this kind for `solid.offset(...)` (callee is a `MemberExpression`).

Call `parseOffsetCall` from `parseShapeExpression` after `parseExtrudeCall` and before
the `BinaryExpression` branch.

### 4.7 Revolve — `revolve(sketch, Axis.X\|Y\|Z)`

Add `parseNamedAxis(node, importedCalls)` — pure. Same `MemberExpression` shape as
`parseNamedPlane`, but `imported === "Axis"` and `text(property)` ∈ `{X, Y, Z}`. Unwrap
one `ParenthesizedExpression` the same way `parsePlacementExpression` does, so
`revolve(sketch, (Axis.Z))` qualifies.

Add `parseRevolveCall` next to `parseOffsetCall`. Callee is the imported `revolve`. No
splat.

Reviewed **iff** it is exactly one of:

| Form | ArgList                             | First argument         | Second argument               |
| ---- | ----------------------------------- | ---------------------- | ----------------------------- |
| A    | 2 positional, no `AssignOp`         | a qualified **sketch** | `parseNamedAxis`              |
| B    | 4 nodes: sketch, `axis`, `=`, value | a qualified **sketch** | `parseNamedAxis` on the value |

Match **A then B**. Kind check: `revolve expects a sketch, received a solid.`
`parameterReferences` / `shapeReferences` / `placementReferences` taken from the sketch
only (an `Axis` member has no refs). Return `geometry: "solid"`.

A lone `revolve(sketch)` is **not** reviewed (do not apply the 0.11.1 default `Axis.Z`).
`revolution_arc=` / `clean=` / `mode=` stay closed. `revolve(sketch, Axis.Z, 180)`
(extra positional) stays closed.

When the callee is `revolve`, there is no splat, and the call is not A/B, emit
`build123d-revolve-argument-not-qualified` on the **call** node, then return
`undefined`. Additional, not a replacement.

| Situation                                                                                       | Exact message                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| At least one `AssignOp` keyword other than the reviewed B form                                  | `revolve keyword ${keyword}= is not qualified; reviewed forms are revolve(sketch, Axis.X\|Y\|Z) and revolve(sketch, axis=Axis.X\|Y\|Z).` — one unresolved per keyword                         |
| Second argument is a `MemberExpression` of imported `Axis` whose property is not in `{X, Y, Z}` | **also** `build123d-axis-not-qualified` on that member: `Axis.${name} is not a reviewed axis; reviewed axes are Axis.X, Axis.Y, and Axis.Z.` plus the no-keyword revolve sentence on the call |
| No keyword, but not A (1-arg, 3+ positional, first not a sketch, second not a reviewed Axis)    | `revolve arguments are not a reviewed form; reviewed forms are revolve(sketch, Axis.X\|Y\|Z) and revolve(sketch, axis=Axis.X\|Y\|Z).`                                                         |

Do **not** emit the revolve kind for `sketch.revolve(...)`.

Call `parseRevolveCall` from `parseShapeExpression` immediately after `parseOffsetCall`.

### 4.8 Extrude — `taper=<scalar>`

Keep both reviewed amount paths (keyword `amount=` first, then positional). They must
still return sketch refs then amount refs when `taper` is absent.

Change the unreviewed-keyword filter (today lines 1443–1449). `amount` and `taper` are
reviewed. Any other keyword still emits `build123d-extrude-argument-not-qualified` with
the **new** sentence:

```
extrude keyword ${keyword}= is not qualified; only amount= and taper= are reviewed.
```

After 1.6.0 no unresolved message may contain `only amount= is reviewed.`

When `taper=` is present:

- its value must be a closed scalar (including a math scalar)
- `amount` is still required (`amount=` or a positional amount)
- `parameterReferences` = sketch refs, then amount refs, then taper refs
- if `taper=` is present and `amount` is missing, keep the existing no-amount sentence
  `extrude requires amount= or a positional amount.` on the call — do **not** treat
  `taper` as an unreviewed keyword

Concrete accepted trees (Lezer `isArgumentExpression` counts):

| Source                               | How amount is found        | How taper is found |
| ------------------------------------ | -------------------------- | ------------------ |
| `extrude(sketch, amount=5)`          | existing 4-node path       | absent             |
| `extrude(sketch, 5)`                 | existing 2-positional path | absent             |
| `extrude(sketch, amount=5, taper=1)` | keyword `amount`           | keyword `taper`    |
| `extrude(sketch, 5, taper=1)`        | positional amount          | keyword `taper`    |
| `extrude(sketch, taper=1, amount=5)` | keyword `amount`           | keyword `taper`    |

Do not require a single `expressions.length`. Walk keywords with `extrudeKeywordNames`
and pair each keyword with the argument node that follows its `AssignOp`. If `amount` is
supplied both positionally and as a keyword, the call is not reviewed (no-keyword /
not-A/B fallthrough does not apply; emit the no-reviewed-form sentence only if you
cannot match a row above — prefer labelling nothing new beyond the existing amount /
keyword machinery).

`both=` / `until=` stay labelled with the new sentence. `dir=` remains a D4
`geometry-script-forbidden-name` rejection.

### 4.9 Forms that become qualified

| Source form                                                           | Genre                                                                 |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `p = Pos(1, 2, 3)` then `p * Box(10, 20, 30)`                         | `p` is a placement variable; product is `solid` — valid `result`      |
| `p = Rot(0, 0, 45)` then `p * Box(10, 20, 30)`                        | `solid`                                                               |
| `p = Pos(1, 2, 3) * Rot(0, 0, 45)` then `p * Cylinder(4, 12)`         | `solid`                                                               |
| `p = Pos(1, 2, 3)` then `q = p` then `q * Box(10, 20, 30)`            | `q` is a placement variable (name of a placement); product is `solid` |
| `p = (Pos(1, 2, 3) * Rot(0, 0, 45))` then `p * Box(...)`              | `solid`                                                               |
| `p = Pos(1, 2, 3)` then `extrude(p * Rectangle(10, 20), 5)`           | `solid`                                                               |
| `Plane.XY * Box(10, 20, 30)`                                          | `solid`                                                               |
| `Plane.XZ * Circle(3)` then extrude / revolve                         | `sketch` then `solid`                                                 |
| `Plane.YZ` / `Plane.YX` / `Plane.ZX` / `Plane.ZY *` a qualified shape | same-kind as the shape                                                |
| `from build123d import Plane as P` then `P.XY * Box(...)`             | `solid`                                                               |
| `p = Plane.XY` then `p * Box(...)`                                    | `p` is a placement; product is `solid` (composition of §4.2 + §4.3)   |
| `p = Pos(1, 2, 3) * Plane.XY` then `p * Box(...)`                     | placement product; `solid`                                            |
| `offset(Box(10, 10, 10), 2)`                                          | `solid`                                                               |
| `offset(Box(10, 10, 10), amount=2)`                                   | `solid`                                                               |
| `offset(base, wall)` with `base` a solid and `wall` a parameter       | `solid`                                                               |
| `offset(p * Box(10, 10, 10), 2)`                                      | `solid`                                                               |
| `revolve(Circle(3), Axis.Z)`                                          | `solid` — valid `result`                                              |
| `revolve(Circle(3), axis=Axis.X)`                                     | `solid`                                                               |
| `revolve(Plane.XZ * Circle(3), Axis.Y)`                               | `solid`                                                               |
| `revolve(Rectangle(10, 20), (Axis.Z))`                                | `solid`                                                               |
| `extrude(Rectangle(10, 20), amount=5, taper=1)`                       | `solid`                                                               |
| `extrude(Rectangle(10, 20), 5, taper=1)`                              | `solid`                                                               |
| `extrude(Circle(pi), 5, taper=2)` after `from math import pi`         | `solid`; no symbol `pi`                                               |

Aliases already accepted for build123d callees keep working. Do not add alias-specific
code.

`from build123d import Plane, Box` then `result = Box(1, 2, 3)` (unused `Plane`) stays
fully qualified — same as unused `from math import sin` must not poison a `Box` (1.5.0).
Unused `Axis` is the same.

### 4.10 Forms that stay closed, now labelled

| Source form                                                                   | Why it fails                       | Kind                                                                         | Exact message                                                                        | Span                                  |
| ----------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------- |
| `from build123d import Polygon` then `Polygon([(0, 0), (1, 0), (0, 1)])`      | not in the call table              | `build123d-call-not-qualified` (+ dynamic-call / result)                     | existing import sentence with `Polygon`                                              | import name                           |
| `from build123d import shell` then `shell(Box(10, 10, 10), 2)`                | no 0.11.1 `shell` function (Écart) | `build123d-call-not-qualified` (+ dynamic-call / result)                     | `build123d name shell is admitted by D4 but not qualified by this frontend version.` | import name                           |
| `from build123d import Shell` then `Shell(...)`                               | topology type, not this lot        | `build123d-call-not-qualified`                                               | existing import sentence with `Shell`                                                | import name                           |
| `from build123d import Vector` then `v = Vector(1, 0, 0)` then `v * Box(...)` | `v` is not a placement             | `build123d-placement-not-qualified` (+ import / result)                      | new §4.4 left-operand sentence                                                       | the `v` on the `*`                    |
| `Location(1, 2, 3) * Box(...)`                                                | unchanged gap                      | `build123d-placement-not-qualified` + `build123d-call-not-qualified`         | new §4.4 sentence                                                                    | the `Location(...)` call              |
| `Scale(2) * Box(...)`                                                         | unchanged gap                      | same                                                                         | new §4.4 sentence                                                                    | the `Scale(...)` call                 |
| `Box(1, 2, 3) * Cylinder(4, 12)`                                              | left is a shape                    | `build123d-placement-not-qualified`                                          | new §4.4 sentence                                                                    | the `Box(...)` call                   |
| `Plane.X * Box(...)`                                                          | not in the six-name table          | `build123d-plane-not-qualified` + `build123d-placement-not-qualified`        | §4.4 plane sentence with `X`                                                         | left member                           |
| `Plane.front * Box(...)`                                                      | same                               | same kinds                                                                   | §4.4 plane sentence with `front`                                                     | left member                           |
| `Axis.Z * Box(...)`                                                           | `Axis` is not a placement          | `build123d-placement-not-qualified` (+ `python-dynamic-attribute`)           | new §4.4 sentence                                                                    | the `Axis.Z` member                   |
| `result = Plane.XY`                                                           | proven placement, not a solid      | `build123d-result-not-qualified` (+ `python-dynamic-attribute`)              | existing result sentence (updated §5)                                                | result RHS                            |
| `result = p` after `p = Pos(1, 2, 3)`                                         | placement is not a solid           | `build123d-result-not-qualified`                                             | updated result sentence                                                              | result RHS                            |
| `result = Plane.XY * Circle(3)`                                               | proven sketch                      | kind-mismatch + result                                                       | `result expects a solid, received a sketch.`                                         | result RHS                            |
| `a = Axis.Z` then `revolve(Circle(3), a)`                                     | named Axis not opened              | `build123d-revolve-argument-not-qualified` (+ assignment fallthrough on `a`) | no-keyword revolve sentence                                                          | the revolve call / the `a` assignment |
| `revolve(Circle(3))`                                                          | default axis not reviewed          | `build123d-revolve-argument-not-qualified`                                   | no-keyword revolve sentence                                                          | the call                              |
| `revolve(Box(1, 2, 3), Axis.Z)`                                               | solid profile                      | `build123d-geometry-kind-mismatch`                                           | `revolve expects a sketch, received a solid.`                                        | first argument                        |
| `revolve(Circle(3), Axis.W)`                                                  | not in the three-name table        | `build123d-axis-not-qualified` + `build123d-revolve-argument-not-qualified`  | §4.7 axis sentence with `W` + no-keyword revolve sentence                            | member / call                         |
| `revolve(Circle(3), Axis.Z, 180)`                                             | extra positional                   | `build123d-revolve-argument-not-qualified`                                   | no-keyword revolve sentence                                                          | the call                              |
| `revolve(Circle(3), axis=Axis.Z, revolution_arc=180)`                         | unreviewed kwarg                   | `build123d-revolve-argument-not-qualified`                                   | keyword `revolution_arc=` sentence                                                   | the call                              |
| `offset(Rectangle(10, 20), 2)`                                                | sketch                             | `build123d-geometry-kind-mismatch`                                           | `offset expects a solid, received a sketch.`                                         | first argument                        |
| `offset(Box(10, 10, 10))`                                                     | no amount                          | `build123d-offset-argument-not-qualified`                                    | no-keyword offset sentence                                                           | the call                              |
| `offset(Box(10, 10, 10), 2, openings=1)`                                      | unreviewed kwarg                   | same kind                                                                    | `offset keyword openings= ...`                                                       | the call                              |
| `offset(Box(10, 10, 10), kind=1)`                                             | unreviewed kwarg, no amount form   | same kind                                                                    | `offset keyword kind= ...`                                                           | the call                              |
| `extrude(Rectangle(10, 20), amount=5, both=1)`                                | unreviewed kwarg                   | `build123d-extrude-argument-not-qualified`                                   | new `... both= ... only amount= and taper= are reviewed.`                            | the call                              |
| `extrude(Rectangle(10, 20), amount=5, until=1)`                               | same                               | same kind                                                                    | `... until= ...`                                                                     | the call                              |
| `extrude(Rectangle(10, 20), taper=1)`                                         | taper without amount               | same kind                                                                    | `extrude requires amount= or a positional amount.`                                   | the call                              |
| `extrude(Rectangle(10, 20), amount=5, dir=1)`                                 | D4 forbids `dir`                   | D4 `geometry-script-forbidden-name`                                          | server-owned D4 sentence                                                             | whole script                          |
| `from math import sin`                                                        | unchanged 1.5.0 gap                | `math-name-not-qualified`                                                    | existing 1.5.0 sentence                                                              | the `sin` name                        |
| `Rectangle(10, 20) & Circle(4)`                                               | D4 rejects `&`                     | D4 `geometry-script-unrecognized-token`                                      | server-owned D4 sentence                                                             | whole script                          |
| `solid.offset(2)` / `sketch.revolve(Axis.Z)`                                  | method form                        | existing dynamic kinds only                                                  | **do not** emit `*-argument-not-qualified`                                           | the member / call                     |

## 5. Docstring and result sentence

Module header (replace the placement / extrude bullets and the Next AST lock):

- named imports of Box, Cylinder, Cone, Sphere, Torus, Ellipsoid, Wedge, Rectangle,
  Circle, Ellipse, RegularPolygon, Pos, Rot, Compound, scale, fillet, chamfer, extrude,
  offset and revolve; plus named imports of `Plane` and `Axis` used only by the reviewed
  member tables;
- unique module-level placement assignments: a `Pos`/`Rot` call, a product of those
  placements, a name of an earlier placement, or `Plane.XY|XZ|YZ|YX|ZX|ZY`;
- unique module-level shape assignments: … a Pos/Rot/named-placement/ named-Plane
  product times a qualified solid or sketch (kind preserved), …
  `offset(<qualified-solid>, amount=<scalar> or positional <scalar>)`,
  `revolve(<qualified-sketch>, Axis.X|Y|Z or axis=Axis.X|Y|Z)`,
  `extrude(<qualified-sketch>, amount=<scalar> or positional <scalar>,
  optional taper=<scalar>)`,
  …;
- Next AST lock (not opened here): Polygon; `shell` (not a 0.11.1 algebra function);
  `Plane()` / `Axis()` constructors; `Location` / `Vector` / class `Scale`; extrude
  `both=`/`dir=`/`until=`; offset `openings=` / `kind=` / `side=` / `closed=` /
  `min_edge_length=` / `mode=`; revolve `revolution_arc=`; named `Axis` bindings; fillet
  / chamfer method forms; general `MemberExpression`, `.faces()`, `filter_by`; math
  `sin`/`cos` and every other D4 math name; `&` / `|` (D4 `ALLOWED_OPS` rejects them
  before this frontend runs); loft / sweep / Align / mirror.

Version comment above `QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION`:

```
* Named Pos/Rot placement bindings, Plane.XY|XZ|YZ|YX|ZX|ZY * shape,
* offset(solid, amount), revolve(sketch, Axis.X|Y|Z), and extrude
* taper=scalar reuse the 1.2/1.3/1.4/1.5 identity scheme
* (build123d-ast-identity/1.0). Previously qualified bundles stay
* bit-identical. shell is not a 0.11.1 algebra function; D4 still
* admits the import name. Same-kind & is parsed here but D4 rejects
* the token.
```

Version constant: `"1.6.0"`.

Update the `build123d-result-not-qualified` sentence. Replace only the placement /
extrude clauses so it reads:

```
result must be one qualified solid: Box/Cylinder/Cone/Sphere/Torus/Ellipsoid/Wedge, Pos/Rot/named-placement/Plane.XY|XZ|YZ|YX|ZX|ZY * solid or sketch then extrude or revolve, solid +/− solid, scale(solid, scalar), fillet(solid, scalar) or fillet(solid.edges(), radius=scalar or positional scalar), chamfer(solid, scalar) or chamfer(solid.edges(), scalar), extrude(sketch, amount=scalar or positional scalar, optional taper=scalar), offset(solid, amount=scalar or positional scalar), revolve(sketch, Axis.X|Y|Z), or Compound(children=[...]). A sketch is never a valid result.
```

Do not otherwise rewrite that sentence. This change does not touch bit-identical ids
(those bundles have empty `unresolvedConstructs`).

Update the `python-dynamic-call` sentence in `addExpressionUnresolved` so the
reviewed-call list includes `offset` and `revolve` after `extrude`.

## 6. Tests — invariant sentences

Use `@std/assert` only. Names are full sentences. Keep `INPUT` as in the existing file.
Version asserts stay on `QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION`.

### 6.1 Replace

**`a named Pos applied to a solid stays an explicit placement gap`**

Rename to `a named Pos applied to a solid is a qualified solid`.

The current script must now have `unresolvedConstructs === []`,
`policy.status === "passed"`, `result` kind `"artifact"`:

```python
from build123d import Box, Pos
p = Pos(1, 2, 3)
result = p * Box(10, 20, 30)
```

Assert symbols include `p` (kind `"variable"`) and `result` (kind `"artifact"`). Assert
one `structural-incidence` edge `p → result`. No symbol named `Pos`.

**`extrude rejects taper, both, dir, and until`**

Rename to `extrude rejects both, dir, and until`. Drop the `taper=1` script from
`frontendRejected`. Keep `both=` / `until=` labelled
`build123d-extrude-argument-not-qualified` and assert the **new** sentence containing
`only amount= and taper= are reviewed.` Keep the `dir=` D4 rejection block unchanged.

### 6.2 Extend

**`a sketch is never a valid result`** — append:

```python
from build123d import Circle, Plane
result = Plane.XY * Circle(3)
```

```python
from build123d import Pos, Rectangle
p = Pos(1, 2, 3)
result = p * Rectangle(10, 20)
```

Same asserts as the Rectangle/Circle/Ellipse cases
(`result expects a solid, received a sketch.`).

**`a bare Pos, Rot, or Compound without named children stays unresolved`** — keep every
script. After 1.6.0 `result = Pos(...)` is still not a solid (the binder for `result`
never calls `parsePlacementExpression`). Do not weaken this test.

**`Location or Scale times a solid stays an explicit placement gap`** — keep both
scripts. They must now match the **new** §4.4 left-operand sentence (not the 1.5.0
sentence).

**`scale kwargs, one-arg, or non-uniform factors stay unresolved`** — keep the
`Scale(2) * Box` assertion of `build123d-placement-not-qualified`.

### 6.3 Add

Use these exact names and these exact scripts (whitespace as written).

**`a named Rot applied to a solid is a qualified solid`**

```python
from build123d import Box, Rot
p = Rot(0, 0, 45)
result = p * Box(10, 20, 30)
```

No unresolved, status `passed`, `result` is `artifact`, symbol `p` is `variable`.

**`a named Pos times Rot product applied to a solid is a qualified solid`**

```python
from build123d import Cylinder, Pos, Rot
p = Pos(1, 2, 3) * Rot(0, 0, 45)
result = p * Cylinder(4, 12)
```

Same asserts.

**`a placement name can be rebound as another placement name`**

```python
from build123d import Box, Pos
p = Pos(1, 2, 3)
q = p
result = q * Box(10, 20, 30)
```

No unresolved. Symbols include `p` and `q` (both `"variable"`). `structural-incidence`
edges `p → q` and `q → result`.

**`a named Pos times a sketch then extrude is a qualified solid`**

```python
from build123d import Pos, Rectangle, extrude
p = Pos(1, 2, 3)
result = extrude(p * Rectangle(10, 20), 5)
```

Same no-unresolved / `artifact` asserts.

**`Plane.XY times a solid is a qualified solid`**

```python
from build123d import Box, Plane
result = Plane.XY * Box(10, 20, 30)
```

No unresolved, status `passed`, `result` is `artifact`, **no** symbol named `Plane` or
`XY`.

**`each named Plane times a Circle then extrude is a qualified solid`**

Six scripts, one per name `XY`, `XZ`, `YZ`, `YX`, `ZX`, `ZY`:

```python
from build123d import Circle, Plane, extrude
result = extrude(Plane.XY * Circle(3), 5)
```

(and the same with `Plane.XZ` … `Plane.ZY`). Each: no unresolved, status `passed`,
`result` is `artifact`.

**`an aliased Plane times a solid is a qualified solid`**

```python
from build123d import Box, Plane as P
result = P.XY * Box(10, 20, 30)
```

Same no-unresolved / no-symbol-`P` / no-symbol-`XY` asserts.

**`a Plane binding applied to a solid is a qualified solid`**

```python
from build123d import Box, Plane
p = Plane.XY
result = p * Box(10, 20, 30)
```

No unresolved. Symbol `p` is `variable`. `structural-incidence` `p → result`.

**`Plane.XY and Plane.XZ do not share an artifact identity`**

Analyze `Plane.XY * Box(10, 20, 30)` and `Plane.XZ * Box(10, 20, 30)` (each with
`from build123d import Box, Plane`). Assert the two `result` symbol ids differ.

**`offset of a solid by a positional amount is qualified`**

```python
from build123d import Box, offset
result = offset(Box(10, 10, 10), 2)
```

```python
from build123d import Box, offset
base = Box(10, 10, 10)
wall = 2
result = offset(base, wall)
```

```python
from build123d import Box, offset
result = offset(Box(10, 10, 10), amount=2)
```

Each: no unresolved, status `passed`, `result` is `artifact`. The named `wall` script
must expose symbols `base` (variable), `wall` (parameter), `result` (artifact) and
`structural-incidence` edges `base → result` and `wall → result`.

**`revolve of a sketch about Axis.Z is a qualified solid`**

```python
from build123d import Axis, Circle, revolve
result = revolve(Circle(3), Axis.Z)
```

```python
from build123d import Axis, Circle, revolve
result = revolve(Circle(3), axis=Axis.X)
```

```python
from build123d import Axis, Circle, Plane, revolve
result = revolve(Plane.XZ * Circle(3), Axis.Y)
```

Each: no unresolved, status `passed`, `result` is `artifact`, **no** symbol named `Axis`
/ `X` / `Y` / `Z`.

**`extrude accepts taper= on a qualified sketch`**

```python
from build123d import Rectangle, extrude
result = extrude(Rectangle(10, 20), amount=5, taper=1)
```

```python
from build123d import Rectangle, extrude
result = extrude(Rectangle(10, 20), 5, taper=1)
```

Each: no unresolved, status `passed`, `result` is `artifact`.

**`a named Vector applied to a solid stays an explicit placement gap`**

```python
from build123d import Box, Vector
v = Vector(1, 0, 0)
result = v * Box(10, 20, 30)
```

Assert: `build123d-call-not-qualified` (import `Vector`),
`build123d-placement-not-qualified` with the exact §4.4 sentence,
`build123d-result-not-qualified`.

**`an unreviewed Plane member times a solid stays an explicit plane gap`**

```python
from build123d import Box, Plane
result = Plane.X * Box(10, 20, 30)
```

Assert: `build123d-plane-not-qualified` with
`Plane.X is not a reviewed plane; reviewed planes are Plane.XY, Plane.XZ, Plane.YZ, Plane.YX, Plane.ZX, and Plane.ZY.`,
**and** `build123d-placement-not-qualified` with the §4.4 sentence, **and**
`build123d-result-not-qualified`.

**`Axis times a solid is not a placement product`**

```python
from build123d import Axis, Box
result = Axis.Z * Box(10, 20, 30)
```

Assert: `build123d-placement-not-qualified` with the §4.4 sentence,
`build123d-result-not-qualified`. Do **not** emit `build123d-plane-not-qualified` or
`build123d-axis-not-qualified` (Axis is not being read as a revolve argument here).

**`shell stays an explicit call gap`**

```python
from build123d import Box, shell
result = shell(Box(10, 10, 10), 2)
```

Assert: `build123d-call-not-qualified` with the existing import sentence for `shell`,
plus `build123d-result-not-qualified` and `python-dynamic-call`. This is the 0.11.1
écart guard.

**`offset of a sketch stays an explicit kind mismatch`**

```python
from build123d import Rectangle, offset
result = offset(Rectangle(10, 20), 2)
```

Assert: `build123d-geometry-kind-mismatch` with
`offset expects a solid, received a sketch.`, `build123d-result-not-qualified`.

**`offset openings or missing amount stays an explicit offset gap`**

```python
from build123d import Box, offset
result = offset(Box(10, 10, 10), 2, openings=1)
```

```python
from build123d import Box, offset
result = offset(Box(10, 10, 10))
```

First script: `build123d-offset-argument-not-qualified` with the `openings=` sentence in
§4.10. Second script: the no-keyword offset sentence. Both also carry
`build123d-result-not-qualified`.

**`revolve of a solid or without an Axis stays an explicit revolve gap`**

```python
from build123d import Axis, Box, revolve
result = revolve(Box(10, 10, 10), Axis.Z)
```

```python
from build123d import Circle, revolve
result = revolve(Circle(3))
```

```python
from build123d import Axis, Circle, revolve
result = revolve(Circle(3), Axis.W)
```

First: `build123d-geometry-kind-mismatch` with
`revolve expects a sketch, received a solid.` Second:
`build123d-revolve-argument-not-qualified` with the no-keyword sentence. Third:
`build123d-axis-not-qualified` with the §4.7 `Axis.W` sentence **and**
`build123d-revolve-argument-not-qualified`. All three: `build123d-result-not-qualified`.

**`a named Axis applied to revolve stays an explicit revolve gap`**

```python
from build123d import Axis, Circle, revolve
a = Axis.Z
result = revolve(Circle(3), a)
```

Assert: `build123d-revolve-argument-not-qualified` with the no-keyword sentence,
`build123d-result-not-qualified`. `a = Axis.Z` is not a placement and not a parameter —
it carries `python-dynamic-attribute` and `python-parameter-expression-not-qualified`
with the new §4.5 sentence.

**`extrude taper without amount stays an explicit extrude gap`**

```python
from build123d import Rectangle, extrude
result = extrude(Rectangle(10, 20), taper=1)
```

Assert: `build123d-extrude-argument-not-qualified` with
`extrude requires amount= or a positional amount.`, `build123d-result-not-qualified`. Do
**not** emit a keyword sentence for `taper=`.

### 6.4 Keep, retitle

Rename `existing qualified bundles stay bit-identical under 1.5.0` →
`existing qualified bundles stay bit-identical under 1.6.0`.

Keep the same `scripts` / `expected` tables (ids are the 1.2.0 identities already frozen
under 1.4.0 / 1.5.0). Change only the test title. Do **not** add 1.6.0 scripts to this
table. Do **not** regenerate ids.

If this test goes red, a helper changed `parameterReferences` or hashing for an
already-qualified `fillet(edges(), radius=)` / `chamfer(edges(), l)` /
`extrude(..., amount=)` / `+/-` / `Pos *` / Ellipse / math-scalar form. Stop and fix; do
not regenerate the expected ids.

The 1.4.0 placement tests and the 1.5.0 sugar tests already in this file must stay
empty-unresolved. Do not rewrite them.

### 6.5 Other existing tests

Leave behaviour of scale, Wedge arity, D4 rejections (`&` / `|` / `dir=`), math `sin` /
`sqrt`, Polygon, `solid / solid`, and fillet / chamfer method forms unchanged. Do not
hardcode `"1.6.0"` in asserts — keep using the exported constant.

The ampersand / bitwise-or D4 tests stay as they are. This lot does not re-open them.

## 7. Implementation order

1. Apply the test replacements / extensions / additions in §6 **except** the `taper=`
   tests if you already know you will cut. Run them — they must fail (red). The
   bit-identical test must stay green.
2. Admit `Plane` / `Axis` in the import loop (§4.1). Add `SupportedPlacement`, extend
   `PlacementExpression` / `ShapeExpression`, thread `placements`.
3. Named `VariableName` lookup in `parsePlacementExpression`. Placement branch in the
   assignment binder (§4.5). Update the left-operand sentence (§4.4).
4. `parseNamedPlane` and the `Plane.*` step. Plane-gap kind.
5. Add `offset` / `revolve` to the call table. `parseOffsetCall`. `parseNamedAxis` +
   `parseRevolveCall`.
6. Accept `taper=` in `parseExtrudeCall` (§4.8). Skip this step entirely if the session
   overflows — do not land a partial keyword filter.
7. Bump the version constant and the docstrings / result sentence / assignment sentence
   / dynamic-call sentence.
8. Retitle the bit-identical test.
9. Update the three reference pages (§8).
10. Run the commands in §9. Do not run the full suite until the targeted analyzer tests
    and `deno task check` are green.

## 8. Files to touch

No new module. Do not edit `deno.json` `check`.

| File                                                                 | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/adapters/analyzers/qualified-build123d-source-analyzer.ts`      | enum set, call table `offset`/`revolve`, placement bindings, `parseNamedPlane` / `parseNamedAxis`, `parseOffsetCall` / `parseRevolveCall`, extrude `taper=`, version `1.6.0`, header lock, result / assignment / dynamic-call / left-operand sentences                                                                                                                                                                                                                                                                                  |
| `src/adapters/analyzers/qualified-build123d-source-analyzer_test.ts` | §6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/reference/agent-workspace.md`                                  | table row `**1.6.0**`; qualify text adds named `Pos`/`Rot` bindings, `Plane.XY\|…\|ZY *` shape, `offset(solid, amount)`, `revolve(sketch, Axis.X\|Y\|Z)`, extrude `taper=`; paragraph after the table: 1.6.0 extends 1.5.0 with those forms, bit-identical, `shell` not opened, `&` still D4-rejected; **Next AST lock** drops named placements, Plane placements, offset/revolve, `taper=`; keeps Polygon, `shell`, `both=`/`dir=`/`until=`, method fillet/chamfer, `.faces()`, `filter_by`, math `sin`/`cos`, loft/sweep/Align/mirror |
| `docs/reference/workspace-map.md`                                    | analyzer row `1.6.0` and the same qualify clause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/reference/analysis-authority-pipeline.md`                      | catalogue sentence: analyzer `1.6.0`, mention the new forms (admission table ~line 349 and the later `1.5.0` paragraph ~line 732)                                                                                                                                                                                                                                                                                                                                                                                                       |

Catalogues (`fixed-technical-compilation-profile-catalog-provider.ts`,
`initial-technical-source-analysis-composition.ts`) read the version constant — do not
hardcode `1.5.0` there. Only change them if a test hardcodes the string.

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
  docs/rfcs/qualified-build123d-1.6.0.md
```

`deno task fmt` is check-only at repo scale; write with `deno fmt <path>`.

No provider call, no Docker, no `git add` / commit unless the human asks.

## 10. Done when

- `QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION === "1.6.0"`
- Every reachable script in §4.9 has empty `unresolvedConstructs`
- Every script in §4.10 carries the listed kind and exact message
- No unresolved message contains
  `The left operand of * must be a Pos or Rot call, or a product of those placements.`
- No unresolved message contains `only amount= is reviewed.`
- The bit-identical corpus matches the frozen 1.2.0 ids (test title 1.6.0)
- 1.4.0 placement tests and 1.5.0 sugar tests still have empty `unresolvedConstructs`
- `Plane` / `Axis` / `XY` / `Z` never appear as symbols or dependency endpoints
- `p = Pos(...)` then `p * Shape` is no longer a placement gap
- `shell` remains `build123d-call-not-qualified`
- `Polygon` remains `build123d-call-not-qualified`
- `both=` / `until=` remain `build123d-extrude-argument-not-qualified`
- `dir=` remains a D4 rejection
- `&` / `|` remain D4 rejections; D4 is untouched
- Next AST lock no longer lists named `Pos`/`Rot` bindings, Plane placements,
  `offset`/`revolve`, or extrude `taper=`
- Identity scheme and profile are untouched
- Call table gained only `offset` and `revolve`
- No new file under `src/` besides edits to the existing analyzer pair
