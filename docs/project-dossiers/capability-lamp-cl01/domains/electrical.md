# CL01 — admitted SPICE electrical chain

Audience: both · Diátaxis: explanation · Kind: dated evidence boundary

CL01 uses the generic circuit-only admitted SPICE path. It is not the LED-driver human
fiche and not `mcp-spice`; the registered execution starts from the sealed r22
admission.

| Layer | Thread revision | Recorded fact |
| --- | --- | --- |
| Admission | r22 | Exact circuit-only source is admitted through `compile.seal-admission@3` |
| L3 observation | r23 | `v(led) = 2.487078 V`; delivered `-i(v1) = 0.028827 A` |
| Method seal | r24 | Electrical observation method sheet sealed against r23 evidence |
| L4 evaluation | r25 | 3 named comparisons are literal `pass` |
| L5 closeout | r26 | Human acceptance of that exact evaluated circuit scope |

The factual L3 output is
`spice-admitted-result-471c40db0161581c9764bd1387efbb23ea288bcec00148a683789b1299b3955d`.
The r25 server-owned comparator, not ngspice, derives the named criteria. An L4 `pass`
is never a safety or product certification claim.

## Explicit exclusions

This chain does not establish wiring integrity, thermal behavior, protection,
tolerances, transient response, EMC, optical output, lifetime, reliability, component
availability, product safety, compliance, manufacturing or vendor validity. The domain
boundary is [electrical reference](../../../reference/domains/electrical/README.md).
