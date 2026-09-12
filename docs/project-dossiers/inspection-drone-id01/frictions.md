# ID01 — remaining agent-path frictions

Fact-checked on **2026-09-09** by six Terra reviewers, with final source and runtime
readback checks by Codex. **27 confirmed-fixed entries have been removed.** Saved-state
reread **2026-09-12** of persisted latest
`inspection-drone-id01:project:r882:2de1e90b38a35b6b`, Thread r118
`project:inspection-drone-id01:r118:industrialize-run-dfm-checks-run:id01-queue-dfm-run-board-r1-f52c-20260912`.
This is a documentation read of saved state, not a server restart or live `GET` today.
Canonical brief r7, pending r8 unconfirmed (F22), leftover r2 `ready` (F45). Preferred
HOLD screening lead F1404+GF3016 recorded, SKU not selected. Measured DFM run recorded
Thread r118; sensitivity **case** sealed Thread r117 (F51). Original observations remain
in Git history.

Status groups below replace a duplicated opening total. Source-tested worktree
candidates are not runtime adoption. Tests and runtime evidence support only their
stated scope, not a whole-drone, flight or certification verdict.

The 2026-09-09 snapshot at project r693 / Thread r95 is historical. The RadialArm
sensitivity study and its SysML edge write completed at Thread r96 then r97. GitHub
issues stay English trackers; they are not closed from this saved-state reread.

GitHub issues are in English. They track remaining work; they do not authorize a
provider execution, project mutation or runtime promotion. Older revision references
inside retained entries describe the historical trigger, not the current project tip.

## Remaining product and evidence boundaries (open)

