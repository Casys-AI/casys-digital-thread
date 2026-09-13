# ID01 — theoretical RadialArm bench proof revision 2

Observed 2026-09-08 UTC. Local evidence ledger; immutable project, Thread and capture
state remain authoritative. This is a transverse-compliance screen of one canonical
part, not a joint, a motor installation, a drone or a physical experiment.

## Exact source and requirement chain

- Current checkpoint: project `inspection-drone-id01:project:r650:e14731acd1a1e663`,
  Thread r90
  `project:inspection-drone-id01:r90:decide-accept-evaluation-closeout-run:queue-id01-radial-arm-bench-r2-closeout-r646`.
- Approved brief r4: `inspection-drone-id01:brief:r4:8366ffe2fb53e984`. The human-origin
  local YOLO approval was recorded at `2026-09-08T01:49:53.434Z`. It adds only the
  bounded RadialArm bench assumptions and displacement criterion while retaining the
  prior mission and exclusions.
- Native SysON requirements at Thread r87:
  `requirements-RadialArm-fdf16c35db60d6c7e0f1001259e1393afe4b353dbfc29933696e08a54ad95534`.
  RequirementUsage `07e458ff-8abc-4dec-add5-3d2bce1e6bf7` constrains the current
  RadialArm PartDefinition `444df600-019b-45d5-ac36-617ff0a0f791`. The approved
  declaration `0.2 mm` is canonically represented as exactly `200000 nm` with provenance
  label `fractional-mm-to-nm`.
- [Agent-authored proof source](sources/radial-arm-bench-proof-r2.json): 3,615 bytes,
  raw SHA-256 `19050d70b475f7edddbe778952faaf1ee31cf43521500c49373876a0f28e26e5`.
  Canonical source-capture fingerprint:
  `8df48ccc5ef6a52b04bbf2bb3dbd97a0ef227416dc65662c1fce569aafe916af`. Compiled proof
  digest: `ea9957cd498cbb286b0a8456973e2402f821727ee4f637711244bd38fd10788f`.
- Revision 1 was added only as a waiting work item at project r628, then abandoned at
  r629 after its free-text boundary repeated server-owned identities. It received no
  proposal, approval, queue, run, Thread snapshot or proof artifact. An earlier detached
  r2 draft with a truncated target identifier was likewise never added or executed.
  Neither draft belongs to the authoritative chain below.
- The server recrossed geometry
  `geometry-96fba39719f529232145535fd549ff4b0d37dfca38e62defe7a386b071f43aea` and the
  unique canonical STEP
  `cad-asset-96fba39719f529232145535fd549ff4b0d37dfca38e62defe7a386b071f43aea-target-0-4351574f57e1b8204163be8b672abd7836d1e7f2bbb4376e61d455892f24498b`.
  The executed STEP is 22,726 bytes with SHA-256
  `4351574f57e1b8204163be8b672abd7836d1e7f2bbb4376e61d455892f24498b`, matching the exact
  canonical artifact.
- Proof seal run `run:queue-fea-proof-seal-r2-r632` completed at project r636 / Thread
  r88 and published
  `fea-proof-ddbc41594b60d148c47f946201d2ea16cfb9efef105e2e71798ebebea9da9dae`.

## Isolated calculation and L4 evaluation

Registered operation `verify.run-fea-static-proof@3` ran once under
`run:queue-radial-arm-fea-run-r639` and completed at project r643 / Thread r89. The
recorded microVM evidence reports CalculiX 2.21 and Gmsh 4.12.1, exit status 0, and
proved runner destruction.

- Execution evidence:
  `calculix-isolated-evidence-29859a9714b293c07119e301e60813c2bafed90c9b9274f0394fefa8d263a1aa`.
- Captured result:
  `calculix-isolated-result-json-807483b7da7baece54a213270392f503b126d80a083df5fede1e5dfb0a47713c`.
- SysON evaluation:
  `calculix-isolated-syson-evaluation-f2359b032ebb765c19c608dcc0d3127d49ed0ac24901c4e9b2f467457dd981d1`.

| Observation                       | Recorded value                                            |
| --------------------------------- | --------------------------------------------------------- |
| Maximum displacement              | `0.12925469439628479 mm` at node 498                      |
| Displacement vector               | `[-0.004814435, 0.000003756028, -0.129165] mm`            |
| Same value after SysON conversion | `129254.69439628477 nm`                                   |
| Reviewed upper limit              | `200000 nm` (`0.2 mm`)                                    |
| Margin                            | `70745.30560371523 nm` (`35.37 %`)                        |
| Named criterion                   | `RadialArmBenchDisplacementLimit`: `pass`                 |
| Maximum von Mises stress          | `11.894733563485334 MPa` — observation only, no criterion |
| Mesh                              | 9,243 nodes; 39,794 elements                              |
| Fixed root selection              | 122 nodes in `BenchFixedRootFace`                         |
| Loaded tip selection              | 122 nodes in `BenchLoadedTipFace`                         |
| Total external force              | `[0, 0, -5] N`                                            |

The SysON response contains exactly one `pass` and zero `fail`, `error` or `unresolved`
results. The observed stress is not converted into a strength verdict, factor of safety
or material qualification because the approved proof declares no stress criterion.

## L5 closeout and preserved limits

The closeout reviewer reopened the exact r89 evidence and returned one eligible passing
criterion. The human-origin local YOLO decision accepted that bounded evaluation. Run
`run:queue-id01-radial-arm-bench-r2-closeout-r646` completed at project r650 / Thread
r90 and published
`evaluation-closeout-42065707232e3fe4c881aa31d3500225ded5f248376ae5431436b50016f62ef4`.
The work item carries no gate claims, and the capture retains `l4PassIsNotL5: true`.

The calculation uses the exact current single RadialArm, an ideal fully clamped root
face at x = -50 mm, a total 5 N transverse load on the free face at x = 50 mm, and a
homogeneous linear-isotropic EN AW-6082-T6 catalogue idealization with E = 70,000 MPa
and Poisson ratio 0.33. One target mesh size of 1 mm is not a convergence study.

Joints, bolts, preload, contact, self-weight, motor torque, dynamic thrust, vibration,
fatigue, buckling, impact, nonlinear behaviour, tolerances, factor of safety,
manufacturing, whole-drone behaviour, flight and certification remain excluded. A `pass`
does not establish the RadialArm-to-deck or motor interface and does not make ID01
flight-ready.

## Fresh Workbench adoption

After restarting the stale preview BFF, the read-only Workbench serves project r650 /
Thread r90 with alignment `90/90`. Its engineering-case catalog is `observed`; the
RadialArm case r2, its exact proof authority and its project activity join are present,
and the prior runtime-only `capture-invalid` symptom is absent. The projected native
requirement is `pass` with the fresh `0.1292547 mm` observation. This validates current
projection adoption; it is not an additional engineering proof or a visual UX audit.
