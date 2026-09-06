# WH01 runtime evidence

Audience: both · Diátaxis: reference · Kind: evidence record

This record captures one completed live walk of `wall-hook-wh01-20260906` using the
[reusable wall-hook procedure](../../docs/how-to/verify-design/verify-a-new-wall-hook-from-source.md).
Concept verification only: not certification, material release, joint qualification,
fatigue, stability, safety, manufacturing, or a whole-product claim. Material, support,
and load remain approved assumptions. These exact-run fingerprints are illustrative
capture evidence, not expected outputs for the checked-in example: its bytes and
resulting fileIds differ from the live source.

| Fact                           | Value                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Public clone tested            | GitHub SHA `c7cdcc893fa86ddf2d53f7d9163d15685ecdddec`                                                                           |
| Live project                   | `wall-hook-wh01-20260906`                                                                                                       |
| Focus payload                  | `{ "workspaceId": "primary", "target": { "kind": "project", "projectId": "wall-hook-wh01-20260906" } }`                         |
| YOLO actor                     | `local-yolo:startup-opt-in`                                                                                                     |
| Anonymous CalculiX source      | `ghcr.io/casys-ai/casys-digital-thread-calculix-worker@sha256:0c96ae7f16c05aaa1b082740e1272ae6b4e35ac58866a4537f9d6e74cb236462` |
| Product MSB target             | `docker.io/casys/calculix-microsandbox-worker@sha256:2dc7d17454833a2c17b5812eb1e5504c4a025ef3764fc771fda2938d49fa9771`          |
| Runtime product image          | `sha256:2dc7d17454833a2c17b5812eb1e5504c4a025ef3764fc771fda2938d49fa9771`                                                       |
| Licence / baseline / promotion | `unknown` / `productionEligible: false` / `eligibleForPromotion: false`                                                         |
| Baseline                       | Thread r1 completed                                                                                                             |

Keep these three cache facts distinct:

1. **Anonymous registry access** was demonstrated. Docker reused already-cached layers.
   That is not a cold download.
2. **Before brief confirmation** the product MSB target was absent.
3. **Brief confirmation** produced a new journalled `cache.calculix` intent generation 1
   and an observed terminal. That is a real server-owned import/preload, distinct from
   the anonymous pull.

## CAD closure and canonical geometry

Live captured resources of this run. A new project recaptures the checked-in two-file
source; do not reconstruct these fingerprints.

| Identity                   | Value                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Parameter file resource    | SHA-256 `8bffddbc35b79a38ff6edfc5805ff4b6a52c41ab4443c4326571320543e28e69`, 87 bytes                                                                         |
| Root file resource         | SHA-256 `f491bff723905723ac91d977b2ca2731342b5036f49d8c12d4e07ae11abc3ea5`, 138 bytes                                                                        |
| Workspace event            | SHA-256 `245ac7eff7ca50d08b5395ca3212d4e923f3a7d70a7028486862348df6ca1a70`                                                                                   |
| Source locator fingerprint | `83f2a4f0ed732265dcc61909e9a24317fe8f90c97be7bb0e59ef864451a87ef4`                                                                                           |
| Closure / `technical-unit` | SHA-256 `916063a639e7fd27e4dd157bb57c69752aa9dd557d2142392918e1cbb54c8a99`                                                                                   |
| Effective script           | SHA-256 `29ab37861b113bf55be43f8dab32a6ddbe97f63038840a705ba483829eb2ee52`                                                                                   |
| Lowering manifest          | SHA-256 `f26a8b72d789a60616ae7b9644f755dde09d67256a3a7dc2b5ab03cae51d67e4`                                                                                   |
| Admission                  | Thread r5 `project:wall-hook-wh01-20260906:r5:compile-seal-admission-run:wh01-20260906-queue-cad-admission`                                                  |
| Canonical export draft     | digest `d7276a4ba3a6003c92c5a3993ce311fcd1c600b00c39c1763e249fa7937e1805`                                                                                    |
| STEP                       | 15,427 bytes, SHA-256 `22ffe33585cd6abde9415265d7229e74dc121514ec4b9bae3ca0964eb231dfef`                                                                     |
| GLTF                       | 3,388 bytes, SHA-256 `2fe5ebaac6f48656b570f4f17fac50c3fc500d318a28947b83910806a7423e75`                                                                      |
| Canonical geometry join    | Thread r6 `project:wall-hook-wh01-20260906:r6:design-write-geometry-016bd284642adc81130213e579a0eab034f2a66f721f3e7799a9835852517105`                        |
| Geometry artifact          | `geometry-016bd284642adc81130213e579a0eab034f2a66f721f3e7799a9835852517105`                                                                                  |
| STEP artifact              | `cad-asset-016bd284642adc81130213e579a0eab034f2a66f721f3e7799a9835852517105-definition-0-0-22ffe33585cd6abde9415265d7229e74dc121514ec4b9bae3ca0964eb231dfef` |

## FEA, L4, and L5 closeout

| Identity                  | Value                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Proof-case resource       | `mechanical-proof-case-source/1.0` SHA-256 `85e2a3f258fd939508332741fac069000afd4b8a5155e2e7e8f1cdf5af5a331a`          |
| Opaque source fingerprint | `f1ba5210eee6949e3b0925a5e822d1f9646a3e86ae29ec055c6268629e093c9e`                                                     |
| Compiled proof digest     | `fceaea293ebc8c5aeae8e1a109ff56afc55e83683e53597b05811f25927e7a82`                                                     |
| Proof seal                | Thread r7 `project:wall-hook-wh01-20260906:r7:verify-seal-proof-case-run:queue-fea-wh01-proof-seal-r1`                 |
| Proof artifact            | `fea-proof-acf0551fe78e396ba2070b4cc44224ec1ac7ead09b4b33c7698b8c7a0f39d206`                                           |
| Isolated run              | `run:queue-fea-wh01-isolated-r7` completed                                                                             |
| Isolated Thread           | r8 `project:wall-hook-wh01-20260906:r8:calculix-isolated-run:queue-fea-wh01-isolated-r7`                               |
| Runtime                   | Microsandbox `0.6.8`, CalculiX `2.21`, Gmsh `4.12.1`, network none, exit code 0, destruction proven                    |
| Mesh                      | 413 nodes, 1,241 elements; FIXED 32 nodes; LOADED 32 nodes                                                             |
| Maximum displacement      | `0.00662401646545873 mm` at node 8                                                                                     |
| Maximum von Mises         | `4.144414913788316 MPa` at element 878 (observed; not a declared proof criterion)                                      |
| Declared criterion        | max displacement `<= 2 mm`, literal L4 `pass`                                                                          |
| Execution evidence        | `calculix-isolated-evidence-78a2fa9388db214a72743ca107b7644ece78d8170704bce568b10a4ea4162ca5`                          |
| L4 evaluation capture     | `calculix-isolated-syson-evaluation-3740df2abc990360e73953b0f9b3c4ced79cc513b90d776d9993d6735b78b3c6`                  |
| YOLO L5 accept            | Thread r9 `project:wall-hook-wh01-20260906:r9:decide-accept-evaluation-closeout-run:queue-wh01-mechanical-closeout-r8` |
| Closeout artifact         | `evaluation-closeout-1d463adadf063e37ce7522aa253bf5901c0489a2a0e5c7bbe4324e544628837c`                                 |
