# Engineering source gates

This checklist defines skill stopping behavior. The linked public how-tos and reference
pages remain authoritative for current fields, profiles, operation identities, and proof
meaning.

## Before capture

Stop when the project, approved brief, current architecture, exact target, source bytes,
or intended execution route is missing or ambiguous. Do not invent source, SysML
targets, provider envelopes, numbers, units, profiles, or runtime setup to fill the gap.

## Before admission

Stop and preserve the literal state when:

- the parser rejects the closed language;
- CAD has no reachable named numeric lever where the current CAD profile requires one;
- compilation reports `gaps`, `binding.missing`, or another non-ready status;
- the attachment is stale, inactive, or ambiguous;
- included source locators do not share one exact workspace snapshot;
- a closure actually reports `source.dependency-lowering-unavailable` (expected for
  Modelica and circuit-only SPICE multi-file closures; not an automatic Build123d V1
  stop gate);
- returned decision parameters are absent, altered, rejected, or not human-approved.

A source correction is a new resource, successor file revision, new capture, and new
preview. Never edit historical bytes or invent `compile.capture-corrected-source@1`.

## Before execution

Stop when:

- a run review finds zero or multiple fresh admissions;
- the returned operation does not exactly match the current registered catalogue;
- the review or executor is `unavailable`;
- the necessary human MRTR is missing, stale, or for another operation;
- a run is quarantined or its effect is uncertain.

Do not redispatch an uncertain write. Route quarantined runs through
`$recover-engineering-run`.

## Evidence meaning

- Isolated CAD is documentary and noncanonical. It cannot feed Product, FEA, or DFM.
- Admitted Modelica and SPICE success is documentary until a separate registered
  evaluation and human closeout are completed.
- `parser.status`, successful execution, a queue receipt, and a provider acknowledgement
  are not admission or a product verdict.
- Preserve `unavailable`, `unresolved`, `error`, `documentary`, `TRACE GAP`, and
  `UNLINKED` literally.
