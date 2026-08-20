# SysON evaluation surface

Audience: both · Diátaxis: reference · Kind: provider contract

SysON evaluates reviewed scalar constraints. It does not calculate CAD geometry,
simulate a physical model or run FEA. A successful provider call is not itself a pass;
Digital Thread preserves the exact request and response and publishes the literal
`pass`, `fail`, `unresolved` or `error` outcome.

Source contracts:

- [`proof-case.ts`](../../../../src/domain/kernel/proof-case.ts)
- [`fea-oracle-adapter.ts`](../../../../src/adapters/fea/isolated-v3/fea-oracle-adapter.ts)
- [`verify-evaluate-sensitivity-base-run-executor.ts`](../../../../src/adapters/sensitivity/base-evaluation/verify-evaluate-sensitivity-base-run-executor.ts)

## Constraint grammar

The product emits one binary constraint per metric:

```text
observed feature <= dimensioned limit
observed feature >= dimensioned limit
```

Only `<=` and `>=` are registered. Metric names are SysML identifiers and every limit
has a mandatory unit. Generic requirement authoring currently accepts safe integer
thresholds only because the qualified round trip does not preserve decimal literals.

| Accepted authoring units | SysML value type       |
| ------------------------ | ---------------------- |
| `mm`, `m`                | `LengthValue`          |
| `Pa`                     | `PressureValue`        |
| `kg`                     | `MassValue`            |
| `N`                      | `ForceValue`           |
| `J`                      | `EnergyValue`          |
| `W`                      | `PowerValue`           |
| `V`                      | `VoltageValue`         |
| `s`                      | `TimeValue`            |
| `K`                      | `TemperatureValue`     |
| `A`                      | `ElectricCurrentValue` |
| `Hz`                     | `FrequencyValue`       |
| `rad`                    | `AngleValue`           |

`MPa`, `kPa`, `m2`, torque spellings, `deg` and dimensionless `1` are not generic
requirement-authoring units. The FEA V3 adapter may submit a solver observation in `MPa`
against a reviewed requirement in `Pa`; SysON performs that unit-aware comparison, and
Digital Thread verifies the normalized unit returned. See
[Oracle units](../oracle-units.md) for probe evidence and exact gaps.

## Registered evaluation uses

`verify.run-fea-static-proof@3` first publishes the exact local Gmsh/CalculiX evidence.
It then maps only declared proof observations to their reviewed requirements and calls
`syson_constraint_evaluate`. A zero solver exit code never bypasses this separate
evaluation.

`verify.evaluate-sensitivity-base@1` evaluates only an exact
`sensitivity-base-<metric>-<digest>` observation/requirement join from one sealed study.
It does not solve FEA, accept metric aliases or turn a proof-run evaluation into
correction authority.

Both operations retain an immutable SysON request/structured-response capture. A `fail`
may create a named violation and review action. `unresolved` and `error` remain literal
and never become a synthetic comparison.

## Specialized sensitivity modelling

`model.write-sensitivity-edges@1` is a separate registered writer. It reopens one sealed
sensitivity-study capture, renders the derivative PartDefinition on the server, inserts
it into the exact seeded model and verifies it with `syson_constraint_extract`. It is
not the generic architecture renderer and does not authorize a CAD correction.

## Outside the product surface

The fleet advertises `syson_constraint_validate`, `syson_constraint_solve`,
`syson_value_read` and `syson_value_set`, but no registered generic engineering
operation exposes them. A diagnostic probe of the constraint solver is not a product
capability, and a native SysON value mutation is not evidence authority.
