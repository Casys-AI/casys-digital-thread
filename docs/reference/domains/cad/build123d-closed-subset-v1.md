# Reference: Build123d closed subset v1

Audience: both · Diátaxis: reference · Kind: contract

The current CAD language is not Python or build123d in general. It is the server-owned
profile `build123d-closed-subset-v1`, compiled as profile `3.0.0` by analyzer
`build123d-qualified-lezer` `1.6.0`.

Code authorities:

- [D4 execution-surface validator](../../../../src/domain/cad/source/geometry-script-validation.ts)
- [qualified source analyzer](../../../../src/adapters/cad/source/qualified-build123d-source-analyzer.ts)
- [technical compilation profile](../../../../src/domain/compile/admission/technical-compilation.ts)

## Three fail-closed gates

```text
exact UTF-8 source
  → D4 reachability policy
  → parser-backed qualified subset
  → compilation admission and SysML joins
```

Passing one gate never implies passing the next.

### D4: what source can reach execution

D4 accepts only explicit named imports from its build123d allowlist and from its math
allowlist. It rejects wildcard or arbitrary imports, dangerous names, dunder access,
known I/O and serialization attributes, raw/bytes/f-strings, the walrus operator,
non-finite literals, and unrecognized tokens. `result` must be assigned exactly once at
module level.

The effective hard ceilings are **64 KiB** and **8,000 tokenizer entries**. D4 admits at
most 8000 tokenizer entries and rejects the 8001st. The outer source-capture ceiling of
262,144 bytes does not widen D4. D4 is a reachability guard, not semantic qualification
and not the sandbox boundary. Inventory: [CAD boundedness](boundedness.md).

### Analyzer 1.6.0: what is understood today

Only these forms can finish with no `unresolvedConstructs`:

- Explicit named imports, with aliases, for the constructs used below; math scalars are
  limited to `pi`, `e`, and `tau`.
- Module-level values made from finite decimal literals, unary and binary arithmetic,
  earlier values, those math scalars, and reviewed flat lists.
- Solids: `Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, and `Wedge`.
- Sketches: `Rectangle`, `Circle`, `Ellipse`, and `RegularPolygon`.
- Placements: `Pos`, `Rot`, earlier named placements, their left-associative products,
  and `Plane.XY|XZ|YZ|YX|ZX|ZY` applied to a solid or sketch.
- Same-kind `+` and `-`; a solid and a sketch cannot be combined.
- `scale(solid, scalar)`.
- `fillet(solid, scalar)` or the reviewed `solid.edges()` forms.
- `chamfer(solid, scalar)` or the reviewed `solid.edges()` forms.
- `extrude(sketch, amount, taper=...)`, with the reviewed positional or keyword forms.
- `offset(solid, amount)` and `revolve(sketch, Axis.X|Y|Z)` in their reviewed forms.
- `Compound(children=[...])` over earlier solid names.
- Exactly one module-level `result`, and it must resolve to a solid.

The analyzer hand table also contains `Ellipsoid`, but that name is absent from the
pinned build123d 0.11.1 inventory. It is a known phantom, not an executable CAD
capability; do not use it.

## What remains unresolved or rejected

D4-allowed syntax that the analyzer cannot prove remains explicit `unresolved`; it is
never accepted by omission. Current examples include builders and `with` blocks, loops,
comprehensions, functions, classes, lambdas, general method or selector chains, `loft`,
`sweep`, `mirror`, arbitrary `Plane` or `Axis` construction, and unreviewed arguments to
otherwise known calls. A sketch as `result` is unresolved. D4 rejects `&` and `|` before
semantic analysis.

The pinned inventory contains 473 public build123d 0.11.1 names. The 1.6.0 analyzer is a
bootstrap hand table, not complete coverage of that finite language. The accepted
direction is documented in
[closed-language compilation](../../../explanations/product/closed-language-compilation.md);
future coverage does not change the current contract.

## Compilation admission 3.0.0

Parser success is not admission. A new Build123d compilation is reviewable only when:

- the analysis has no unresolved construct;
- required artifact and parameter symbols have unique server-derived SysML bindings;
- at least one finite, module-level named numeric literal causally reaches `result`;
- that lever is joined through `parameterizes`, while the result artifact is joined
  through `represents`.

A constructor literal with no named lever is `source.no-named-numeric-lever`. A
reachable lever without its SysML join is `binding.missing`. The server does not invent
a lever, AttributeUsage, unit, or value. This is a clean cut: there is no legacy-profile
reader or replay compatibility path for Build123d admissions.
