# ID01 - canonical geometry and static-integrity observation

Observation 2026-09-06 18:29 UTC / 2026-09-07 Asia/Taipei. Documentary ledger, not an
authority substitute. Reopen current project/Thread state before any next operation.

- Project: `inspection-drone-id01:project:r348:142a59143b64565d`.
- Thread: `project:inspection-drone-id01:r49:verify-evaluate-assembly-integrity-run:id01-queue-propulsion-integrity-l4-20260907`.
- Original camera bracket: canonical since Thread r6; its STEP remains
  `b821e5598b75449636eb57d0ea7db48ea560260ce56a6872ebeaec0f7691d201`.
- Eleven additional original roots received separate current-basis admission seals at
  Thread r10 through r20, followed by canonical target geometry seals at r21 through r31.
- Six immediate static module seals followed at r32 through r37. L3 observations and L4
  evaluations were then executed independently at r38 through r49.
- No L5 closeout was executed. The current L5 proposal automatically attaches the shared
  assembly gate to a subsystem-only evaluation (F07); this was not approved.
- No whole-root module, physical joint, mechanical FEA result, flight or certification
  is established by this ledger.

## Eleven new canonical part targets

Each STEP below is the exact export file sealed by `design.write-geometry@1`, not an
isolated documentary execution. Envelopes and reserved volumes retain their published
provenance limitations.

| Source | Canonical capture | STEP SHA-256 | STEP bytes |
| --- | --- | --- | --- |
| [central-deck.py](sources/central-deck.py) | `geometry-4faa5c5b7acea9c2a2fb321d1b29c88a6bcf08280fbc9afa3f75254b7b3642ec` | `d3d8305b5929c11da13d6cb8d01ab1b42cd998a47612e65348b429d569ad88d9` | 44605 |
| [radial-arm.py](sources/radial-arm.py) | `geometry-96fba39719f529232145535fd549ff4b0d37dfca38e62defe7a386b071f43aea` | `4351574f57e1b8204163be8b672abd7836d1e7f2bbb4376e61d455892f24498b` | 22726 |
| [battery-tray.py](sources/battery-tray.py) | `geometry-c9c34283fc5a3afd83c3606f431352e11f9394fd207eaf114a982900cc6f33fa` | `bc69476d7a459c975bb95ce1550903ff837a52f0f9c81361dc87c8be51c7d494` | 29703 |
| [battery-reserved-volume.py](sources/battery-reserved-volume.py) | `geometry-67b5990d9827f3d3c34b60e2462b8bd67eb722c58927cb88384d25a8abf408c9` | `ab023669d0b044bbc7b29675cc244c8d35e09bc26c6030aa3f5c3025b8501662` | 17045 |
| [avionics-carrier.py](sources/avionics-carrier.py) | `geometry-a5beef7c9bec47ad36569a651d21436275fe4ef499136d24a2b276e793dcf950` | `e26bafa27d2379a3141f5c06f754ad0b1b7f9513ab61cf082abbbbbf269abef5` | 17014 |
| [landing-skid.py](sources/landing-skid.py) | `geometry-0f248d7f9d02bca4a44453f78609fafb0e87c941f5fb27eb1cca59c43280c027` | `4d9968a0b397eb1f76fd64377c833862d012b475c2b2345ffd6307cd189bb5ae` | 42638 |
| [autopilot-envelope.py](sources/autopilot-envelope.py) | `geometry-77532a965259a78723d0d1f208bdccf5b606240bbdbef9f6cd0e0ee205018fba` | `69705f29327b03ab738d291664f354f405844d5ce303b58056623db7bc4ced2d` | 17131 |
| [companion-computer-envelope.py](sources/companion-computer-envelope.py) | `geometry-071e1d6db9de1adf95c6fe0a2754fa13f257ca91ac128a4d7497550ab1644e07` | `a604e5e8990a1e356705843d0c51832e364535d30061f49bf4ea589ef16d6e91` | 17017 |
| [motor-envelope.py](sources/motor-envelope.py) | `geometry-b30a9ea5f461ade799dbc39a673efe5851b04b4e015e48df7ff6a812b8a0b724` | `b89468cba3ee04b1454914be424bd779f3241ea7b4883a7bae6fae8c2f29dbd5` | 7181 |
| [camera-board-envelope.py](sources/camera-board-envelope.py) | `geometry-92a99f4872726b3d93c60d14568cf5f93f6de4dd139fc349c02430abe2b0d3c1` | `283f0e918ca66cd7b35c1ec4aa464f549d0974629290f2112d06e828704c26a0` | 17075 |
| [static-propeller-envelope.py](sources/static-propeller-envelope.py) | `geometry-136b720a5b1c02d3f9c176bdea39bd3e6535aa1bb58ca3033d6f527b322318ca` | `136ccd019e8016de450f214f2ed2531253ae2d4aaf5659eccf41f69a4a146d47` | 30926 |

## Six module observations and evaluations

All five fixed criteria are literal `pass` on each exact module: import, occurrence
coverage, placement recross, BRep validity, and zero positive pairwise intersection.
These are separate evaluations, not a composed proof of the whole drone. L3 actually
called the registered observer; L4 is provider-free. Minimum distance/contact are only
diagnostics, not validated physical joints or required clearances.

### Airframe

