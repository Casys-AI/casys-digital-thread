# CL01 — prescribed kinematics

Audience: both · Diátaxis: explanation · Kind: dated evidence boundary

CL01 adds an explicit prescribed-kinematics case to the CAD assembly context. Its body
mappings and kinematic inputs are source data in the workspace; the system does not
infer axes, frames, joints, masses or units from STEP geometry or labels.

| Layer | Thread revision | Recorded fact |
| --- | --- | --- |
| L1 case seal | r17 | Exact case and product-structure binding sealed |
| L3 observation | r18 | 11 factual samples, including poses, angles, residuals and convergence state |
| Method seal | r19 | Exact criteria/method bound to that observation basis |
| L4 evaluation | r20 | 10 named comparisons are literal `pass` |
| L5 closeout | r21 | Human acceptance of that exact prescribed-motion evaluation |

Chrono is a server-selected private binding behind the provider-neutral mechanism
authority; its runtime success is not the L4 comparison or L5 decision. The chain is
documented by the [mechanism evidence lifecycle](../../../reference/domains/mechanism/prescribed-kinematics-evidence-lifecycle.md)
and [Chrono boundary](../../../reference/providers/chrono/README.md).

## Explicit exclusions

The result does not establish collision, contact, clearance, forces, torque, dynamic
loads, resistance/strength, safety, fabrication, certification or whole-product
fitness. Static assembly integrity remains a separate CAD question.
