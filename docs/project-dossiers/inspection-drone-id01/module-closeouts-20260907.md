# ID01 - bounded module closeouts, 2026-09-07

Observed 2026-09-06 UTC / 2026-09-07 Asia/Taipei. Documentary ledger only; the
referenced Thread captures and signed project records remain authoritative.

At project r462 (`inspection-drone-id01:project:r462:5047cdfb75d7ec3a`), the current
Thread is r65,
`project:inspection-drone-id01:r65:decide-accept-assembly-integrity-evaluation-run:id01-queue-propulsion-integrity-l5-20260907`.

## Exact completed chain

The six original factual L3 observations were not rerun. Following the FEA branch, each
was reopened and recrossed by a new registered, provider-free L4 at the current Thread
basis. Each L5 immediately consumed that exact current L4 result. Every closeout is
`accept`, every one of its five fixed criteria is `pass`, and every signed `gateClaims`
array is empty. No shared or whole-drone assembly gate was satisfied. Approval/execution
origin is the operator's explicitly enabled `local-yolo:startup-opt-in`, not an invented
interactive signature.

| Module           | Original L3 / L4 Thread | New L4 / L5 Thread | L5 capture SHA-256                                                 |
| ---------------- | ----------------------- | ------------------ | ------------------------------------------------------------------ |
| Airframe         | r38 / r39               | r54 / r55          | `cb18d98510310ad668721ec66ca2d2920a6174e35606afe6adf5c09207a03a54` |
| ElectricalPower  | r40 / r41               | r56 / r57          | `57ecf4c63dfa209ae82d1f5769b44d2152015af3034fc701517897b96b182022` |
| FlightAvionics   | r42 / r43               | r58 / r59          | `1b50813255bf58d6b82e3e8d803513f4d49d9757f15b9c08fb28ed1421c6b8e6` |
| LandingGear      | r44 / r45               | r60 / r61          | `c18dd5747f84455a50567a0b23269eb87e98c5e5a1190abf554ae765112e198d` |
| CameraPayload    | r46 / r47               | r62 / r63          | `4a5fa3a2f732ded39760b0ebc1b04e0a844868610fa776dfe384881ed77066b2` |
| PropulsionSystem | r48 / r49               | r64 / r65          | `2a6a56210c33a61a70c8a25b0cf449d8f89cdd4c91b9c3b51e61e842cac77465` |

The fixed criteria are `assembly-import`, `occurrence-coverage`, `placement-recross`,
`brep-validity` and `pairwise-intersection`. They remain geometric evidence only: no
joints, clearance requirement, load transfer, mechanism, flight, manufacturing or
certification claim. The [original geometry ledger](geometry-and-integrity-20260907.md)
retains all twelve part and six immediate-module identities. No nested root module has
been exported or sealed.

## F07 correction and adoption

Astra rejected Grok's first implementation because a completed historical L5 with
Brief-derived claims would fail replay under the new policy. The accepted follow-up
retains the signed admission, exact capture, MRTR/work and successor checks for
`completed`/`publishing`; a new queued/running accept must derive its claims only from
the selected L4's explicit current `contributes-to` set. Empty stays empty. No schema or
registered-operation identity was changed.

Astra integrated the bounded source diff after independent Terra review. Validation on
the main checkout passed: 90 assembly-integrity adapter/domain tests, `deno task check`,
`deno fmt --check` on ten changed TypeScript files and two contract/how-to documents,
`deno lint` on the ten TypeScript files, and `git diff --check`. These are source
checks, not proof of a complete aircraft.

The owned local control-plane process was stopped cleanly (PID 95403), then restarted as
PID 32960 with the existing local YOLO opt-in and frozen dependencies. The six real
zero-gate closeouts above demonstrate local runtime adoption. No provider image, CAD
source or canonical geometry was changed by F07. No commit or push was made.

The [remaining integration boundaries](remaining-integration-boundaries.md) still
prevent a whole-project completion claim. Root-module capability promotion and physical
mounting interfaces are separate unfinished work.
