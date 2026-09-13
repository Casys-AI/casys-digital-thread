# TPS01 — runtime evidence

Audience: both · Diátaxis: none · Kind: dated tracking evidence

Local primary-atelier observation, **2026-08-26** (Asia/Taipei). Runtime state is
gitignored and can drift; these identifiers record reread persisted evidence and grant
no authority by themselves.

## Current recorded bases

- Project: `two-piece-tablet-stand-tps01`.
- Architecture: Thread r3.
- Workspace r16: three modules, five files and four active attachments. Final
  `project-source-workspace-event/4.0` fingerprint:
  `sha256:f2274e70724c91445f44055c36bc0d4a2492e26f6e6eb2f91f9a60e3efb288a1`.
- All four active attachment heads have an exact basis.
- Part-definition structure capture: Thread r8,
  `part-definitions-8c61bd0e2b78cce72cdce48f801bb17f95a3f18e4ce9833ec1c800160b3fe808`.
- Current canonical assembly: Thread r13,
  `geometry-dd094bfa79124b220ced4d728c03c21628c9618d1abb321b9d056b77e0b029e9`.

## Workspace r16 closure and recross

The StandBase and StandBackrest source closures each reread two files and one direct
edge. The placement closure reread one file. Exact graph navigation and multi-file
resource reread worked for these recorded heads.

The placement file kept its identity and changed its revision from r1 to r2. Its only
recorded change is the backrest placement, from `[0, 72, 8]` mm to `[0, 44, 8]` mm.
That source change was recrossed at workspace r15; the r13 canonical-module successor
reopened that corrected basis. After L5 produced Thread r16, a final atomic batch
recross advanced the workspace to r16 and aligned the base, backrest and both placement
attachment heads with the current Thread basis. The bounded deterministic
closure/lowering exercised here is not a claim of semantic compilation of arbitrary
inter-file Python imports.

## Child geometry captures

| Part | Capture | STEP SHA-256 | GLB SHA-256 |
| --- | --- | --- | --- |
| StandBase | `geometry-16da3869e4fe44a9ab1ee6b69ec2b3be305693b58d83058eb9caed6b3a513c0c` | `d90b19c6e8151865a69ca1e043d66e4e738e5938cb1ba267c7005ff76d0b2a07` | `a6087eb4a8244b3579e71b0f8683bd968ee0943c3aad66482c4a479e8c948b2a` |
| StandBackrest | `geometry-dc49f975176ef5b5b3aca8da1fed6009f41f646ca9d125527cce55537db983e4` | `8111b428652d40273b565507ecc319f04242481415244580693c774013a3d5f4` | `3c7ce43270a81622a9dcc2863d44051f8ac1e8c24c320a11841c9411df19dae5` |

## Assembly lineage and captures

- Initial module capture, Thread r9:
  `geometry-8ab8f60b55203dcbe424717fe969882c8ee2adc571ea534f119f8951d5803bbf`.
- Initial bundle: `sha256:b67024ca9bd2335962f99ab0a12325b962dfad1fbe4bf184b99644bf43c9d4ef`
  (32,235 bytes).
- Initial assembly STEP: `sha256:41285fc1f86c34dce24b9ca1a047534acc1b8f4ca9f0f7e43a50b393c0bf0a94`
  (32,726 bytes).
- Initial assembly GLB: `sha256:e4ea795b7adafe3f51880311d46c0c34d5a68016582569229106e3fe4869f41b`
  (6,348 bytes).

The initial r9 module was observed at L3 r10 as two valid solids with a 28 mm gap and
zero intersection volume. L4 r11 passed all five static criteria; L5 r12 accepted that
bounded result only.

- Current successor module, Thread r13:
  `geometry-dd094bfa79124b220ced4d728c03c21628c9618d1abb321b9d056b77e0b029e9`.
- Current assembly STEP:
  `sha256:2f7a2f641e8c4b474a9014f8116d04baa6726de82b5596d0164c56b4bbcb051d`.
- Current assembly GLB:
  `sha256:c83e9a12163dc6e5dad00a4f1577d2860b0f7b47932587ff4bdd9a5a8c345ab9`.
- Current L3 capture, Thread r14:
  `assembly-integrity-observation-e809d4bbe810a7d783a358fb7c3bddf2e2cf967a93054259bc22ff94b1ae8ab5`.
- Current L4 capture, Thread r15:
  `assembly-integrity-evaluation-55418ae3f8f458f9aab67cd34fe6fe5fc00a0e2e347445cc291b03406d651183`
  (all five criteria `pass`).
- Current L5 closeout, Thread r16:
  `assembly-integrity-evaluation-closeout-c5df1a23284e6d745c9f44e817fd4158efe06c360f250f622ae7290531def5f9`
  (accepted; gate
  `verification.assembly-integrity` current).
