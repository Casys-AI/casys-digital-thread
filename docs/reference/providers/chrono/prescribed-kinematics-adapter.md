# Reference: Chrono prescribed-kinematics adapter

Audience: maintainer · Diátaxis: reference · Kind: provider contract

This is the private adapter for the server-selected
`chrono-prescribed-kinematics-adapter@0.3.2`. It is not an agent tool or a product
operation. The registered L3 operation, sealed case, ROP, runtime session and WAL select
it; callers cannot supply a Chrono URL, bearer, tool, image, provider arguments, or
recovery action.

## Lowering

The lowerer reopens the exact sealed prescribed-kinematics source, proves its
fingerprint and canonical bytes, then emits deterministic
`chrono-prescribed-kinematics-case/1.0` JSON. Its fingerprint binds the source,
`casys.mcp-chrono@0.3.2`, target schema, and `absolute-zero-angle-revolute-z-ramp-v1`
mapping.

Only one rooted revolute tree lowers: exactly one fixed `groundBodyId`; one parent per
non-ground body; equal parent/child zero-angle poses; equal literal local `+Z` axes; and
a linear ramp from time zero through the full duration. The adapter refuses rather than
inventing a frame. IDs must match `[A-Za-z][A-Za-z0-9_-]{0,63}`. The closed request uses
metres, radians, seconds, right-handed frames, `sample_every_steps: 1`, at most 512 KiB,
absolute numeric values at most 1,000,000, duration at most 10 s, duration/step at most
10,000, and at most 512 stored samples.

Representative exact lowering failures are:

- `The prescribed-kinematics source fingerprint does not bind the exact source reopened for lowering.`
- `Joint <id> has distinct parent and child frames; Chrono requires one exact absolute zero-angle joint frame.`
- `Joint <id> axis is not the literal local +Z; its absolute Chrono frame would be ambiguous.`
- `The exact source topology is not one Chrono rooted revolute tree.`
- `The mcp-chrono stored-sample budget would exceed 512.`

The provider JSON is transient. The durable L3 provenance records the source and
lowering identities, exact request/case identity, runtime provenance, receipt and
normalized factual observation—not the bearer, endpoint, or secret overlay.

## Submit once, then read by identity

The adapter calls the fixed private tools in this order:

1. `chrono_case_submit` receives exact `case_json` and its SHA-256. It must return the
   same lower-case SHA-256 and exactly `chrono-case:sha256:<digest>`.
2. `chrono_run_prescribed_kinematics` receives the server-derived request id, that case
   identity, optional bounded timeout (100–60,000 ms), and the first sample page. The
   durable WAL claims dispatch before this one allowed side effect.
3. `chrono_run_get` rereads the same request identity only. It yields `recorded`,
   `uncertain`, or `absent`; it never authorizes another `run`.
4. `chrono_run_receipt_get` rereads a recorded receipt by its SHA-256.

Known pre-dispatch run rejections stay definite: `case_invalid`, `case_not_found`,
`case_sha256_mismatch`, `case_uri_mismatch`, `invalid_case_json`, `invalid_request_id`,
`invalid_sample_limit`, `invalid_sample_offset`, `invalid_timeout`, and
`request_conflict`. Post-intent provider codes (`run_uncertain`, `runner_timeout`,
`worker_failed`, `worker_invalid_output`, `store_corrupt`, `persisted_ledger_invalid`,
`receipt_invalid`, `internal_error`) and transport or protocol-invalid responses are
uncertain dispatch: read the same identity; do not retry. An unknown provider error code
is rejected as protocol-invalid. `receipt_not_found` is a literal readback failure; it
does not create a new dispatch right.

## Complete receipt readback and L3 normalization

Readback starts at offset 0 with limit 64 and continues with the accumulated sample
count until `hasMore` is false. Every page must retain the first page's non-page
envelope, cover the declared total without overlap, use limit 64, contain ordered unique
sample times, and have a total equal to `sampleCount` (maximum 512). The assembled range
must begin and end at the declared sample-time bounds. Otherwise the exact failures are:

- `The prescribed-kinematics receipt page is incomplete, overlapping, or has invalid bounds.`
- `The prescribed-kinematics receipt pages contain a duplicate or unordered sample time.`
- `The prescribed-kinematics receipt pages do not cover their declared total.`
- `A prescribed-kinematics receipt page changed identity or total during readback.`

Only then does the adapter publish the normalized L3 shape: exact request and case URI,
canonical recorded time, receipt/outcome/worker SHA-256 values, `Project Chrono 10.0.0`,
`pychrono`, exact three-segment Python/Deno versions, execution state, accepted raw
kinematics exit, sampled body poses, motor angles, declared-limit observation and
residual vectors. The normalized receipt rejects a mismatched engine/binding, a
noncanonical timestamp, or an unsupported exit code/name pair. The only accepted pairs
are `0/NOT_CONVERGED`, `1/SUCCESS`, `2/ABSTOL_RESIDUAL`, `3/RELTOL_UPDATE`, and
`4/ABSTOL_UPDATE`; `not-converged` must agree exactly with `NOT_CONVERGED`.

## Limits

L3 is a factual record of the exact prescribed case only. Its literal `not_evaluated`
boundary is collision, clearance, contact, forces, torques, dynamics, strength, safety,
and product fitness. It is neither L4 evaluation nor L5 closeout, and cannot establish
physical joints, contact behavior, loads, torque, strength, manufacturability,
certification, or an automatic correction/rerun.

For the L3 WAL and human-only reconciliation after an unknown outcome, see
[prescribed-kinematics observation recovery](../../pipeline/prescribed-kinematics-observation-recovery.md).
For the domain evidence levels, see
[prescribed-kinematics coverage](../../domains/mechanism/prescribed-kinematics.md).
