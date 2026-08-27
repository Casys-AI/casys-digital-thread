# PS-01 runtime evidence

Audience: both · Diátaxis: reference · Kind: local observation

The following local state was observed on 2026-08-26: Engineering Project r216 and
Thread r26. `state/local/` is gitignored and may drift.

## Captured Digital Thread assembly-integrity chain

The current approved Brief V2 r2 contains `verify-digital-assembly-integrity`, with
verification authority `assembly-integrity@1.0`.

1. L3 completed as `run:ps01-queue-assembly-integrity-l3-r2`, publishing Thread r24
   observation
   `assembly-integrity-observation-9eb0e48bd4d080435ca796ec189918e8081252b96c588e224ba74e6089dd3df6`.
   It recorded 6 occurrences and 15 pairs; valid BRep; 0 degenerate edges and 0 free
   edges; zero intersection volume for every pair; and a minimum pairwise distance of 19
   mm or more. Its raw provenance names the Build123d observer and the capture retains
   request/response fingerprints. Those fingerprints bind the captured exchange; they
   do not attest by themselves that the configured image actually ran.
2. Provider-free L4 completed as `run:ps01-queue-assembly-integrity-l4`, publishing
   Thread r25 evaluation
   `assembly-integrity-evaluation-97cf33228d98878a8af28dc1d1c62fee32892d48d551daf337641046b75e6a85`.
   The aggregate verdict is `pass`: `assembly-import`, `occurrence-coverage`,
   `placement-recross`, `brep-validity`, and `pairwise-intersection` all passed.
3. Human L5 completed as `run:ps01-queue-assembly-integrity-l5`, publishing Thread r26
   closeout
   `assembly-integrity-evaluation-closeout-80d2c42801dd139591d8f8aeb1392d908c5365ca685242d84639946bfedcb932`.
   Its exact gate claim is `verify-digital-assembly-integrity` with role `satisfies` and
   status `current`.

## Historical friction and boundary

The earlier `run:ps01-queue-assembly-integrity-l3` failed because a profile projection
crossed a strict observer boundary with an unsupported field. It is retained as
historical friction, not L3 evidence. Commit `422bedaa` corrected that projection; the
successor r24 capture above is the current factual record.

A direct normal-fleet provider smoke over the same STEP also exists, but it is not used
as a substitute for the captured L3 run. The PS-01 claim rests on the L3/L4/L5 records
above.

Those records do not evaluate or prove physical joints, required clearance, motion,
load, fabricability, safety, or certification. They also do not establish a general
product verdict.
