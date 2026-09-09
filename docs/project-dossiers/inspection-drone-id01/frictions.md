# ID01 — remaining agent-path frictions

Fact-checked on **2026-09-09** by six Terra reviewers, with final source and runtime
readback checks by Codex. **27 confirmed-fixed entries have been removed.** This file
retains **14 confirmed-open frictions** and **3 historical incidents whose current
status is unverified**. Original observations remain in Git history.

The registered read-only project snapshot returned **project r693 / Thread r95**. The
RadialArm sensitivity study is completed; its separate SysML edge publication remains
open under F36. Tests and runtime evidence support only their stated scope, not a
whole-drone, flight or certification verdict.

GitHub issues are in English. They track remaining work; they do not authorize a
provider execution, project mutation or runtime promotion. Older revision references
inside retained entries describe the historical trigger, not the current project tip.

## Confirmed-open issue index

| Friction | GitHub issue                                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F02      | [#21 — CLI: provide a bounded actionable projection for technical compilation previews](https://github.com/Casys-AI/casys-digital-thread/issues/21); [#24 — MCP: bound technical-compilation previews with immutable paged evidence](https://github.com/Casys-AI/casys-digital-thread/issues/24) |
| F03      | [#22 — Desktop integration: expose Digital Thread project-control tools in the active Codex host](https://github.com/Casys-AI/casys-digital-thread/issues/22)                                                                                                                                    |
| F13      | [#14 — Add a governed propulsion and energy pre-sizing capability](https://github.com/Casys-AI/casys-digital-thread/issues/14)                                                                                                                                                                   |
| F15      | [#15 — Workbench: preserve discoverability when legacy project heads cannot reopen](https://github.com/Casys-AI/casys-digital-thread/issues/15)                                                                                                                                                  |
| F16      | [#16 — Add exact BRep mass-property evidence for canonical geometry](https://github.com/Casys-AI/casys-digital-thread/issues/16)                                                                                                                                                                 |
| F17      | [#8 — Engineering evidence: close the F1404 KV4600 / GF3016 propeller-interface packet](https://github.com/Casys-AI/casys-digital-thread/issues/8)                                                                                                                                               |
| F18      | [#9 — Engineering evidence: reconcile F1507 KV3800 / T3140 operating limits and bench configuration](https://github.com/Casys-AI/casys-digital-thread/issues/9)                                                                                                                                  |
| F19      | [#10 — Engineering evidence: resolve PM06 V2 output-power and height discrepancies](https://github.com/Casys-AI/casys-digital-thread/issues/10)                                                                                                                                                  |
| F20      | [#11 — Engineering evidence: establish usable-energy evidence for the selected ID01 battery pack](https://github.com/Casys-AI/casys-digital-thread/issues/11)                                                                                                                                    |
| F21      | [#12 — Add a registered Thread publication path for source-backed pre-sizing worksheets](https://github.com/Casys-AI/casys-digital-thread/issues/12)                                                                                                                                             |
| F22      | [#13 — Allow a reviewed later brief to authorize a capability-ceiling amendment](https://github.com/Casys-AI/casys-digital-thread/issues/13)                                                                                                                                                     |
| F27      | [#17 — Wire exact sensitivity experience reuse into the production composition](https://github.com/Casys-AI/casys-digital-thread/issues/17)                                                                                                                                                      |
| F36      | [#18 — Persist and read back ID01 RadialArm sensitivity edges after the completed study](https://github.com/Casys-AI/casys-digital-thread/issues/18)                                                                                                                                             |
| F44      | [#19 — Add a governed generic activation path for qualified first-party microVM candidates](https://github.com/Casys-AI/casys-digital-thread/issues/19)                                                                                                                                          |

F14, F28 and F29 remain `unverified`; no issue was created for them. Their historical
incidents have neither been disproved nor confirmed as current failures.

## F02 — direct MCP previews still carry the complete compilation dossier

**Fact-check 2026-09-09: confirmed open; server-side correction awaiting merge.**
[GitHub #21](https://github.com/Casys-AI/casys-digital-thread/issues/21) was a local
terminal mitigation after transport. It is superseded on this branch by the bounded
server-owned surface for #24; direct callers receive the canonical summary rather than
the full dossier.

`project_technical_compilation_preview` does not return the complete EngineeringProject,
but it returns the complete technical-compilation dossier: exact Thread/SysML basis and
elements, source text and analyses, bindings, profile requests, diagnostics and
projections; ready reviews also carry all decision parameters.
[GitHub #24](https://github.com/Casys-AI/casys-digital-thread/issues/24) changes that
surface to a bounded server-owned summary plus immutable paged evidence. A partial
summary or page cannot replace the full review required for MRTR, and this route must
not add provider, runtime, dispatch, or project-mutation authority.

## F03 — current session lacks first-class Digital Thread tools

**Fact-check 2026-09-09: confirmed open.** Tracked in
[GitHub #22](https://github.com/Casys-AI/casys-digital-thread/issues/22).

The current Codex tool catalogue did not expose the Casys project commands. Astra used
the repo's existing loopback `scripts/probes/mcp-call.ts` transport to call those
registered commands directly. No provider API, runtime arguments, or alternate authority
was substituted. This observation is session-specific; it does not prove that another
host integration lacks the tools.

## F13 — no registered generic propulsion/energy pre-sizing authority (open, deferred)

**Fact-check 2026-09-09: confirmed open.** Tracked in
[GitHub #14](https://github.com/Casys-AI/casys-digital-thread/issues/14).

Project r672–r674 records the human priority and a pending brief r5 for a sourced
mass–thrust–power–energy–endurance balance. Inspection of the current operation registry
found no generic propulsion/energy pre-sizing route. The capability proposal returned by
the brief review remains unchanged and still awaits confirmation: existing CAD, SysON,
assembly-integrity and single-part static-FEA surfaces do not become an aerodynamic or
battery-system solver merely because the new question exists.

This is a real product-capability gap, but not a quick-win patch. CalculiX cannot invent
operational loads; prescribed Chrono cannot establish thrust, torque or flight dynamics;
the admitted Modelica subset cannot supply an unsourced motor–propeller–ESC–battery
model. Adding a broad solver now would enlarge language, provider, evidence, validation
and safety boundaries before the inputs and physical question are stable.

The proportional response is the
[documentary pre-sizing basis](propulsion-energy-presizing-basis-20260908.md): source
candidate data, preserve unknowns, calculate only traceable consequences, and derive the
smallest later verification need. Revisit a versioned capability extension only after a
candidate packet and mission model reveal an exact unsupported calculation. F13 remains
open and deliberately deferred; no runtime or registry change is made in this pass.

## F14 — native Grok plugin startup incidents (historical; current status unverified)

**Fact-check 2026-09-09: `unverified`.** A separately scoped global Grok/plugin
maintenance audit with current logs would be required before filing a GitHub issue. No
GitHub issue was created. The account below is historical.

Three repository-aware, read-only Grok reviews completed successfully in this pass, but
their startup loaded unrelated global plugins and emitted name-collision warnings, an
unsupported-permission warning, a failed `caveman-shrink` handshake and an
unauthenticated `magic` handshake. A prior third repository-free review also stopped
advancing and was terminated according to the delegation workflow. A later
supplier-identity review was cancelled after its permission auto-classifier timed out;
Terra closed that bounded review instead. The completed answers remain usable because
Codex independently checked their inputs and arithmetic; the startup noise is not
project evidence.

A later bounded STEP mass-property audit reproduced the same auto-classifier timeout
after completing useful read-only inspection. It was cancelled without an accepted
verdict or retry loop. Codex finished the source/STEP arithmetic directly, and one
targeted Terra cross-check independently returned `SHIP`; no Astra escalation was
needed. This repetition strengthens the workflow-friction evidence but does not change
the proportional workaround.

A subsequent bounded battery-candidate search stopped at the same classifier timeout
after a read-only tool response. It was also cancelled without a retry loop or accepted
verdict; one targeted Terra search supplied only near-miss candidates, and Codex checked
the official pages and arithmetic. The project result is therefore not made dependent on
the stalled Grok session.

Three later read-only V&V reviews completed and returned usable final answers, but again
loaded the unrelated plugin set and reproduced the collision, unsupported-permission,
`caveman-shrink` and unauthenticated `magic` warnings. After one valid `end_turn` and
wrapper exit 0, the runtime also logged
`Resident session actor exited unexpectedly;
reaping as DeadFailed`. Codex inspected the
returned matrices and repository contracts; the warning is not treated as an engineering
verdict or as proof of healthy Grok session cleanup.

In the next four-way pre-selection review, three bounded sessions completed. The
propulsion session instead started an internal delegation, waited on it repeatedly and
was terminated without an accepted verdict. Codex completed that source review directly;
the stalled session contributed no project fact.

A later four-way source-control audit completed all four bounded Grok sessions, while
repeating the same unrelated plugin collisions, unsupported-permission warnings and
failed optional MCP startup. Codex independently reopened and inspected the official
sources before accepting any engineering statement. The successful answers do not close
F14: the noise and global configuration remain outside the ID01 repository's authority.

Two subsequent exact-row audits also completed and reproduced the startup noise. Their
exact-row arithmetic was accepted only after Codex independently recalculated it; one
proposed inter-type comparison was deliberately not promoted because the supplier warns
against that interpretation.

Two later ESC-guide and installed-census audits also completed despite the same startup
noise. Their engineering conclusions were accepted only after Codex reopened the
official ESC pages and recounted the controlled placement sources. F14 remains open; the
global plugin configuration is still outside this repository's authority.

The latest four-task pre-sizing pass reproduced the same startup noise and intermittent
web-fetch errors. Its first power-chain final output was lost at the orchestration
boundary; after every other task had exited, the exact same bounded prompt was retried
once and completed. Only that complete retry was reviewed. Codex independently reopened
the retained manufacturer pages, so the dossier does not depend on partial stream text
or on the wrapper cleanup warnings.

A subsequent three-task camera/mission pass completed but reproduced the same optional
plugin warnings and intermittent web-fetch output errors. Codex independently reopened
the official Raspberry Pi brief and documentation and recalculated the accepted optical
coefficients. No dossier claim depends on a failed fetch, and the user's global
Grok/plugin configuration was left untouched.

The following bounded final-diff reviewer recalculated the camera coefficients and
started source and anchor checks, then stopped producing useful progress without a final
verdict. Codex terminated it rather than extending a proportional documentation review;
none of its partial stream was accepted. The independent arithmetic, formatting, link
and source checks remain the acceptance evidence.

The next four read-only mission-boundary reviews all completed and agreed that choosing
A, B or C is the next material decision, while numerical durations, distances, reserve
and operating limits cannot be inferred from YOLO. They reproduced the same unrelated
plugin startup noise. Codex independently checked the live r674 snapshot and the exact
`project_question_propose` schema before admitting only the unanswered question at
project r675; no global Grok or plugin setting was changed.

Two later read-only closure audits also completed despite the same startup noise. One
found no remaining deterministic source-backed vehicle calculation that was not already
present; the other found no registered operation that semantically publishes these
worksheets into the Thread. Codex independently recrossed the live r675 state, resource
capture boundary, operation registry and Workbench case/domain maps before accepting
those negative findings. No plugin setting or engineering state changed during the
audits.

This is a real agent-workflow friction, but not a safe repo-local quick win. Repairing
it would change the user's global Grok/plugin configuration outside the ID01 scope and
could affect other work. Leave that configuration untouched here. For now, keep each
Grok task bounded, observe live progress, stop rather than loop when it stalls, and use
targeted Terra reinforcement if needed. Diagnose and clean the global plugin set in a
separate, explicitly scoped maintenance pass.

## F15 — preview catalogue exposes historical validator drift (open, deferred)

**Fact-check 2026-09-09: confirmed open.** Tracked in
[GitHub #15](https://github.com/Casys-AI/casys-digital-thread/issues/15).

A fresh read-only `GET /api/projects` still returned HTTP 503 with
`Persisted project revisions could not be reopened exactly.`, while the registered ID01
snapshot read succeeded.

The pinned preview could read ID01 project r674 / Thread r93, while `GET /api/projects`
returned HTTP 503 with `Persisted project catalog is unavailable.` Read-only inspection
found a bounded wiring omission: the preview CLI created the validated project store but
did not supply the project-catalog reader already used by the packaged Desktop BFF.

The quick win is closed in checkpoint `033a0dc8`. The shared fail-closed reader now
serves both entry points; 54 targeted tests, type checking, formatting and whitespace
checks passed. After restarting the same pinned preview, `/api/projects` reached that
reader. It then returned the more precise literal state
`Persisted project revisions could not be reopened exactly.`

The remaining failure is not an ID01 projection error. Direct store reads reopened five
current heads, including ID01 r674, and rejected five historical project heads:
`desktop-parts-sorter-ps01`, `motorized-camera-slider-mcs01`,
`motorized-camera-slider-mcs02`, `precision-heated-specimen-stage-hs01` and
`spice-lifecycle-pilot-sl01`. Their completed plan-bearing historical runs predate the
current mandatory `resolvedOperationPlan` validation and cannot be presented as valid
current snapshots. Because catalogue discovery is deliberately all-or-nothing, those
entries keep the list endpoint at 503 even though the exact pinned ID01 Workbench
remains HTTP 200 on `engineering-workbench/0.6`.

Do not delete those projects, backfill signed history, skip invalid entries or weaken
the validator as an ID01 fix. A later migration/legacy-reopen design must decide how to
preserve the original bytes and provenance while presenting historical contracts. This
is a real compatibility project, not another quick win; it remains open and deferred.

## F16 — canonical STEP captures omit exact BRep mass properties (open, deferred)

**Fact-check 2026-09-09: confirmed open.** Tracked in
[GitHub #16](https://github.com/Casys-AI/casys-digital-thread/issues/16).

The current canonical geometry captures preserve exact source and STEP identities, but
they do not publish volume, geometric centroid or inertia as exact BRep properties. The
repository's pinned `occt-import-js@0.0.23` path exposes tessellated meshes rather than
an exact mass-property API. A generic agent therefore cannot presently reopen an
arbitrary current part and cite server-owned exact volume or centroid directly from the
capture contract.

For the six simple ID01 structural sources, this pass used the smallest adequate
workaround: source-derived constructive-solid formulas, exact source/STEP rehashing, and
a fine-tessellation STEP cross-check. The mesh-derived values agreed with the analytical
values within 0.0011 mm³, which is sufficient for this explicitly documentary
occurrence-volume ledger. It is not exact BRep mass-property evidence, an uncertainty
bound, material mass, inertia, manufacturability or flight evidence.

Adding provider-computed mass properties would require a versioned output schema,
unit/provenance rules, deterministic capture/reopen behaviour, coverage decisions for
assemblies and non-solid geometry, and focused provider/runtime validation. That is not
a safe documentation quick win and is unnecessary to answer the current bounded
question. Keep the workaround local to the named simple sources; revisit a registered
capability only when a real downstream decision requires general exact mass properties.
F16 remains open and deferred.

## F17 — official F1404 shaft and `GF3016` identity data conflict (open, external evidence)

**Fact-check 2026-09-09: confirmed open.** Tracked in
[GitHub #8](https://github.com/Casys-AI/casys-digital-thread/issues/8).

The LIGPOWER F1404 KV4600 product table states a 2 mm shaft, while its own official
mechanical drawing labels the projecting shaft `Ø1.5`. The T-Hobby official storefront
also mixes 1.5 mm text with a 2 mm specification image. The current Gemfan Hurricane
3016 page is internally ambiguous: its leading block lists
`1.5 mm, 2 mm, 3-hole design`, while its detailed table lists `1.5 mm, 3-hole design`.
The LIGPOWER bench table names only `GF3016`; it supplies no maker, SKU, revision or
controlled mounting drawing that proves which propeller and interface were tested.

This is a real source-quality and physical-interface friction, not a safe CAD quick win.
Choosing one visible number would silently invent authority and could put holes, a hub
or an adapter into the wrong geometry. Keep both propeller identity and mating interface
`unresolved`; do not modify the `RadialArm`, motor envelope or propeller proxy from
these pages.

The smallest closure packet is supplier confirmation tying the exact bench `GF3016` to
maker, SKU/revision, diameter, pitch, blade count and mounting variant, plus a
controlled motor/propeller interface drawing and explicit resolution of the 1.5-versus-2
mm shaft datum. F17 remains open until that external evidence exists; no provider,
registry, source-workspace or Project mutation is justified by the conflict alone.

The separately documented F1507 KV3800 + T3140 table is an alternative candidate lead,
not a repair of F17. It does not establish that `GF3016` was a T3140, nor does it
resolve the F1404 shaft or motor–propeller interface.

A later bounded official-catalogue search also failed to find a replacement that keeps
the current motor and approximately 3-inch propeller envelopes while joining exact
motor/propeller identity to a published electrical/thrust map. The closest better-joined
iFlight Defender 25 chain is explicitly 2.5-inch and retains its own shaft/interface and
test-condition gaps. This does not turn the search into a market-wide impossibility; it
does show that widening local documentation is no longer the cheap repair. F17 remains
an external supplier-closure friction, not a reason to mutate the current geometry.

## F18 — F1507 ratings and its T3140 bench endpoint disagree (open, external evidence)

**Fact-check 2026-09-09: confirmed open.** Tracked in
[GitHub #9](https://github.com/Casys-AI/casys-digital-thread/issues/9).

The official LIGPOWER F1507 page reports 23 A peak current for 60 seconds and 372 W
maximum power for 60 seconds for KV3800. The same page's F1507 KV3800 + T3140 table
reports 25.87 A and 391.57 W at 100%, with motor-surface temperature after a one-minute
run. The table endpoint therefore exceeds the adjacent 60-second current and power
ratings by 2.87 A and 19.57 W.

This is a literal source contradiction, not permission to choose whichever number makes
the design pass. The documentary pre-sizing note preserves both the row and the ratings,
but treats the 100% row only as a reported bench endpoint. It is not a continuous or
accepted 60-second operating point, and it cannot size the battery, ESC, connector or
thermal design without clarification.

The smallest closure packet is a manufacturer-controlled revision of the KV3800 + T3140
map, explicit allowable-current/power duration and temperature limits, the exact
propeller revision/interface, and the bench ESC SKU/revision, firmware/protocol, PWM,
timing, voltage source and per-plateau durations. A later official-source pass did close
part of that documentary gap: the T3140 card now gives 3.1-inch diameter, 4.0-inch
pitch, three polymer blades, 2 g catalogue mass, a 5 mm mounting hole and 6 mm hub
thickness. The F1507 drawing separately shows a front M5 × 0.8 / Ø5 adapter, and its
packing list names an M5 self-locking nut. This is a coherent nominal chain, not
controlled proof of the bench revision, fit, tolerance, seating, engagement, tightening,
inertia or CW/CCW allocation.

The same F1507 page yields another bounded clarification, not closure. Its matching
guide names Mini F45A 4-in-1 and F7 35A AIO controller leads, while the T3140 bench
table names no ESC, firmware, protocol, PWM, timing or voltage-source identity, and no
duration for the 50–95% rows. F35A appears only as a related product. Per-channel
catalogue headroom therefore cannot reconstruct the bench or establish the shared
four-channel input and thermal limits. The Mini F45A sources also conflict on AM32
versus BLHeli_32.

Until those remaining fields and the 100% limit conflict are closed, the candidate
remains unselected. No solver, CAD edit, provider operation or Project mutation can
correct this external evidence conflict; F18 remains open for supplier follow-up.

## F19 — PM06 V2 output and height fields conflict (open, external evidence)

**Fact-check 2026-09-09: confirmed open.** Tracked in
[GitHub #10](https://github.com/Casys-AI/casys-digital-thread/issues/10).

The official Holybro PM06 V2 product page publishes both `5.2 V, 3 A max` and `18 W` for
the regulated output; the direct arithmetic is 15.6 W. The same product page states 35 ×
35 × 5 mm, while Holybro's analog power-module comparison states 35 × 35 × 10 mm. These
are two source conflicts on the exact component lead, not rounding differences that
Codex may resolve.

The quick response is documentary: retain both literal fields, do not use 18 W as an
auxiliary budget and do not create a PM06 CAD envelope. The later closure packet needs a
controlled electrical specification and mechanical drawing for the selected
SKU/revision. Until then PM06 remains an unselected architecture lead. No local code,
solver or Project mutation can repair the supplier data; F19 remains open for external
follow-up.

## F20 — retained battery leads lack usable-energy evidence (open, external/bench evidence)

**Fact-check 2026-09-09: confirmed open.** Tracked in
[GitHub #11](https://github.com/Casys-AI/casys-digital-thread/issues/11).

The retained battery pages publish combinations of nameplate capacity, nominal voltage,
C-rate, body dimensions and mass. The current dossier has no exact-SKU curve or test
record that joins delivered capacity to current, cutoff, temperature and age. A bounded
recheck of the three named GNB pages also found no published internal-resistance or
delivered-capacity curve. Nameplate watt-hours and `Ah × C` therefore cannot close
`E_usable` or endurance.

This is not repaired by another solver or by renaming catalogue arithmetic
“sensitivity.” Keep `E_usable` unresolved until one selected pack has either a
supplier-controlled curve covering the selected region or a separately authorized,
guarded discharge record with synchronized voltage, current and temperature and a
human-approved cutoff. The present 20.92 A and 24.64 A propulsion rows are screening
points, not automatically safe battery-test setpoints.

Any later physical record remains evidence of its exact article, setup and protocol. It
is not silently stored as sensitivity; `verify.evaluate-sensitivity-base@1` is a
separate registered evaluation over an admitted sensitivity basis. No bench, Project
mutation or sensitivity run is authorized by this friction entry. F20 remains open for
supplier or governed physical evidence.

## F21 — pre-sizing worksheets have no registered Thread publication path (open, deferred)

**Fact-check 2026-09-09: confirmed open.** Tracked in
[GitHub #12](https://github.com/Casys-AI/casys-digital-thread/issues/12).

Live inspection after project r675 confirmed the split visible to the user: the new
mission-shape question exists exactly once and has no answer, while the latest Thread is
still r93 and the run, approval, decision and blocker counts are unchanged. The
read-only Workbench can therefore show the new Project revision and planning question,
but it has no new Thread graph entity to paint on the whiteboard.

This is not repaired by copying the Markdown into draft CAS. `project_resource_capture`
writes one raw draft MCP resource with `grants: none`; unknown files create neither
EngineeringProject nor Thread state. `baseline.from-approved-brief@1` is valid only
before the first documentary Thread snapshot. The electrical and Modelica method-sheet
seals require their own typed schemas and exact admitted run branches. Architecture,
requirements, CAD, proof-case and sensitivity seals likewise have narrower authorities;
using any of them for a mission worksheet would invent a source model, physics case,
MRTR or result.

The registered Engineering Case catalogue contains only mechanical proof, sensitivity,
printability, print estimate and DFM case families. The Overview domain map separately
recognizes exact SysML, geometry, FEA, assembly-integrity, prescribed-kinematics and
Modelica operations. Neither surface defines a pre-sizing worksheet family. Creating a
fake solver run merely to obtain a node would therefore corrupt rather than improve the
digital thread.

A real repair needs a separate versioned capability design: a typed source-backed
pre-sizing evidence schema, exact capture/reopen rules, a registered provider-free
Thread seal, producer and lineage semantics, projection grouping, UI presentation and
focused contract tests. That is broader than an ID01 documentation quick win and could
affect every engineering project. Defer it as a product-capability extension; until it
exists, keep the worksheets documentary and let the next whiteboard node come only from
a semantically valid registered operation over real evidence.

## F22 — a later brief cannot widen an existing capability ceiling (open; ID01 mitigated)

**Fact-check 2026-09-09: confirmed open.** Tracked in
[GitHub #13](https://github.com/Casys-AI/casys-digital-thread/issues/13).

At project r677, pending brief r6 proposes the explicit
`static-structural-fea-sensitivity@1.0` verification authority needed for the next ID01
study. `project_brief_confirm` refused the exact fresh review fingerprints with
`Project already has an operational capability ledger with a different or revoked
ceiling; use a delta amendment instead of replacing its initial authority.`
The refusal is correct in protecting the already authorized ceiling, but the registered
brief confirmation path invokes the initial-ledger preparation path even for a later
brief.

The advertised amendment route is not presently equivalent: capability-change review
derives requested capabilities from the already published plan and current canonical
brief, not from the pending later brief. ID01's published plan predates sensitivity, so
that review cannot authorize r6's new authority. Do not force the old plan, replace the
ledger, or confirm stale brief fingerprints. The smallest repair must preserve the
pending brief's exact reviewed capability proposal and apply a separately reviewed delta
to the existing ledger before that later brief becomes canonical.

For ID01, the live mitigation kept the authority change out of the editorial brief:
brief r7 was confirmed canonically at project r679, then the sensitivity seal and run
were appended to the published plan so the existing capability-delta route could inspect
their actual runtime demand. This unblocks the pilot without repairing the generic
later-brief widening contract; that product hole remains open.

## F27 — sensitivity reuse is not wired into production (open)

**Fact-check 2026-09-09: confirmed open.** Tracked in
[GitHub #17](https://github.com/Casys-AI/casys-digital-thread/issues/17).

The first ID01 study has now completed at Thread r95. The executor implements optional
exact experience reuse and its hit/miss/replay tests, but production composition still
does not inject the coordinator or persistent stores. The current run published a normal
`sensitivity-study` artifact, not a `sensitivity-study-reuse-result`.

The remaining work is to compose the existing reuse path, prove exact-domain reuse and
stale/out-of-domain refusal, and measure warm versus comparable cold execution. No
current ID01 evidence establishes automatic reuse or saved solver time. Operation counts
must not be presented as elapsed-time measurements.

Source checks: `src/adapters/sensitivity/server-composition.ts:183-210` and
`src/adapters/sensitivity/live-fea/analyze-run-fea-sensitivity-run-executor.ts:245-265`.

## F28 — parallel agent edit-attribution incident (historical; current status unverified)

**Fact-check 2026-09-09: `unverified`.** A clean current checkout does not disprove the
historical incident. It only prevents classifying it as a confirmed current defect
without a reproducible concurrent-edit scenario or a defined orchestration contract. No
GitHub issue was created. The account below is historical.

Two bounded Grok implementations used disjoint declared ownership but shared the same
working tree. The metric/binding task correctly noticed additional sensitivity files had
become dirty while it ran, but could not distinguish the sibling template task's edits
from unrelated pre-existing work and began checking whether to restore them. Codex
stopped that session after its focused tests passed and before any cleanup could erase
the sibling change. No project source was lost.

For this checkout, continue to allocate exact file sets, let Codex review the combined
diff, and stop an agent before ambiguous cleanup. A future delegation wrapper could
record each task's baseline and allowed path set or use isolated worktrees before
controlled integration. That orchestration change is outside the ID01 engineering
capability lot; do not solve it by broad resets or by treating all dirty files as agent-
owned.

## F29 — native Grok usage-balance incident (historical; current status unverified)

**Fact-check 2026-09-09: `unverified`.** This says nothing about the current external
account balance. The historical quota event is not evidence of a CalculiX, physics, or
ID01 engineering failure. No GitHub issue was created. The account below is historical.

The bounded CalculiX host-qualification implementation spent eighteen model calls
mapping the existing Chrono-specific service and then exited with HTTP 402
`Grok Build usage balance exhausted` before editing any qualification file. Its
read-only predecessor audit remains usable and Codex independently verified the exact
host/image architecture, but the failed implementation contributed no code or test
evidence.

Do not retry the same monolithic Grok prompt or alter the user's Grok/plugin
configuration. The fallback now uses the explicitly allowed Terra reinforcement, split
into a contract lot, a separate review and a later integration lot; Codex keeps
responsibility for the combined diff, live qualification and engineering claim. This
usage limit is not a CalculiX or ID01 physics failure.

## F36 — completed sensitivity study still needs persisted SysML edges (open)

**Fact-check 2026-09-09: confirmed open.** Tracked in
[GitHub #18](https://github.com/Casys-AI/casys-digital-thread/issues/18).

The registered project snapshot at project r693 / Thread r95 records the completed
`analyze.run-fea-sensitivity@1` run and its study capture. Both base and stepped CAD
phases are published and both CalculiX solves are captured. The former case-only
condition is therefore resolved.

No corresponding ID01 `model.write-sensitivity-edges@1` run or result is present in that
snapshot. Close this remaining sequencing friction only after the registered writer has
persisted and read back the exact SysML relations from the completed study. Preserve the
distinct case, measured-study and derived-edge identities and the isolated RadialArm
bench limitations. A whiteboard-only node cannot complete that operation.

## F44 — candidate qualification has no generic catalogue-activation route (open, deferred)

**Fact-check 2026-09-09: confirmed open.** Tracked in
[GitHub #19](https://github.com/Casys-AI/casys-digital-thread/issues/19).

The active Build123d recovery pin has now been adopted and the ID01 study completed at
r95. This closes the pilot image-availability incident, but does not supply the generic
activation and rollback authority described here.

The maintained candidate path ends at host/runtime qualification with
`eligibleForPromotion=false`. It deliberately neither rewrites the catalogue pin nor
changes the immutable acquisition source. The active Build123d pin and execution profile
remain code-owned and are reconstructed at server start, so a new candidate cannot be
adopted by a low-level tag, digest flag or cache mutation. A dynamic append-only
activation authority would require atomic catalogue revisions, predecessor-linked
rollback, crash recovery, cache coherence and explicit invalidation of pending approvals
bound to the preceding profile.

That platform extension is disproportionate to the ID01 pilot and stays deferred. The
bounded pilot path follows the existing CalculiX local-developer precedent instead:
qualify the exact public ARM64 candidate, review a source-and-target pin change in code,
mark unresolved aggregate-image licence literally, recompute the policy and complete
profile fingerprints while retaining the unchanged `1.0.0` contract version, restart at
a controlled boundary, and obtain a fresh project capability review plus human MRTR
before any run uses the successor runtime. The runtime digest and fingerprints prevent
an old approval from matching even though the semantic profile version stays readable.
This is not production promotion or redistribution clearance. Close F44 only when a
maintained generic activation and forward-only rollback route exists.

## Expected states, not defects

- The old preview was explicitly pinned to TPS03. It correctly ignored the new durable
  focus until Astra restarted only that owned preview without the pin.
- A source attachment becomes `different-basis` after admission/geometry advances the
  Thread. Product inspection offers the explicit recross action. Historical admission
  remains valid; there is no instruction to rerun it or change its bytes.
- The first product inspection request omitted `expectedBasis` and was rejected. That
  was caller error, not a product defect; the corrected request used the full current
  basis returned by Product search.
