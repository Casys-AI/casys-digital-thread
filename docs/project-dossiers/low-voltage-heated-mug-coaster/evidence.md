# Low-voltage heated mug coaster — evidence index

Audience: both · Diátaxis: none · Kind: tracking evidence index

**Documentation, not storage.** Authoritative bytes live in Thread, CAS, and
`EngineeringProjectSnapshot` revisions under gitignored
`state/local/engineering-projects/`
([persistence roots](../../reference/codebase/persistence-roots.md)).

A terminal claim is not a persisted identity. Cockpit focus is not proof. Prior
project r1 is **superseded** by project r29; do not treat r1 as current.

## How to append

1. Add a **new row**. Do not rewrite a prior identity field.
2. Separate persisted identity from local observation and from terminal claim.
3. Matching names are not a join.

## Local observations (2026-08-22, primary atelier, local)

| Kind | Observation | Not |
| ---- | ----------- | --- |
| Directory names | `cantilever-arm-ca02`, `modelica-ramp-mr01`, `modelica-ramp-mr02`, `heated-mug-coaster-hc01` | Thread proof; the first three are other vehicles |
| Cockpit focus | Primary focus revision 4 → `heated-mug-coaster-hc01` | Project truth, capture, proof, or approval |

## Persisted identities (current)

| Kind | Persisted identity | What it is | Not |
| ---- | ------------------ | ---------- | --- |
| Project snapshot | `heated-mug-coaster-hc01:project:r29:23da822e32f1ae06` | Current `EngineeringProjectSnapshot` revision 29 | Technical proof |
| Scope answer | `q-demo-scope` = `behave-portability-canary`; reference `conversation:2026-08-22:real-project-yolo` | Human-sourced demo scope | Physical scenario, values, or architecture |
| Confirmed brief | `heated-mug-coaster-hc01:brief:r1:25097c9bcb733d52`; fingerprint `sha256:ec719d70fc7eaca462fe257540cb811e2dec94a551e00264fa6a812103c87057`; origin `human/local-yolo` | Canonical brief | CAD, FEA, requirements, L5 |
| Documentary baseline Thread r1 | `project:heated-mug-coaster-hc01:r1:approved-brief-baseline-a3b871f71a0bd7fcf3b0181d3a65b207bcd0fab9d9ec11793fa2ace95754cda4` | `baseline.from-approved-brief@1` succeeded | A model or proof |
| Baseline artifact | `approved-brief-document-a3b871f71a0bd7fcf3b0181d3a65b207bcd0fab9d9ec11793fa2ace95754cda4` | Documentary approved-brief document | SysON architecture |
| SysON seed decision | fingerprint `sha256:9c27c6b608c6ab2821589f19481165dcf58e1d68acb551091ee1968de03ad9a8`; origin `human/local-yolo` | Seed MRTR | Architecture |
| SysON seed Thread r2 | `project:heated-mug-coaster-hc01:r2:capture-syson-model-seed-b31adae10a6423dd1c453be6ccbf0f81812db379f5fa71ad0b23a22a9fad40f0` | Blank container | Architecture or requirements |
| Seed artifact | `syson-model-seed-b31adae10a6423dd1c453be6ccbf0f81812db379f5fa71ad0b23a22a9fad40f0` | Seed capture | Part usages or attributes |
| Architecture decision | fingerprint `sha256:072f57a47f0e0d94d085ab9caa36aed99988a8f8d0a7da3c9e72832c0c8359fb`; origin `human/local-yolo` | Architecture MRTR | Requirements or CAD |
| Architecture Thread r3 | `project:heated-mug-coaster-hc01:r3:model-write-architecture-7f68145cff712a3f53581dd25eac5852eb8784e35870b6c801fca5640ea642dd` | `model.write-architecture@1` succeeded | Components, attributes, or a verdict |
| Architecture artifact | `architecture-7f68145cff712a3f53581dd25eac5852eb8784e35870b6c801fca5640ea642dd` | Renderer readback | Scalar requirements |
| Architecture names | package `HeatedMugCoasterPackage`; system `HeatedMugCoaster`; no components; no attributes | Single-part identity | Further structure |
| PartDefinitions Thread r4 | `project:heated-mug-coaster-hc01:r4:capture-part-definitions-e9b6a661d6d1d94a89eab0d07c1fd902751eeacf2b275d80b3087c8c9bbc9120` | Exact sealed architecture-subgraph reread | Quantity, geometry, physics, or verdict |
| PartDefinitions artifact | `part-definitions-e9b6a661d6d1d94a89eab0d07c1fd902751eeacf2b275d80b3087c8c9bbc9120`; run `run:hc01-queue-part-definitions-20260822` | One `HeatedMugCoaster` PartDefinition with no usages | Whole provider model inventory |
| Exact retry | Same execution command returned project r29 / Thread r4 with four Thread snapshots | Durable idempotent replay observation | A second provider result or new evidence |

No CAD admission, STEP, FEA, Modelica, electrical, impact, requirements, verification,
certification, Make, or Buy identity is listed: none has been produced.

Lookalikes:
[lookalike traps](../../reference/agent/lookalike-traps.md).
