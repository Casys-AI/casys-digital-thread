# Reference: oracle units

Audience: both · Diátaxis: reference · Kind: contract

A requirement is only verifiable if the oracle can carry its unit. This page is the
contract for which units qualify, how one is admitted, and what happens to the
engineering units that do not qualify.

Source of truth: `UNIT_TO_SYSML_TYPE` in
[`src/domain/kernel/proof-case.ts`](../../../src/domain/kernel/proof-case.ts).
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

| Unit  | SysML v2 type (`private import SI::*`) | Probe evidence               |
| ----- | -------------------------------------- | ---------------------------- |
| `mm`  | `LengthValue`                          | 2026-08-04, element d6793ccf |
| `Pa`  | `PressureValue`                        | 2026-08-04, element d6793ccf |
| `kg`  | `MassValue`                            | 2026-08-08                   |
| `W`   | `PowerValue`                           | 2026-08-08                   |
| `V`   | `VoltageValue`                         | 2026-08-08                   |
| `N`   | `ForceValue`                           | 2026-08-14                   |
| `J`   | `EnergyValue`                          | 2026-08-14                   |
| `s`   | `TimeValue`                            | 2026-08-14                   |
| `m`   | `LengthValue`                          | 2026-08-14                   |
| `K`   | `TemperatureValue`                     | 2026-08-14                   |
| `A`   | `ElectricCurrentValue`                 | 2026-08-14                   |
| `Hz`  | `FrequencyValue`                       | 2026-08-14                   |
| `rad` | `AngleValue`                           | 2026-08-14                   |

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

### Refused units (2026-08-14 campaign, extended 2026-08-15)

```
deno task probe:requirement-units --unit=1 --type=DimensionOneValue # 2026-08-15
→ status: "extraction_failed" (syson_constraint_extract returned no constraints)
  Dimensionless quantities are NOT oracle-admissible yet. A buckling
  load-factor requirement therefore cannot produce a verdict: the proof path
  must publish not_evaluated until a green probe closes this gap.

deno task probe:requirement-units --unit=MPa --type=PressureValue   # 2026-08-14
→ status: "type_mismatch", extractedUnit: "FeatureReferenceExpression"

deno task probe:requirement-units --unit=m2 --type=AreaValue        # 2026-08-14
→ status: "type_mismatch", extractedUnit: "FeatureReferenceExpression"

deno task probe:requirement-units --unit=N*m --type=TorqueValue     # 2026-08-14
→ status: "extraction_failed" (SysML syntax with * rejected by constraint_extract)

deno task probe:requirement-units --unit=N.m --type=TorqueValue     # 2026-08-14
→ status: "type_mismatch", extractedUnit: "N" (dot truncates the name)

deno task probe:requirement-units --unit=kPa --type=PressureValue   # 2026-08-14
→ status: "type_mismatch", extractedUnit: "FeatureReferenceExpression"

deno task probe:requirement-units --unit=deg --type=AngleValue      # 2026-08-14
→ status: "type_mismatch", extractedUnit: "FeatureReferenceExpression"
```

`MPa`, `kPa`, `m2`, `deg`, `N*m`, `N.m` are not declared in the SI library SysON loads.
Note that `mm` is a prefixed unit and passes — the cause is not prefixes as such but the
specific declarations present in SysON's SI bundle.

`MPa`, `kPa`, `bar`, `kN`, `kJ`, `MJ` are handled at the compilation boundary (see
section below).

## Canonicalisation at the compilation boundary

Engineers use units the oracle cannot carry. The gap is closed once, in code, at the
boundary where the approved brief is compiled into MRTR parameters: `UNIT_NORMALISATION`
in
[`src/domain/kernel/unit-normalisation.ts`](../../../src/domain/kernel/unit-normalisation.ts)
rescales each non-native unit to its oracle-admitted target and names the step in the
provenance entry.

| Source unit | Target unit | Factor / rule         | Label       | Probe evidence                               |
| ----------- | ----------- | --------------------- | ----------- | -------------------------------------------- |
| `MPa`       | `Pa`        | ×1 000 000            | `MPa-to-Pa` | `Pa` OK 2026-08-04; `MPa` refused 2026-08-14 |
| `kN`        | `N`         | ×1 000                | `kN-to-N`   | `N` OK 2026-08-14                            |
| `MJ`        | `J`         | ×1 000 000            | `MJ-to-J`   | `J` OK 2026-08-14                            |
| `kJ`        | `J`         | ×1 000                | `kJ-to-J`   | `J` OK 2026-08-14                            |
| `bar`       | `Pa`        | ×100 000              | `bar-to-Pa` | `Pa` OK 2026-08-04                           |
| `degC`      | `K`         | + 273.15 (**affine**) | `degC-to-K` | `K` OK 2026-08-14                            |

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

## Temperature is now verifiable

`K` passed the 2026-08-14 probe (`TemperatureValue`, `extractedUnit: "K"`). The
normalisation entry `degC-to-K` is declared in `UNIT_NORMALISATION` as the first affine
transformation: `apply: (v) => v + 273.15`.

Modelica already publishes `degC` observations (`temperature_final`, `targetTemperature`
in
[`modelica-isolated-execution.ts`](../../../src/domain/modelica/qualified-kit/isolated-execution.ts)).
Those observations can now be compared against a `K`-based SysON requirement via the
compilation boundary: `normaliseThreshold(22, "degC")` → `{ value: 295.15, unit: "K" }`.

**Affine safety** — the mandatory boundary test `apply(0) === 273.15` is enforced in
`unit-normalisation_test.ts`. A multiplier-based table would return 0 for 0 °C, which is
wrong; the function shape makes the affine semantics explicit and testable.

## Known remaining gaps

Units the oracle cannot carry and that have no normalisation path:

- `m2` / `m²` (AreaValue) — `type_mismatch` 2026-08-14. No standard SysON prefix.
- Torque (`N*m`, `N.m`) — rejected by SysON on both spellings 2026-08-14.
- `deg` (AngleValue as degrees) — `type_mismatch` 2026-08-14. Use `rad` natively.
