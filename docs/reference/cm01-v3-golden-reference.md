# CM-01 V3 golden reference

[`coffee-machine-cm01-v3.json`](../../config/golden-references/coffee-machine-cm01-v3.json)
is a reviewed, static semantic comparison contract. A V3 candidate brings its own
project, snapshots, artifacts and provider identities; the comparison JSON is
deliberately not a project template, generic executable workflow, or provider
integration.

The reference expects only reviewable evidence identities and measurements:

- SysON architecture inventory;
- the compiled plan, script and build123d STEP export;
- selected Modelica scenario measurements;
- the observed ERPNext BOM quantity; and
- the isolated drip-tray mechanical STEP handoff, measurements and pass evaluations.

The candidate is `coffee-machine-cm01-v3` with its own `project:` subject. The domain
comparator takes a normalized projection keyed by reviewed semantic roles such as
`architecture-model`, `cad-step` and `mechanical-step`, not by historical IDs. The
comparator itself has no provider credentials, raw tool arguments, or UI authority. The
server now owns separate registered V3 executors; see the
[local golden-run guide](../how-to/run-cm01-v3-golden-local.md) for their bounded path
and evidence locations.

Every numeric comparison declares an absolute tolerance. Artifact role, producer, unit,
the reviewed mechanical-proof fingerprint, and the CalculiX handoff remain exact. The
STEP hash is intentionally exact **within one run**: CalculiX must attest the same
SHA-256 that build123d emitted. It is not compared to a historical digest because
OpenCascade serializes the export timestamp into the STEP bytes. ERP stock rows are not
a golden invariant because they are time-dependent observations. The mechanical section
retains its original concept-only boundary: it is not certification or
fabrication-release evidence.
