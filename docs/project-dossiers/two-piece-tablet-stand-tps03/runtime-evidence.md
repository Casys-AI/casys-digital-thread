# TPS03 — runtime evidence

Audience: both · Diátaxis: none · Kind: dated tracking evidence

Local primary-atelier observation through **2026-08-27** (Asia/Taipei). Runtime state is
gitignored and can drift. These identifiers record reread persisted evidence and grant
no authority by themselves.

## Recorded bases

- Project: `two-piece-tablet-stand-tps03`, r135,
  `two-piece-tablet-stand-tps03:project:r135:3d518f2ae4efbe56`.
- Architecture: Thread r3,
  `architecture-292d2852a9f0ba7aed8e1f7f17c07f88aad34c469f76332754fc3661b6c4c1fd`.
- Current Thread: r17,
  `project:two-piece-tablet-stand-tps03:r17:decide-accept-evaluation-closeout-run:tps03-mechanical-closeout-queue-20260827-001`.
- Workspace r18: three modules, five files and four active attachments. Final
  `project-source-workspace-event/4.0` fingerprint:
  `sha256:7eff1cfc15f00c4a51020aa1e12ee2124c7d76ead94fe8d99c0d1e0db98a462e`.
- Final atomic recross mutation: `tps03-final-recross-thread-r17-20260827-001`;
  all four active heads declare the exact r17 Thread and architecture basis.

## Product and requirement identities

- Root `TwoPieceTabletStand` PartDefinition:
  `1f12c73b-8dc8-49b5-859a-94d95a838a0f`.
- `StandBase` PartDefinition: `7d6b0240-8300-4dd3-bd6a-a0803f0f148f`;
  occurrence `22afa6fa-829b-4372-b126-6bbbeefd1a51`.
- `StandBackrest` PartDefinition: `20e71742-390d-4c6d-a91c-120debab5aa8`;
  occurrence `56a97aee-becf-4645-8e76-3bb3406e3cdc`.
- FEA RequirementUsage: `122501cd-54d6-4aa9-b6a6-50b361ee2168`.

## Canonical geometry

| Surface | Capture | STEP SHA-256 | GLB SHA-256 |
| --- | --- | --- | --- |
| StandBase | `geometry-5ce4971815117e04cb973f6eeac821b7ff2a51fcfd4bf9198dc9c6102c70774e` | `d90b19c6e8151865a69ca1e043d66e4e738e5938cb1ba267c7005ff76d0b2a07` | `a6087eb4a8244b3579e71b0f8683bd968ee0943c3aad66482c4a479e8c948b2a` |
| StandBackrest | `geometry-e6abc64f3eedad278c4b818ac3425861d1009d9e322cdf06a7b93b2ddc0b16c6` | `8111b428652d40273b565507ecc319f04242481415244580693c774013a3d5f4` | `3c7ce43270a81622a9dcc2863d44051f8ac1e8c24c320a11841c9411df19dae5` |
| Assembly | `geometry-c219caa0efa3ded75babfa5eb4445ccc08181fd27d011ce73d867169e2845bc2` | `c910c9ec5813f00906cfdc0026161f143ce83557fd297455edf9195717c74c68` | `8cc16a27badc4a3a168a13515b91c7636176c3ac2dddf0ecd550efb10437aa40` |

The six exact asset URLs were reread through the native Workbench BFF on port 5175
and returned HTTP 200. The same projection reported 33 artifacts, two requirements
and the current L5 closeout. Reachability does not add an engineering verdict.

## Assembly-integrity sequence

- L3 r12:
  `assembly-integrity-observation-06c7252971e86e6e73f69429cf5930648cf0bd8a88c37dfd75c4d277a72367c1`.
- L4 r13:
  `assembly-integrity-evaluation-42402a50ab4ed60ad1b5514a63cf83f8cc301da5d82fdbce387731c9d962e8d4`;
  all five criteria are literal `pass`.
- L5 r14:
  `assembly-integrity-evaluation-closeout-b4918b9b845f7dea3b8e4633070b46e0475cd1ba9591f823ccb1cc858651dd60`;
  accepted with `verification.assembly-integrity` current.

## FEA lifecycle

- Proof-case source fingerprint:
  `sha256:9a558151a55fea3d5592c278cccfc9138737888e960ca80a88f498dfc1f03365`.
- Sealed proof capture:
  `fea-proof-eca29de10e802b0714bd0739a56625efe5846655ed2b8945b5d9e21a72d65f15`.
- Historical run: `run:tps03-fea-iso-queue-001`, terminal `failed` with
  `isolated_output_validation_failed` on registered `result.json`, 1,083
  bytes, `sha256:2f9c19aa55562b7483926506f77a46034d2c2297384f45e8bdd24fba531995e1`.
- That run has no `resultSnapshot` and no evidence. It remains immutable.
- Successor work item: `work-fea-isolated-50f81c83c68fcc72-r15-2`, with
  `predecessorRevisionId` naming the failed work item.
- Successful run: `run:tps03-fea-successor-queue-20260827-001`, completed on Thread
  r16 with 11 evidence refs. Result JSON: `sha256:b09ecd1782107093b505287f5800ac5e7f05cdaec5bbe845b4d19568bda64734`;
  execution evidence: `sha256:19d6f6c7bdfddeae4a05e8a66fc4e40a1e7ed39513efbb47eaad157cef88316a`;
  SysON evaluation: `sha256:e213ae1f455b87c6df20a3856f19e62b8013aaf430008103aef971f637927ffd`.
- The recorded isolated-part observations are 0.005445628 mm maximum displacement
  and 0.7601906 MPa maximum von Mises stress. Both named criteria are literal `pass`.
- Human L5 run `run:tps03-mechanical-closeout-queue-20260827-001` published r17 and
  `evaluation-closeout-58dfae2ba93a535460b8c6641b12e20dd4ffd3023858845b26f338504374c697`.
