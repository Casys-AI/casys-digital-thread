# Reference: mechanism boundedness

Audience: both · Diátaxis: reference · Kind: enforced and missing limits

These are implementation limits, not recommended engineering values. A limit absent
from this table remains absent; neither an agent nor documentation may invent it.

## Enforced V1 limits

| Boundary | Enforced limit |
| --- | --- |
| Case resource | One canonical UTF-8 JSON file, at most 262144 bytes; closure has exactly one file and zero dependency edges |
| Stable source ids | Shared grammar `[A-Za-z0-9][A-Za-z0-9._:-]{0,255}` |
| Assembly/body mapping | One assembly, 2–16 unique bodies, one unique `PartUsage` per body, assembly distinct from bodies |
| Topology | Connected immediate tree rooted at `groundBodyId`; exactly `bodyCount - 1`, therefore 1–15, unique revolute joints |
| Scenario | Positive duration at most 10 seconds; full-duration linear ramp; endpoints remain inside declared joint limits |
| Sampling | `timeStepS` divides duration into exactly 1–511 intervals, therefore 2–512 stored instants; tick epsilon `1e-12` |
| Geometry-free frames | Three-value positions/axes, Hamilton WXYZ quaternions; unit axis and quaternion norm epsilon `1e-12` |
| L3 observation | At most 23552 factual rows, derived from 512 samples × (16 poses + 15 angles + 15 residual rows) |
| Method resource | Canonical UTF-8 JSON, at most 262144 bytes, at least one criterion; unique criterion ids and selections; at most one convergence criterion |

## Current Chrono lowering limits

These are adapter limits, not wider domain meaning:

- body and joint provider ids match `[A-Za-z][A-Za-z0-9_-]{0,63}`;
- parent and child absolute frames match exactly and both axes are literal local `+Z`;
- the directed parent-to-child graph is one rooted tree and the ground body is its only
  fixed body;
- every lowered number has absolute value at most `1000000`;
- `durationS / timeStepS` is at most `10000`, while the stricter conservative estimate
  `floor(durationS / timeStepS) + 2` is at most `512`; therefore this adapter currently
  accepts at most 510 source intervals even though the domain admits 511;
- the lowered request is at most `524288` bytes.

## Limits not currently declared

- No domain-specific maximum criterion count exists beyond the 262144-byte method
  resource ceiling and uniqueness rules.
- No multi-file mechanism closure exists in V1.
- No cardinality is declared for the number of historical case/method successors a
  project may retain; history is append-only.
- No collision pair, contact, clearance, load, force, torque, mass, inertia, strength,
  safety or manufacturability budget exists because those quantities are not evaluated.

Coverage and non-claims are in [coverage](coverage.md).
