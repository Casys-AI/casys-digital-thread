# ID01 - camera/deck geometry rebuild and current static checks

Observed 2026-09-07 UTC in the local atelier. Documentary ledger, not an alternative
authority, a physical-joint proof, or a completed-project declaration.

## Result and exact current basis

At project r583, the current Thread is r82:
`project:inspection-drone-id01:r82:decide-accept-assembly-integrity-evaluation-run:id01-queue-root-rebuild-l5-20260907`.

The proposed camera counterpart holes now exist in canonical CentralDeck geometry.
Airframe and InspectionDrone were rebuilt explicitly; both new modules received separate
real L3 observations, provider-free L4 passes for the five registered static criteria,
and documentary L5 accepts with `gateClaims: []`. The requirement-linked bench successor
remains unexecuted because its seal reached a separate lineage-review limit.

## Source, admission and manual reconstruction

- The [camera/deck proposal](sources/camera-deck-interface-provenance.md) and unchanged
  `id01-central-deck@2` source have SHA-256
  `8daabdc7553683dcd28109a53157f0e0012847063652f0258109cebda576d924`. Admission at
  Thread r72:
  `technical-compilation-admission-9824a8597fc644e861a5007a14480d65644b9ab3f22bef12285e272e055b9fa5`.
- Current architecture:
  `architecture-8fdff1a0ac8c93b98e4c70074a32788044b724955d067bcaf4e384bb984e99f1`. Its
  exact new structural capture was sealed at r73:
  `part-definitions-0f86b7224cd7e9905118d2d2af78c2b963eea1abd9fec15f0785e53157b8375d`.
- The F09 coexistence correction was implemented by native Grok, reviewed and integrated
  by Astra, and adopted by the owned local server. The focused main source suite passed
  207 tests; type checking, scoped formatting and diff checks passed. This was a scanner
  correction, not a provider/image change or module-to-part conversion.
- CentralDeck was sealed at r74. Normal dependency retirement archived only the previous
  deck `4faa5c5b7acea9c2a2fb321d1b29c88a6bcf08280fbc9afa3f75254b7b3642ec`, Airframe
  `a0844bbbb7a5a1c56adc72de11a5940a29fdfc9fb82238c8b027487a8e1168c4`, and root
  `c9dbd7fd0a2392cf5f470cfa00a0be45501291e2102f2f732336e42ac5b021c1` primary families.
  Their historical captures remain; no ancestor was auto-rebuilt.
- All five unchanged [Airframe placements](sources/airframe-placements.json) were
  recrossed together at workspace r119, each attachment becoming revision 2. Analysis
  SHA-256: `39eb66120e0ef20477536f5da6be4f1ca5acb9c3c62befc6d88afbb6974dbde1`. The new
  module consumes four unchanged radial-arm occurrences and the new deck.
- All six unchanged [root placements](sources/root-placements.json) were recrossed
  together at workspace r120, each attachment becoming revision 2. The original file
  `id01-root-placements@1` remains 2,152 bytes, SHA-256
  `92610ea558a523d5ca64b83509879db737880c4e6c2674a1158e547a3cb6b0fc`. New placement
  analysis: `2eda0bbe6be4f37d540262040ec7244ba5856ba1d5362afadce8f347b0a1d424`.
- The new root consumes the new Airframe plus the same five exact sibling module
  captures recorded in the [historical root canary](nested-root-canary-20260907.md). It
  does not regenerate sibling parts. At r82 there are 19 active primary geometry
  captures: twelve part targets, six subsystem modules and one root.

| Target          | Seal Thread | Canonical capture SHA-256                                          | STEP SHA-256                                                       | STEP bytes |
| --------------- | ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------- |
| CentralDeck     | r74         | `335e7a221bacd2b72b635ee02632af17fc711a594c6947db507581e5822950ed` | `9213a54a7c3ce0a4141366c5ab1b2e9dbc0a2dbedc84f06bab013a22e65b9ce3` | 52,872     |
| Airframe        | r75         | `a76935c3d030939f7c5445ad75a62338c46740c15ceb14285ed3aad83df27994` | `d729544cd5899b46bffe910b6311792c173a8b4b1d401278fb45c94dc1061e3b` | 150,896    |
| InspectionDrone | r79         | `49ac15e61b18c775ed3bd24f16ac3e7499fa6fceebe2bd4c5e2854e58b5158aa` | `a59064588e50bef545ec47a83f847cb549321ffd26d9691863d341c88d0fcc37` | 587,056    |

The Airframe input bundle is 146,935 bytes,
`142ba020cc7386f74c76b4249a1b89ed1db6f22b681d441dc490c86349c67cf9`. The root input
bundle is 571,965 bytes,
`03e644a4fec7a51034dfbe165e286a7cd73da5a87cb45543ada5de09503f6d4f`. Their separate
export runs are
`geom-mod-export-809dbb593f3de7abd968165b5f999b711b2ada7b82a4ca332574e37a0595b4ff` and
`geom-mod-export-988b3efd2e8c9cf8abb13f2474fc72fe4e85a2f0003f8bc7d4ac25597dc63f4c`.

## Independent L3, L4 and L5

