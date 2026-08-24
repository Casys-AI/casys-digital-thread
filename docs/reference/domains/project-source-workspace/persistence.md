# Project source workspace — persistence

Audience: agent · Diátaxis: reference · Kind: contract

Root: `state/local/project-source-workspaces/<projectId>/`. Gitignored with the rest of
`state/local/`.

Each accepted mutation publishes one immutable event `NNNNNNNNNN.json` after
`NNNNNNNNNN.claim`. There is no full workspace snapshot file per mutation.
Compare-and-swap is `createNew` on the claim. A claimed but unpublished revision fails
closed on the next load.

The event is recovery authority: `project-source-workspace-event/2.0`, previous
workspace revision, `previousEventFingerprint` (null at revision 1, otherwise the exact
prior event fingerprint), mutation id, bounded mutation payload, canonical fingerprint.
The prior fingerprint is included in the event body fingerprint; the log is
hash-chained. There is no `/1.0` reader, writer or migration. Append compares the
durable predecessor fingerprint with `event.previousEventFingerprint` before claiming.

The in-memory index is a replaceable optimisation: every load observes the on-disk
event/claim census, then incrementally applies new events when the cached head is still
a prefix of the log. Full workspace snapshots are not written. An event is validated
against the exact current aggregate before its claim is created, so an invalid sequence,
fingerprint or chain cannot poison the log. A cached head is already known-good and the
chained head commits the prior history; a fresh replay must catch a historical tamper.
Returned state is a defensive copy of the graph maps. Startup and reads fail closed on a
gap, fingerprint mismatch, event-chain mismatch, invalid transition, unfinished claim,
or a cached head that no longer matches durable files.

The global agent-resource listing is never used to reconstruct project membership.
