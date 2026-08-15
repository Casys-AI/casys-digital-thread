# Explanation: closed-language compilation

Direction set by the product owner on 2026-08-15: **we compile closed languages, and we
aim to compile them completely.** This page explains what that means, why it is the
doctrine, and where the direction lives in the repository so the code explains itself.

## The principle

Agent freedom never comes from _opening_ a language. It comes from _fully covering_ a
**closed** one.

Closed means: finite, enumerable, and pinned by version. The engineering languages this
product compiles are all closed in that sense:

- **build123d 0.11.1** exposes exactly **473 public names** (224 classes, 100 functions,
  43 enums, 106 values). That is not an estimate — it is the introspected inventory in
  [`config/build123d-api/inventory-0.11.1.json`](../../config/build123d-api/inventory-0.11.1.json),
  regenerated at will by
  [`scripts/probes/capture-build123d-api-inventory.ts`](../../scripts/probes/capture-build123d-api-inventory.ts)
  against the pinned sandbox image.
- The **Modelica** qualified kit declares its own parameters — introspected, never
  invented.
- The **SysML architecture subset** is an enumerated grammar.

A general-purpose _host_ language (Python for CAD scripts) never enters whole. It enters
through a defined, finite **host core** — assignments, qualified calls, arithmetic,
literals, bounded loops for patterns, predicate-lambdas, builder `with`-blocks. Closed ×
closed = closed.

## Why

The thread's promise is that a human signs something they can trust. A compiler that
_understands_ the whole (closed) language can attach exact provenance to every
construct: symbols, dependencies, parameters, geometry kinds, and — critically — a
**determinism class** per construct. A mode that executes scripts the product does _not_
understand can attest bytes and outputs, but it cannot explain them; it is therefore
**never the target**, at most a transitional regime while coverage climbs.

The historical closed _subsets_ (`build123d-closed-subset-v1` at analyzer 1.x) are
bootstrap slices of the closed language, not the philosophy. The mistake to avoid is
hand-enumerating idioms one review at a time: after four lots the frontend qualified ~18
of 473 names. The direction replaces that method, not that code.

## The method

1. **Introspect, never invent.** The API inventory is extracted from the pinned image.
   Bumping the library version means extracting a _new_ inventory and regenerating — the
   next closed language is a new closed language, with an explicit diff.
2. **Derive the qualification tables from the inventory.** Signatures and enum members
   become generated tables checked in CI against the image, instead of hand-written
   entries.
3. **Deliver by families, measured by a corpus.** Large families (sketch surface,
   selector chains, patterns, builder mode…) rather than micro-lots, with one honest
   metric: _the percentage of a real-script corpus (official build123d examples,
   `examples/bracket/bracket.py`, the FEA golden script) that compiles with zero
   unresolved constructs._
4. **Determinism is a class, not a gate.** Constructs whose result depends on OCCT
   internal ordering (`sort_by(...)[n]`, `group_by`) are compiled like everything else,
   and the compiled evidence carries their class — `commutative-set`, `order-dependent`,
   or `stateful-builder`. Downstream consumers declare the class they require; nothing
   is silently excluded and nothing silently pretends to be reproducible across engine
   versions.
5. **Fail labelled, never silent.** Anything outside the closed language (or its host
   core) stays an explicit `unresolvedConstruct` with a dedicated kind. D4
   (`geometry-script-validation.ts`) remains the separate, unchanged security wall
   (imports, I/O attributes) — safety is not the compiler's job and coverage never
   widens D4 implicitly.

## Where the direction lives in the repo

| Artifact                                                                       | Role                                                                                                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config/build123d-api/inventory-<version>.json`                                | The introspected ground truth of the closed language, versioned.                                                                                             |
| `scripts/probes/capture-build123d-api-inventory.ts`                            | Regenerates the inventory from the pinned sandbox; the method as executable code.                                                                            |
| `src/adapters/analyzers/qualified-build123d-source-analyzer.ts`                | The frontend: today's qualified slice (see its version docstring), tomorrow's generated tables.                                                              |
| `src/domain/engineering/geometry-script-validation.ts` (D4)                    | The security wall — orthogonal to coverage, changed only by conscious dedicated commits (`&`/`\|` are documented gaps).                                      |
| `docs/rfcs/qualified-build123d-1.4.0-placement-grammar.md`, `-1.5.0.md`        | Delivered family RFCs (the placement grammar, sketches + operator sugar).                                                                                    |
| `docs/rfcs/qualified-build123d-selector-grammar-study.md` + `-counterstudy.md` | The selector architecture study; its A1/E decision was superseded by this direction — selectors become one family among others, with determinism as a class. |
| `docs/reference/agent-workspace.md` §6                                         | The operational frontend catalogue an agent reads first.                                                                                                     |

## Status at the time of writing

Analyzer 1.5.0: qualified calls ≈ 18 of 473 names, plus placement chains,
`.edges()`-narrow selectors, `math.pi/e/tau`. Families in flight: 1.6.0 (named
placements, `Plane.*`, shell/revolve). The full-coverage engineering plan (surface
triage, host core, generated tables, family sequencing, corpus metric) is being drafted
and will land as an RFC in `docs/rfcs/`.