| Module          | L3 Thread / capture SHA-256                                              | L4 Thread / capture SHA-256                                              | L5 Thread / capture SHA-256                                              |
| --------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Airframe        | r76 / `453b9b414fad57dc8644c93008b7ab339babeda9b137a97d767c7a06dcad371a` | r77 / `8e305a399223589a19fced909bf4b86b2e96a2b2af679deb13ea543015d5d91a` | r78 / `54ee26b575517a31f10f10c499ffe097675a69809afb8e7361734fd99677207d` |
| InspectionDrone | r80 / `96ee786e9b01815e4a87ae035c74edeb19550e090f8775beb3ceb03dbdd490bc` | r81 / `9a13335623fda4b8fb57d94043b7849108db3fd6d2e0c8830b953bbcf5551aac` | r82 / `f95a941bc7e1e3718c2ddfce49965f04c142fb4b9d40e4aaf901a5da42048e3b` |

The L3 observations record 5 occurrences / 10 pairs for Airframe, and 6 occurrences / 15
pairs for the root. Every pair's intersection volume is observed as zero. BRep is
`valid`; shell counts are 5 and 22 respectively, with no free or degenerate edges.

For each module, `assembly-import`, `occurrence-coverage`, `placement-recross`,
`brep-validity` and `pairwise-intersection` are all `pass`. Each L5 preserves zero gate
claims and all physical exclusions. These are neither generic SysML requirement
evaluations nor proof of required contact, clearance, fastening, strength or flight.

Astra reopened and independently rehashed the active geometry captures, their exact
STEP/GLB assets, and all six new L3/L4/L5 captures. The read-only audit is retained at
`id01-interface-closeout.Rj6YiV/inspect-current.ts` in the local-only atelier audit
directory (not distributed in the source checkout). It verifies these stored bytes and
facts, not a second solver result.

## Fresh bench requirement verification remains open

The [case revision 2](sources/camera-bracket-bench-proof-r2.json) preserves the original
target, RequirementUsage, material, mesh, supports, loads, units and scalar stress
criterion. Only its revision and explicit revalidation boundary changed; the original
[revision 1 file](sources/camera-bracket-bench-proof.json) is preserved unchanged.

- Raw resource: 5,235 bytes, SHA-256
  `ab521d168429e20de8d15b6b160d9aa88e888552d47476b04774b32149a314b6`.
- Parsed case capture:
  `54af62017ea73d3ad5ac439f314af00dfd17a810df74d2174898983424e7929b`.
- Workspace file `id01-camera-bracket-bench-proof@2` at r121; its exact verification
  attachment was recrossed to revision 2 at r122.
- Public seal review resolved against current requirements
  `requirements-CameraMountBracket-c99285e11e19c3b0756566d8d415f7b983e910ef92d47633c3255ebf437c5080`
  and the original unchanged bracket STEP.
- The reviewed seal was queued as `run:id01-queue-bench-r2-seal-20260907`, but execution
  refused before claim:
  `proof_case_lineage_review_required: ancestor traversal exceeded the explicit 50-revision review bound.`

This anti-removal check must reach the Thread root to prove that this new proof digest
was not carried and then removed. No registered operator-review continuation exists. The
run remains `queued`, with no execution claim or evidence. No new proof was sealed and
no new CalculiX run or requirement verdict exists. The old requirement-linked bench pass
is historical; the recaptured requirement still has no current evaluation. A new
explicit generic lineage-review route requires a separate authority decision; raising
the constant, accepting a bypass flag, or copying the old pass is not a remedy.

## Current read-only presentation

The trusted registrar preserved all 25 previous bindings unchanged and added seven exact
project r583 / Thread r82 bindings: six subsystems and the new root. The registry now
has 32 entries. No App source or provider image changed.

The published whole-App `io.casys.mcp-build123d.results@0.6.2` loaded the exact new root
GLB (602,520 bytes, `cd5dd9897da7c89ea464fb34b493764450947319f5345f859c6ff3609ef1167d`)
and Airframe GLB (296,528 bytes,
`4e2bb2c6a9a2dfd6db696c69c5053efd3e8fb28b96295123761b430d7fe706ab`). Fresh browser
checks opened each exact artifact's App, verified its digest, displayed a canvas and
exercised Fit/zoom. There were no page exceptions or mutating API requests. The existing
unsupported `webrtc` CSP-directive warning remains. Astra inspected both rendered
canvases; mesh/node counts are presentational, not engineering part counts.

Local-only audit files in atelier directory `id01-interface-closeout.Rj6YiV/`:

- `check-root-viewer.mjs`:
  `11a8a1e62aa994520722d9969f11591fb56216b741afb6daf95b2ba0716241b5`.
- `root-camera-interface-canvas.png`:
  `1562cbc736cb10d44de0542daa661a07f71b915abf1061d2547313e0f40e7818`.
- `root-camera-interface-whiteboard.png`:
  `5dd4e7219d1d30ca35ac0009d47f958e41192746d1284ff2d36b4bf821939cbc`.
- `check-airframe-viewer.mjs`:
  `52f35696ec4e4e49ae1f727beda32a0f4524d9bdc3011264d5cee595b99b556f`.
- `airframe-camera-interface-canvas.png`:
  `8606e4560af5893abee7101f5e2d507c184722340b0c87b71ca6b0900ef78dc1`.
- `airframe-camera-interface-whiteboard.png`:
  `78ed26e1943113b687d67ffe06d9a1c547e70720355318b750f9b93dade3eeb4`.

The historical [remaining-boundary record](remaining-integration-boundaries.md) stays
immutable. F08 and F09 are now closed, and the proposed deck holes are now canonical;
its unmodeled physical-interface and operational limitations remain unresolved. No
manufacturing, procurement, flight or certification branch is opened by this ledger.