- Canonical module: `geometry-a0844bbbb7a5a1c56adc72de11a5940a29fdfc9fb82238c8b027487a8e1168c4`.
- Assembly STEP: `53f1a867dca655928bbeb089a6ea55bb7ad8b2c670c2303f2b77f33dce2d97dd`.
- L3: `assembly-integrity-observation-9c6ef7026d6bdbd783f3ee1859dcc2f58e8c6c39db65bec4f50cc6a61c406b8e`.
- L4: `assembly-integrity-evaluation-20f60f72ccec0d0f3e65e28120ac66582d37bbef288199d4750de4e35f6994eb`.
- Immediate occurrences: 5. Five criteria: `pass`.
- L5: **not executed**. Physical joints, loads, motion, safety and fabrication:
  `not-evaluated`.

### ElectricalPower

- Canonical module: `geometry-b243d28e1aaa2a1212e0ca325be8ac27ee22e7d818e6f4862a8f73a373cae31e`.
- Assembly STEP: `08baad8ef6065077a57c63b363f5dc342ebbb436c547b9dd9c2b4b1e833a1780`.
- L3: `assembly-integrity-observation-de6c2be37dc1bc4936152ecc4d5f3f08cf49a328d21542ddf4d899c2d9908692`.
- L4: `assembly-integrity-evaluation-4b4ffa1c73df06c15bc5e47755ad29cde2b0208e6be5457fc69c55253b272a0f`.
- Immediate occurrences: 2. Five criteria: `pass`.
- L5: **not executed**. Physical joints, loads, motion, safety and fabrication:
  `not-evaluated`.

### FlightAvionics

- Canonical module: `geometry-50ec792fc788372610ec9ddb044ac7759db1f5f0e7dc7e4ee06910f340d44784`.
- Assembly STEP: `617955cc3424ea439c5ab7de85fd30d26483137f1f70f74bb28b5df2dc3282d5`.
- L3: `assembly-integrity-observation-8ab7da637c5907066176c7a975209e6daadbcdd1468a313b5571afd5c1a0e911`.
- L4: `assembly-integrity-evaluation-2c6fe42ce123b97a9e2f98e2286f856e7f31f0903f42744eab3899944760934c`.
- Immediate occurrences: 3. Five criteria: `pass`.
- L5: **not executed**. Physical joints, loads, motion, safety and fabrication:
  `not-evaluated`.

### LandingGear

- Canonical module: `geometry-4e0851846549df1034b758e0383cdbd30f49822c87a876bdb1e14792259ef305`.
- Assembly STEP: `7be07ff3ac1d997f87c4a1adee8b769ce7fd329c89dbcf398beb89fd9d47b51c`.
- L3: `assembly-integrity-observation-8c0d2ff079b7331438db90d4c193f9e7ad27d9655beb53810c8f5e3bb5b518a0`.
- L4: `assembly-integrity-evaluation-39ed096e98e731952a1ef840b2ac3ef2324de1115b8c5befa8617bdd7dfe2046`.
- Immediate occurrences: 2. Five criteria: `pass`.
- L5: **not executed**. Physical joints, loads, motion, safety and fabrication:
  `not-evaluated`.

### CameraPayload

- Canonical module: `geometry-e9c3b6ad9bed3dc20d5be3387a7af1e23a74aa26ea3bcf8a88840381a5468168`.
- Assembly STEP: `d0f7257491abe7f4492f14ecce85eafae18ba2b87aad65abbe803c5cd9822474`.
- L3: `assembly-integrity-observation-4cb90a7672fd60a5f6e9d8e186020e66a985e8946b79ab0ecf6071c0a1c4b231`.
- L4: `assembly-integrity-evaluation-cebcca564a6feecbe7612a4f08f1e8e7b189a8ffe08f332544f6682db4eb4282`.
- Immediate occurrences: 2. Five criteria: `pass`.
- L5: **not executed**. Physical joints, loads, motion, safety and fabrication:
  `not-evaluated`.

### PropulsionSystem

- Canonical module: `geometry-b9a0258db0a85e61299a557660dd6068fcb7903f448509bb554747da2a448311`.
- Assembly STEP: `a8f206fadf52531f6f50511c1665043041d461868f6cb233a502c950d7ec63ba`.
- L3: `assembly-integrity-observation-8400c700e5c18c63be670304f9052cb199de32b2502707c1bf4c9357d3ce0eee`.
- L4: `assembly-integrity-evaluation-8b3cb8ec46ed17dae8024232044629ed1fb788f67d78f04949b7ee6f24adc166`.
- Immediate occurrences: 8. Five criteria: `pass`.
- L5: **not executed**. Physical joints, loads, motion, safety and fabrication:
  `not-evaluated`.

## Outstanding integration decisions

The proposed root remains outside currently qualified nested-module coverage. Source
algebra also found that the initial CameraPayload root transform places its base holes
outside and well below the deck; an upright-top face contact does not create a mounting
path. That root proposal is rejected as a physical attachment assumption, while its
unexecuted history and the valid immediate CameraPayload geometry remain preserved.
Actual motor/arm, carrier/arm, tray/deck, landing/deck and camera interfaces need explicit
geometry and separate physical evidence. Arm/deck nominal hole alignment alone does not
prove bolt preload, strength or anti-rotation. No make/buy branch was opened.