| Friction | GitHub issue                                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F03      | [#22 — Desktop integration: expose Digital Thread project-control tools in the active Codex host](https://github.com/Casys-AI/casys-digital-thread/issues/22)   |
| F13      | [#14 — Add a governed propulsion and energy pre-sizing capability](https://github.com/Casys-AI/casys-digital-thread/issues/14)                                  |
| F16      | [#16 — Add exact BRep mass-property evidence for canonical geometry](https://github.com/Casys-AI/casys-digital-thread/issues/16)                                |
| F17      | [#8 — Engineering evidence: close the F1404 KV4600 / GF3016 propeller-interface packet](https://github.com/Casys-AI/casys-digital-thread/issues/8)              |
| F18      | [#9 — Engineering evidence: reconcile F1507 KV3800 / T3140 operating limits and bench configuration](https://github.com/Casys-AI/casys-digital-thread/issues/9) |
| F19      | [#10 — Engineering evidence: resolve PM06 V2 output-power and height discrepancies](https://github.com/Casys-AI/casys-digital-thread/issues/10)                 |
| F20      | [#11 — Engineering evidence: establish usable-energy evidence for the selected ID01 battery pack](https://github.com/Casys-AI/casys-digital-thread/issues/11)   |
| F21      | [#12 — Add a registered Thread publication path for source-backed pre-sizing worksheets](https://github.com/Casys-AI/casys-digital-thread/issues/12)            |
| F22      | [#13 — Allow a reviewed later brief to authorize a capability-ceiling amendment](https://github.com/Casys-AI/casys-digital-thread/issues/13)                    |
| F27      | [#17 — Wire exact sensitivity experience reuse into the production composition](https://github.com/Casys-AI/casys-digital-thread/issues/17)                     |
| F44      | [#19 — Add a governed generic activation path for qualified first-party microVM candidates](https://github.com/Casys-AI/casys-digital-thread/issues/19)         |

## Remaining live ID01 leftover (open until human action)

| Friction | Note                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| F45      | Orphan `wi-proof-seal-id01-camera-bracket-bench-r2` remains `ready`. Source abandon path is a candidate, not executed. |

## Source-tested candidates (not runtime-adopted)

Isolated-worktree source. Not an active Workbench or provider proof.

| Friction | Note                                                                                                                                                                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F15      | Discoverability v2 source accepted (47 targeted tests). Offline candidate projection is `partial` on the original 10 heads; the candidate route is not runtime-adopted and v1 `/api/projects` stays 503. Historical-head reopen as current remains deferred ([#15](https://github.com/Casys-AI/casys-digital-thread/issues/15)). |
| F45      | Abandon transition reuses snapshot-validator cancellation constraints; 43 service tests and 2 MCP tests. ID01 orphan still `ready`.                                                                                                                                                                                              |
| F47      | Overview hull keeps an available nonempty occurrence tree with 0 CAD joins; 37 focused tests. DFM hulls: 53 UI + 1 membership. Not runtime adoption.                                                                                                                                                                             |
| F49      | Camera bracket 2 hops / 2 historical `PASS`; RadialArm 1 hop / 2 historical `PASS`; `historicalEvaluations` + `sourceArtifacts[]`. Current r882 bench rows stay `pass`; historical evaluations do not authorize them.                                                                                                            |

## Closed-in-live on this atelier

GitHub trackers are not closed from this reread. F46 and F48 are specific successful
workarounds, not generic parser or architecture-guard fixes.

| Friction | Note                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| F36      | SysML sensitivity edges persisted Thread r97. [#18](https://github.com/Casys-AI/casys-digital-thread/issues/18) may still be open. |
| F46      | Recapture of both requirement families cleared the Thread/SysML basis `-32603` after architecture r98.                             |
| F48      | Derived `lower_y`/`upper_y` inlined in `id01-camera-board-envelope@3` instead of rewriting architecture.                           |
| F50      | Canonical STEP attestation accepted after focused tests; CameraBoardEnvelope DFM case sealed Thread r115.                          |
| F51      | Case identity includes cadSource digest; case sealed Thread r117. No new study execution, reuse or speedup.                        |

## Recorded result with remaining authority limitation

| Friction | Note                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F52      | Capture `dfm-check-a023abdc…` recorded Thread r118. Trusted-binding / planner-sort hole was historically corrected. MRTR basis r115 executed against r117. |

F14, F28 and F29 remain `unverified`; no issue was created for them. Their historical
incidents have neither been disproved nor confirmed as current failures.

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

Project r672–r674 recorded the human priority and a then-pending brief r5 for a sourced
mass–thrust–power–energy–endurance balance. Brief r7 later became canonical; F13 is
unchanged as a missing registered capability. Inspection of the current operation
registry found no generic propulsion/energy pre-sizing route. The capability proposal
returned by the brief review remains unchanged and still awaits confirmation: existing
CAD, SysON, assembly-integrity and single-part static-FEA surfaces do not become an
aerodynamic or battery-system solver merely because the new question exists.

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

## F15 — preview catalogue exposes historical validator drift (discoverability source accepted; legacy reopen deferred)

**Fact-check 2026-09-09: confirmed open** as all-or-nothing catalogue 503. Tracked in
[GitHub #15](https://github.com/Casys-AI/casys-digital-thread/issues/15).

**Discoverability source accepted 2026-09-12** (47 targeted tests).
`GET /api/project-discovery` returns `native-workbench-project-discovery/2.0`. Available
entries come only from the existing `store.get`. Unavailable entries keep
`identityAuthority=observed-storage` plus a closed reason. An offline read by the
candidate reader over the original persisted heads returned `partial` (10 candidates):
available inspection-drone-id01 r882, modular-sensor-mount-msm01 r97,
two-piece-tablet-stand-tps01 r111, tps02 r128, tps03 r135; unavailable
`validation-failure` desktop-parts-sorter-ps01, motorized-camera-slider-mcs01, mcs02,
precision-heated-specimen-stage-hs01, spice-lifecycle-pilot-sl01. Legacy
`GET /api/projects` (`native-workbench-project-catalog/1.0`) remains all-or-nothing HTTP
503 on that storage, with literal
`Persisted project revisions could not be reopened exactly.` The candidate route has not
been runtime-adopted. A higher symlink head is refused without falling back to an older
JSON. Same-metadata different bytes is `changed-during-read`. Preview and Desktop
compose discovery beside v1 catalog and existing `historyEvidenceCaptures`. There is no
`GET /projects/<id>` and no `projectId` query selector. Ask the paired assistant to
choose the project; `cockpit_focus_set` stays the MCP routing authority. Workbench stays
`GET` + SSE; no command UI.

Historically, checkpoint `033a0dc8` closed the preview CLI wiring omission: 54 targeted
tests plus type, format and whitespace checks passed, and the same pinned ID01 Workbench
on 2026-09-09 stayed HTTP 200 while `GET /api/projects` (v1 catalog) returned HTTP 503.
Do not delete those projects, backfill signed history, skip invalid entries or weaken
the validator. Reopening historical contracts **as current** heads remains a separate
deferred compatibility decision. F15 discoverability does not execute or migrate those
bytes.

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
mission-shape question exists exactly once and has no answer, while the Thread at that
observation was still r93 and the run, approval, decision and blocker counts were
unchanged. The read-only Workbench could therefore show the new Project revision and
planning question, but it had no new Thread graph entity to paint on the whiteboard.
Saved-state **2026-09-12**: Thread is now r118; the missing pre-sizing-worksheet
publication path remains. No worksheet was promoted into a fake solver node.

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

**Live hit 2026-09-11.** `project_brief_propose` wrote pending brief r8
`inspection-drone-id01:brief:r8:fb658801b1b1c693` (long-term continuation objective,
`mutatesRuntime: false`). `project_brief_confirm` refused the exact fresh fingerprints
with the same F22 message. Canonical brief remains r7. Do not retry confirm with those
fingerprints, do not replace the capability ledger, and do not treat the pending r8 as
approved. The TUI `/goal` command is a separate session driver; it is not a brief or a
Thread document. The documentary `long-term-objective-20260911.md` page was removed once
that `/goal` was set.

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
must not be presented as elapsed-time measurements. Do not invent reuse or comparative
elapsed measurements from the Thread r117 case seal.

**Source accepted 2026-09-12:** session-bound factory/coordinator, 47 targeted tests,
`deno task check` on that graph, and removal of the unused
`docker-sensitivity-solver-runtime-authority` adapter. Behaviour tests use fake
runtime/CAD/solver and temporary stores. No live production exact reuse, no measured
saved solver time, and no runtime composition claim. The Thread r117 artefact remains a
**case**, not a study execution or reuse receipt. F27 as a product boundary stays open
until live reuse evidence exists.

Source checks at the 2026-09-09 observation:
`src/adapters/sensitivity/server-composition.ts:183-210` and
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

## F36 — completed sensitivity study still needs persisted SysML edges (closed-in-live)

**Fact-check 2026-09-09: confirmed open at r693 / Thread r95.** Tracked in
[GitHub #18](https://github.com/Casys-AI/casys-digital-thread/issues/18).

**Live reread 2026-09-11: closed-in-live.** Thread r97 records completed run
`run:queue-sensitivity-edges-72093069-r96-r703` (`model.write-sensitivity-edges@1`,
summary: inserted server-rendered sensitivity edges into SysON). The 2026-09-09
sequencing hole is therefore closed on this atelier. GitHub #18 is not closed from this
reread. The study remains a local 5–6 mm `arm_height` neighbourhood under the sealed
load, material, mesh and boundary conditions; it is not vehicle qualification or flight
evidence. The leftover camera-bracket r2 work item is **F45**, not this entry.

## F45 — leftover camera-bracket proof-seal r2 remains `ready` (open)

**Observed 2026-09-11.** No GitHub issue yet. Project Path Physics 18/20 Planned is this
orphan, not the Overview FEA classifier.

`wi-proof-seal-id01-camera-bracket-bench-r2` is still `ready`. Decision
`dec-proof-seal-id01-camera-bracket-bench-r2` is `approved`. Associated run
`run:id01-queue-bench-r2-seal-20260907` is `cancelled` before claim (`claimedAt` /
`startedAt` absent, `evidenceRefs: []`). Camera-bracket bench r3 later sealed, executed
and accepted.

`project_work_item_abandon` historically refused a work item that already has a run, and
refused an approved decision in `decisionIds`. `deno task recover:work-item-successor`
inspects the orphan with `suggestedSuccessors: []`. Applying r3 as successor is a tested
refusal: different `activityId` and no `predecessorRevisionId`. Do not fake the Path
count by treating `abandoned` as `completed`. Leave the leftover visible.

**Source candidate 2026-09-12** in `abandon-work-items-transition.ts`: reuse the
snapshot-validator's cancellation constraints. Allow abandonment only if every
associated run was cancelled before claim and has no execution evidence. Preserve
cancelled runs, receipts, history and approved decisions when `decisionIds` is empty;
explicitly abandoning an approved decision is still refused. Focused tests: 43 service
tests and 2 MCP tests. The live ID01 orphan remains `ready` until a separate human
`project_work_item_abandon`. No faked successor or project completion. The source path
is not executed in this documentation pass.

## F46 — compilation preview cannot read Thread/SysML basis after architecture r98 (closed-in-live)

**Observed 2026-09-11**, then recapture. No GitHub issue. Same class as historical F08,
on architecture
`architecture-1782bbb8e7e3a3fdf97ccec9613d243214a946b525d83e6714e95c2b68d8cdd9`.

Camera-board source analysis passed (`parser.passed`, seven named levers including the
four hole handles). `project_technical_compilation_preview` then returned MCP `-32603`
`The exact Thread/SysML basis reader failed` until both requirement families were
recaptured: CameraMountBracket `model.recapture-requirements@1` (project r722 / Thread
r99) and RadialArm `@2` (project r729 / Thread r100). The retry was no longer that
`-32603`. This is a successful ID01 recapture workaround, not a generic parser or
architecture-guard fix. Do not treat the historical incident as a Build123d parser
failure or weaken the architecture-equality guard.

## F47 — Geometry hull flattens when CAD is unjoined (open, UX)

**Observed 2026-09-11** on Workbench `http://127.0.0.1:5173/` Geometry hull. No GitHub
issue yet. Presentation only; the empty CAD join after an architecture rewrite is
correct. The defect is how Geometry shows that state.

After architecture r98, SYSML still indented `InspectionDrone` → `airframe` → parts.
Hierarchy was `available`, 29 nodes, 28 with `parentId`, **0** with
`geometryArtifactId`. Historical CAD stayed as-assembled against architecture r70 and
was correctly refused as current-architecture CAD (`uniqueCadPrimary` empty;
as-assembled child does not claim current-architecture CAD). Waiting does not fill that
join; rewriting architecture would widen it.

The Geometry hull only tree-anchors when an occurrence `geometryArtifactId` is among its
own cad-model artifacts (`buildOverviewHullContents` `anchored`). Otherwise it falls
through to `mode: "records"` — a flat dump of STEP/GLB rows. That looks like the product
vanished. SYSML does not: it stays architecture-anchored. Do not invent folder parents
from labels.

**Live 2026-09-11 after CAD republish** on architecture-1782bbb8 / Thread r108: 29/29
nodes carry `geometryArtifactId` again (root `geometry-2c93a4b8…`). That restores the
join; it does **not** close this UX. The same flatten will recur on the next
architecture rewrite until Geometry, when unjoined, still shows the occurrence tree with
an explicit unjoined / pending-CAD state instead of a flat record list. Close only then.

Human **2026-09-11**: keep F47/F49 open; recross/UX later. Do not treat a new CalculiX
run as the close for this flatten.

**Source candidate 2026-09-12** in UI `overview/hulls/content.ts`: retain an available
nonempty occurrence tree with 0 CAD joins, show explicit unjoined / pending-CAD detail,
and emit no action or graph refs for those rows. Missing or `unavailable` hierarchy
still falls back to records. Focused tests: 37. DFM hulls (53 UI + 1 membership): family
`dfm` compact case/result/five observations, three requirements and three evaluations in
their lanes; STEP stays Geometry; one exact capture App via identity aliases. Source
only; not runtime adoption.

## F48 — derived `lower_y`/`upper_y` blocked CameraBoardEnvelope admission (closed-in-live)

**Observed 2026-09-11.** No GitHub issue. After recapture cleared F46 and
`project_source_attachment_recross` cleared `attachment.different-basis` plus the
non-unique `result` join, compilation stayed `unresolved` with `binding.missing` /
`no-unique-AttributeUsage` on `lower_y` and `upper_y`. Those names were derived
assignments, not sourced handles. Architecture r98 already declared the seven scalar
levers. Rewriting architecture to add derived coordinates would have unjoined CAD again.
File successor `id01-camera-board-envelope@3` inlined the same expressions (`height`,
`inset`, `pitch_z` unchanged). Preview then `ready-for-review`; admission sealed at
Thread r101. This is a successful expression-inlining workaround on that file, not a
generic parser or architecture-guard fix.

## F49 — recaptured requirements show `unresolved` while historical FEA `pass` still exists (open, UX)

**Observed 2026-09-11** on Workbench `/api/thread/workbench` at project r783 / Thread
r108. No GitHub issue yet. Presentation of a real empty evaluation join, not a deleted
CalculiX run.

`model.recapture-requirements` after architecture r98 published new requirement
projection identities (`requirement-4488a613…-camera_bracket_bench_max_von_mises_pa`,
`requirement-7f206ff76…-radial_arm_bench_max_displacement_mm`). Native SysML element ids
are unchanged (`aa7c4627…`, `07e458ff…`). The projector joins canonical evaluations only
to those current ids (`projectRequirement` → `No canonical evaluation recorded.`).

Live Workbench therefore lists both bench requirements as `unresolved` with empty
`observationIds`. The Thread still holds the solver results, observations (0.007638 MPa
/ 0.129255 mm), SysON evaluation evidence, and L5 accept documents, plus current
engineering cases `id01-camera-bracket-bench` r3 and `id01-radial-arm-bench` r2.
Observation `requirementIds` are empty, so Physics shows measurements without a `pass`.
Do not treat this as a new fail, and do not invent a CalculiX replay to “restore” the
label. Close only when the current requirement projection recrosses the existing
evaluation or shows an explicit historical-`pass` / unjoined state.

Human **2026-09-11**: recross later. A new isolated run against the **current**
requirement projection may publish a new L4/L5 join (visible Pass) without closing this
UX: that is a new proof, not an automatic recross of r85/r89. G0 speed/energy hypotheses
are not CalculiX `@3` loads; do not encode 2 m/s or HOLD watts as a proof-case force.

**Source follow-up accepted 2026-09-12.** Read-only original ID01 Thread r118 / project
r882: both current bench rows remain `pass` —
`requirement-4488a613ba6ffd5baea9626302a7e97ff8d37061bfb63892f91a41ad69dd5df9-camera_bracket_bench_max_von_mises_pa`
(complete **2 hops** / **2 historical `PASS`**) and
`requirement-7f206ff76ab6ab232cb7293a2b8df6cccbb0c241e5bc3e1dac09df09e8e3f6db-radial_arm_bench_max_displacement_mm`
(complete **1 hop** / **2 historical `PASS`**), including measured study `72093069…` and
evaluation `9bf8e4d4…`. Collection is plural `historicalEvaluations`; observation
provenance is plural `sourceArtifacts[]`. A first hop with zero evaluations is an
explicit partial diagnostic (`hops: 0`), not an invented evaluation. 42 typed tests plus
UI type check; current facts and source bytes unchanged. The projection preserves every
current `pass` / `fail` / `unresolved` / observation id. Historical evaluations stay
separate: they do not cause or authorize those current `PASS` rows. Do not recross
automatically or imply runtime adoption. The 2026-09-11 `unresolved` incident above
remains historical; F49 stays open for live Workbench adoption of that projection.

## F50 — DFM seal refuses canonical STEP `cad-asset` (closed-in-live)

**Observed 2026-09-11.** No GitHub issue. `industrialize.seal-dfm-case@1` required the
named artefact to be `mediaType: model/step` **and**
`producer.tool: design.write-geometry@1`. On ID01 CameraBoardEnvelope:

- `geometry-b5902310…` — producer `design.write-geometry@1`, media `application/json`
- `cad-asset-b5902310…-target-0-2572f73d…` — media `model/step`, producer
  `build123d_export`

**Closed-in-live 2026-09-11.** `attestCanonicalWriteGeometryStep` joins the STEP child
via `cad-asset-<capture>-target-<n>-<stepDigest>` (or PartDefinition `…-definition-…`)
to parent `geometry-<capture>` with producer `design.write-geometry@1` by exact capture
digest, role and STEP digest. Isolated CAD stays refused. Dirty source attestation is
accepted after focused tests. Seal r1e retry completed: Thread r115 artefact
`dfm-case-3ab2905dcce20501f5c7563fd59bcdc03512e61cb27e67e92fa5e51a62511a37`. Measured
run remains F52.

## F51 — sensitivity study seal blocked on current tip (closed-in-live)

**Observed 2026-09-11.** First review `admission-unavailable`, then
`compiled-identities-conflict` on unsuffixed r94 ids.

**Closed-in-live 2026-09-12.** Case identity includes the cadSource digest:
`wi-sensitivity-seal-${caseId}-${cadSourceSha256.slice(0,16)}`. Historical unsuffixed
r94 ids stay untouched as a different activity. Seal completed Thread r117 artefact
`sensitivity-case-a737046b21c7f6e61fa479c13e60511aa1cd78e765ce0349f052cd6249e3d9ee`
against admission `technical-compilation-admission-b0e5ba4d…`. Work item
`wi-sensitivity-seal-id01-radial-arm-height-isolated-b0e5ba4d4a9a434b`. This is a
**case**, not a new study execution, reuse or speedup. Not a vector-correction grant.
Consumer run/eval is a later hop (HTTP CalculiX remains unqualified). F27 remains the
production-reuse boundary.

## F52 — measured DFM run recorded; exact MRTR basis still an authority limitation

**Observed 2026-09-11.** Queue refused: no trusted binding for
`manufacturing.run-dfm-checks@1/execution`.

**Recorded 2026-09-12, not unqualified closed-in-live.** The trusted-binding and
planner-sort subproblem was corrected historically: catalogue unit
`casys.mcp-dfm@0.1.0`, H1 group `casys-mcp-dfm@1.0.0`, binding `mcp-dfm-measured-checks`
`qualified`. Planner sorts semantic requirements, bindings and host-effect lists the
same way amendment reconstruct does, so YOLO amend of the ID01 ceiling succeeds.

The recorded capture remains readable and is not erased or upgraded to a valid exact
approval. Decision `decision-run-dfm-id01-camera-board-envelope-mk4s-r1` and approval
`approval:decision-run-dfm-id01-camera-board-envelope-mk4s-r1:id01-propose-dfm-run-board-r1-20260911`
carry `baseSnapshot` Thread r115
`project:inspection-drone-id01:r115:industrialize-seal-dfm-case-run:id01-queue-dfm-seal-board-r1e-retry-f50-20260911`.
Completed run `run:id01-queue-dfm-run-board-r1-f52c-20260912` executed against Thread
r117
`project:inspection-drone-id01:r117:analyze-seal-sensitivity-study-run:id01-queue-sens-seal-arm-height-b0e5ba4d-20260912`
and published Thread r118 artefact
`dfm-check-a023abdcedb3bc50920af6c2d6d4e89600c0b971f0b6c55128c076a45d9b16d6`. That
confirmed MRTR regression let an r115 approval/decision basis execute against r117.
Treat it as an authority limitation, not a cosmetic warning and not an approval
recovered retroactively.

Source now checks exact `snapshotId` + `revision` + `subjectId` on **both** decision and
approval, plus existing fingerprint equality. Ten executor tests passed, including
missing/wrong revision/id/subject. The recorded DFM capture stays
authority-`unavailable` on that historical r115/r117 mismatch. Closing authority needs
that source **and** a **fresh** exact approval/execution; never a retroactive repair of
the old MRTR. The three recorded `pass` values remain evidence, not restored authority.
Previous failed attempt `run:id01-queue-dfm-run-board-r1-f52-20260912` remains history.

**Source and local Workbench update 2026-09-12.** Queue, executor and viewer now share
the domain-owned `recrossDfmRunAuthority`. The registered DFM queue refuses a stale
approval before eligibility/runtime lookup or run publication. The targeted domain,
queue, executor, viewer and architecture suites pass: 78 tests, 0 failures. The local
DFM App package is installed and its real Workbench viewer opens with the literal
r115/r117 refusal; no hull was changed for this correction.

Fresh decision `decision-run-dfm-id01-camera-board-envelope-mk4s-r2-authority` is
proposed on exact Thread r118, with input fingerprint
`37157a666c6dc99b5ecbdbd3705ce2b8c2b4682dd1f7249eb25f134af7a0db83`. Production readers
reopened the unchanged sealed case and canonical STEP; the seven run parameters preserve
the declared Z-min filter. After explicit user approval “oui oui yolo”, official
`start:yolo` recorded the human approval on this exact r118 basis and fingerprint
(Project r885); queue recorded `run:id01-yolo-queue-dfm-r118-authority-20260912` at
r886. That attempt is `failed` before a durable Thread write: direct HTTP could not
reach DFM (`fetch failed`). Project r888 and Thread r118 are unchanged after the
failure. This attempt and its dispatched WAL remain immutable.

**Runtime composition correction accepted 2026-09-12.** Measured DFM now uses the
existing authorized JIT session and fixed lease-bound MCP publication. It stages exact
canonical STEP bytes to server-derived `/tmp/dfm-<sha256>.step` in the unique owned
exact-image container, independently checking SHA-256 and byte count before claim and
dispatch WAL. The sealed `/exports` volume stays read-only, with no image or
launch-group change. The shared container ownership/staging primitive is extracted from
CalculiX; each factory keeps its own literal topology. 61 retained targeted tests and 9
architecture-boundary tests pass; changed-source fmt/lint/typecheck and server
composition pass. Two new source-string snapshot tests are excluded from the delivery;
composition is reviewed directly and dependency boundaries use the existing scanner. The
authorized r118 calculation remains to be completed through a fresh queue of the same
work/approval; historical evidence is never repaired retroactively.

Recorded checks (sampling / screening, printer not selected): envelope 25 × 24 × 11.5 mm
`pass`; sampled minimum thickness 0.9149495583883871 mm against 0.8 mm `pass`; overhang
bed-contact centroids z = 0 excluded by declared 0.2 mm Z-min filter, 0 remaining,
`pass`. Not a printer SKU. No flight, strength or manufacturing authorization. Root
Compose on 3018 collides with the H1 group.

**DFM recorded viewer source** (unpublished):
`/Volumes/DEV/Projects/mcp-dfm-viewer-20260912` (`io.casys.mcp-dfm.results`
`0.3.0-local.viewer.1`, `ui://mcp-dfm/results-viewer`, `viewer.session.apply`). Local
commit `e763d96c2c58274048d6bf35f1cfb15148cba0f0` (parent `85a62804…`); bundle 780178
bytes, SHA-256 `2fd82bf83bbba5c01cf2848d43da968597047a6fb99b52914825c50e41c74bd1`.
Independent `release:check`: 52 server tests, 5 model tests (native Gmsh ignored).
Fake-host harness accepted light, dark and 480 px; screenshot is a **synthetic**
fixture, not the saved ID01 capture. Shared build provenance:
`mcp-view-host-context-fix-20260905` commit `b08802df353bb25d25a1c8d64b22ea61b5287ae0`
(view 0.9.3, view-contracts 0.1.0, view-components 0.9.0). DT binding: 15 targeted tests
plus pure provider-parser recross (exact available / historical cross-revision
`unavailable`). Hulls: 53 UI + 1 membership. Workbench remains generic read-only `GET` +
SSE. Production solver pin stays `0.1.0` while provider source is `0.3.0`. Legacy
recorded `0.1` captures lack newer quality fields: show `not recorded` / `unavailable`,
never infer quality. No install, publication or runtime adoption. Private `stagedPath`
stays off the App.

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
