# Explanation: closed-language compilation

Audience: both · Diátaxis: explanation · Kind: contract

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
  [`config/build123d-api/inventory-0.11.1.json`](../../../config/build123d-api/inventory-0.11.1.json),
  regenerated at will by
  [`scripts/probes/capture-build123d-api-inventory.ts`](../../../scripts/probes/capture-build123d-api-inventory.ts)
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

## The same doctrine, per language

The doctrine is not CAD-specific. Every engineering language in the toolchain follows it
— what changes is the closed object and where its inventory comes from.

| Language  | The closed object                                                                                                                                                            | Inventory source                                                                                | Coverage today                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Build123d | 473 public names of the pinned 0.11.1 + the finite Python host core                                                                                                          | `config/build123d-api/inventory-0.11.1.json`, regenerated by introspecting the sandbox image    | analyzer **1.6.0** hand table (~22/146 writing names). Inventory is documentary until F1 generates tables. |
| SysML v2  | The normative v2 textual grammar **intersected with what the pinned SysON round-trips** (0.5.1: e.g. integer literals only)                                                  | The OMG grammar + SysON capability probes (the requirement-units probe is the existing pattern) | `sysml-architecture-closed-subset-v1`: package / part def / part usage                                     |
| Modelica  | The Modelica Language Specification grammar + the versioned MSL classes shipped in the pinned OpenModelica image                                                             | Generic v2 closed-subset parser for product `.mo`; qualified-kit V1 self-declaration is image smoke only | `modelica-closed-subset-v2` (compile + admitted run) and the separate qualified LinearThermalRamp kit V1 |
| CalculiX  | Two closed objects: our declarative case schemas (`mechanical-proof-case/1.0`, sensitivity 2.0…) that the server lowers, and the pinned solver's finite card set behind them | The case schemas are ours; the card set comes from the pinned CCX documentation                 | linear-static proof + two-solve sensitivity; modal/buckling/thermal are future families                    |

Current domain contracts:

- [CAD](../../reference/domains/cad/README.md)
- [Modelica](../../reference/domains/modelica/README.md)
- [FEA](../../reference/domains/fea/README.md)

One structural difference is worth naming: Build123d, SysML and Modelica admit exact
closed-language source bytes, so coverage means compiling the source that the project
sealed. CalculiX does not admit solver source: the server selects a catalogued
declarative case and generates the solver deck — the agent never writes `.inp` or
chooses its parameters. Both shapes are closed-language compilation; the second owns
both sides of the lowering.

## Where the direction lives in the repo

| Artifact                                                                       | Role                                                                                                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config/build123d-api/inventory-<version>.json`                                | The introspected ground truth of the closed language, versioned.                                                                                             |
| `scripts/probes/capture-build123d-api-inventory.ts`                            | Regenerates the inventory from the pinned sandbox; the method as executable code.                                                                            |
| `src/adapters/cad/source/qualified-build123d-source-analyzer.ts`               | The frontend: today's qualified slice (see its version docstring), tomorrow's generated tables.                                                              |
| `src/domain/cad/source/geometry-script-validation.ts` (D4)                     | The security wall — orthogonal to coverage, changed only by conscious dedicated commits (`&`/`\|` are documented gaps).                                      |
| [Build123d closed subset](../../reference/domains/cad/build123d-closed-subset-v1.md)       | Living public contract for the qualified grammar, including supported placement and shape forms.                                                             |
| [CAD coverage](../../reference/domains/cad/coverage.md)                                    | Current supported and unsupported surface; private design studies do not widen it.                                                                            |
| `docs/reference/agent/agent-workspace.md` §6                                         | The operational frontend catalogue an agent reads first.                                                                                                     |

## Status at the time of writing

Analyzer **1.6.0** is shipped (named `Pos`/`Rot` bindings, `Plane.*`, `offset`,
`revolve`, extrude `taper=`). The hand table still includes `Ellipsoid`, which the
0.11.1 inventory does not list. The next proposed family is **F1** (generated tables +
analyzer 2.0.0), not a 1.7.0 idiom lot. It remains a proposal until the public coverage
and closed-subset contract are updated.

Inventories for CalculiX, Modelica and SysML are documentary ground truth in
`config/*-api/`. No analyzer imports them. Coverage annotations inside those JSON files
are not generated qualification tables.
