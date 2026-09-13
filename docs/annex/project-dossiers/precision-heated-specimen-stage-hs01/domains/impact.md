# HS01 — impact

Branches are separate by brief design; that is not by itself an impact recross.
There is no whole-product verdict. X10 remains `unavailable`.

## Initial evidence (archived)

The first resource-backed
[hs01-cross-domain-impact-manifest.json](../sources/hs01-cross-domain-impact-manifest.json)
was sealed at r21 (`cross-domain-impact-manifest-seal-a0ddee9b…fe9f`). Initial
X08 evaluation was captured at r22 (`84b9b434…d1dd`): electrical
`invalidated`, thermal `impact-unresolved`, mechanical `carried-forward`.
Those two documents were retired at r23 with the superseded thermal lineage.
They are history, not a decision. The first work items had no `gateClaims`.

## r2 seal — r27

After thermal L5 r26, `work-hs01-seal-impact-r26-r2` (same activity as the
r21 seal) sealed `hs01-thermal-closeout-impact-r2` at r27:
`cross-domain-impact-manifest-seal-ebc28aef…41df`, run
`hs01-queue-impact-seal-r2-r189`. Manifest body fingerprint `56b871c7…cb0e`,
typed capture `64ae4a49…9dcf`. Change kind `thermal-evaluation-closeout` on
closeout `c6f4fa39…f18c`. Mechanical independence assertion
`hs01-mechanical-independent-of-thermal-closeout-r26` has
`reviewedAt` `2026-08-24T05:20:00.000Z` and `expiresAt`
`2026-09-23T05:20:00.000Z`. That r27 seal stayed unarchived through r32.

## Premature X08 — r28 / r29

First r2 evaluation r28 (`cross-domain-impact-evaluation-28a36286…41a5`, run
`hs01-queue-impact-evaluation-r2-r194`) used that same r27 seal.
`evaluatedAt` `2026-08-24T05:17:28.331Z`. Branch statuses: electrical
`impact-unresolved`, thermal `invalidated`, mechanical `impact-unresolved`.

Mechanical was `impact-unresolved` solely because assertion `reviewedAt`
`2026-08-24T05:20:00.000Z` is later than that `evaluatedAt`. Electrical
`impact-unresolved` is the declared missing positive edge from this thermal
closeout; thermal `invalidated` is the positive affected input. r28 did not
change claims or work items (`gateClaimTransitions: none`,
`workItemInvalidations: none`, `rerunProposals: none`).

r29 archived **only** that r28 evaluation
(`hs01-queue-archive-premature-impact-r201`, decision
`decision-hs01-archive-premature-impact-evaluation-r28`). The r27 seal, prior
evidence, and audit history stayed in place. History was not mutated.

## Retry X08 — r30

`work-hs01-evaluate-impact-r29-r3` names `dependsOn`
`work-hs01-seal-impact-r26-r2` and the r28 archive. The first execute
`run:hs01-queue-impact-evaluation-r3-r206` failed before a Thread write
(`analyze-evaluate-cross-domain-impact-not-published`). See
[platform/frictions.md](../platform/frictions.md).

Retry `run:hs01-queue-impact-evaluation-r3-retry-r209` completed r30
(`cross-domain-impact-evaluation-2b297972…707c`) on the **same** unarchived
r27 seal. `evaluatedAt` `2026-08-24T06:34:31.105Z` is after `reviewedAt`.
Statuses: electrical `impact-unresolved`, mechanical `carried-forward`,
thermal `invalidated`. Limits stay `rerunProposals: none`, `solverCalls: none`,
`providerCalls: none`.

## X09 — r31

Human YOLO `decision-hs01-accept-impact-r30` (`local-yolo:startup-opt-in`,
origin `human`) accepted those exact r30 statuses at r31
(`cross-domain-impact-decision-42c78d80…0df2`, run
`hs01-queue-impact-decision-r30-r216`). Applied `gateClaims` on
`work-hs01-seal-impact-r26-r2`:

| gateItemId | role | status |
| ---------- | ---- | ------ |
| `verify-electrical-heater` | `satisfies` | `impact-unresolved` |
| `verify-mechanical-stage` | `satisfies` | `carried-forward` |
| `verify-thermal-stage` | `contributes-to` | `invalidated` |

Limits: `newWorkItems: none`, `providerCalls: none`, `reruns: none`,
`solverCalls: none`. Previous claim status was `current`.

## X11 — r32

Provider-free `analyze.evaluate-mechanical-preservation@1` completed r32
(`cross-domain-impact-mechanical-preservation-2833ff4a…b9c6`, run
`hs01-queue-mechanical-preservation-r31-r219`). Status `carried-forward`.
It recrossed the exact prior mechanical evidence: STEP `5aa7179c…1d74`,
CalculiX evidence `da3c9dcd…feea`, L5 closeout `716ad51d…4f32`. Limits:
`solverCalls: none`, `providerCalls: none`, `rerunProposals: none`. No
CalculiX run exists after r14.

## Friction

Do not invent a fourth branch, a rerun planner, or preservation by omitted
edges. X10 remains `unavailable`; independent Modelica/SPICE walks are not
X10. Coupled thermomechanics is a brief exclusion, not an impact edge. The
r27 seal was reused after r29; r28 stays archived. See
[platform/frictions.md](../platform/frictions.md).
