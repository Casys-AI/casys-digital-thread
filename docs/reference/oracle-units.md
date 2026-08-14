# Reference: oracle units

A requirement is only verifiable if the oracle can carry its unit. This page is the
contract for which units qualify, how one is admitted, and what happens to the
engineering units that do not qualify.

Source of truth: `UNIT_TO_SYSML_TYPE` in
[`src/domain/analysis/proof-case.ts`](../../src/domain/analysis/proof-case.ts).
`SUPPORTED_ORACLE_UNITS` is its key projection; nothing else may widen it.

## What makes a unit "native"

SysON is the oracle: `syson_constraint_evaluate` renders the verdict, not this repo. A
unit therefore has to survive the full round trip before it may appear in a requirement:

1. the requirement is written into SysON as a typed attribute plus a constraint carrying
   the unit literal —
   `attribute metric : PressureValue; constraint { metric <= 90 [Pa] }`;
2. `syson_constraint_extract` reads it back and returns **the same unit string**;
3. `syson_constraint_evaluate` compares the observation to the limit dimensionally.

Step 2 is the one that decides. Without it the repo cannot honour its own rule that a
published revision is reread before it is treated as true: an unreadable unit means the
stored requirement can no longer be checked against what was intended. A unit that fails
the round trip is refused fail-closed; it is never silently coerced.

## Admitted units

Each row exists because a live probe proved the round trip on that exact date. The
evidence lives beside the map in `proof-case.ts` and must not be summarised away.

| Unit | SysML v2 type (`private import SI::*`) | Probe evidence               |
| ---- | -------------------------------------- | ---------------------------- |
| `mm` | `LengthValue`                          | 2026-08-04, element d6793ccf |
| `Pa` | `PressureValue`                        | 2026-08-04, element d6793ccf |
| `kg` | `MassValue`                            | 2026-08-08                   |
| `W`  | `PowerValue`                           | 2026-08-08                   |
| `V`  | `VoltageValue`                         | 2026-08-08                   |

## Admitting a new unit

The rule is stated in the code and is not negotiable: run the probe, read its verdict,
document the evidence next to the map, then merge.

```bash
deno task probe:requirement-units --unit=<unit> --type=<SysmlType>
```

The probe creates its own SysON sandbox, renders the constraint by hand — deliberately
bypassing `UNIT_TO_SYSML_TYPE` so an unadmitted unit can be tested — extracts it back,
and deletes the sandbox. `status: "ok"` with a matching `extractedUnit` is the only
result that admits a unit.

### Refused: `MPa`

```
deno task probe:requirement-units --unit=MPa --type=PressureValue   # 2026-08-14
→ status: "type_mismatch", extractedUnit: "FeatureReferenceExpression"
```

SysON did not resolve `MPa` to a unit; it left a dangling feature reference. Note that
`mm` is also a prefixed unit and passes, so the cause is not prefixes as such but that
this particular name is not declared in the SI library SysON loads. `MPa` can therefore
never be an oracle unit — a stress requirement is expressed in `Pa`.

## Canonicalisation at the compilation boundary

Engineers state stress in `MPa`. The oracle only carries `Pa`. The gap is closed once,
in code, at the boundary where the approved brief is compiled into MRTR parameters:
`UNIT_NORMALISATION` in
[`src/domain/engineering/unit-normalisation.ts`](../../src/domain/engineering/unit-normalisation.ts)
rescales `MPa` to `Pa` (×10⁶, exact) and the provenance entry names the step as
`transformation: "MPa-to-Pa"`.

Why convert rather than refuse: refusing does not remove the conversion, it moves it
into the agent, where nothing records that `90000000` was meant to be `90 MPa`. Doing it
in code makes the conversion exact, the step named, and both numbers visible to the
signing human. The oracle still only ever sees `Pa`, so the domain and the verdict are
unchanged.

### How the table is guarded

Each entry declares its transformation as a named function (`apply: (value) => number`)
rather than a bare coefficient. This distinction matters for future affine
transformations (see below). Two structural guards fire before any call can proceed:

1. **Probe-first guard** — `declareEntry` validates that every `targetUnit` is in
   `SUPPORTED_ORACLE_UNITS` at module load time. Adding an entry whose target the oracle
   cannot carry throws immediately, before the server starts.
2. **Transformation guard** — every entry carries an `apply` function whose body is
   explicit and testable. A multiplicative `(v) => v * 1_000_000` and an affine
   `(v) => v + 273.15` are structurally different; no silent coefficient promotes one to
   the other.

Constraints on this table, in order of importance:

- **A probe must have refused the unit first.** The table is for units the oracle cannot
  carry, not a convenience layer over units it can.
- **The `apply` function is the single point of trust.** A wrong formula here is exactly
  the silent-rescale bug the unit doctrine exists to prevent, except located in our code
  rather than in a provider. Every entry needs a test that pins the emitted value for a
  typical input and a boundary case.
- **Show the transformation to the human.** A provenance entry that is never surfaced
  turns an explicit conversion back into an invisible one.

## Known gap: temperature has no oracle unit

No temperature unit is admitted — `UNIT_NORMALISATION` holds no `degC` entry and
`SUPPORTED_ORACLE_UNITS` contains no `K`. Modelica nonetheless publishes its
observations in `degC` (`temperature_final`, `targetTemperature: 22 degC` in
[`modelica-isolated-execution.ts`](../../src/domain/analysis/modelica-isolated-execution.ts)).

The consequence is exact: a thermal observation can be produced and captured, but **no
requirement can currently be written that SysON would evaluate it against**. The
Modelica branch yields measurements, not verdicts, until a temperature unit is probed
and admitted.

When that is taken on, note that `K = degC + 273.15` is **affine, not a scale factor**.
The normalisation table already supports the affine shape: an entry would declare
`apply: (v) => v + 273.15` rather than a multiplier. The mandatory boundary test is
`apply(0) === 273.15` — a multiplier-based table would return 0, which is exactly the
wrong answer this architecture exists to prevent. The `declareEntry` guard ensures the
`K` target is in `SUPPORTED_ORACLE_UNITS` before the entry is accepted — so the probe
must pass first.
