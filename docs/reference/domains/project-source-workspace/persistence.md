# Project source workspace — persistence

Audience: agent · Diátaxis: reference · Kind: contract

Root: `state/local/project-source-workspaces/<projectId>/`. Gitignored with the rest of
`state/local/`.

Each accepted mutation publishes one immutable event `NNNNNNNNNN.json` after
`NNNNNNNNNN.claim`. There is no full workspace snapshot file per mutation.
Compare-and-swap is `createNew` on the claim. A claimed but unpublished revision fails
closed on the next load.

The event is recovery authority: new writes are `project-source-workspace-event/4.0`,
with previous workspace revision, `previousEventFingerprint` (null at revision 1,
otherwise the exact prior event fingerprint), mutation id, bounded mutation payload, and
canonical fingerprint. The prior fingerprint is included in the event body fingerprint;
the log is hash-chained. `/3.0` remains a temporary replay-only reader for its
pre-recross mutation vocabulary: append never writes V3 and V3 explicitly refuses
`attachment_recross`. `/2.0` and `/1.0` are refused. Historical bytes are not
automatically migrated. Append compares the durable predecessor fingerprint with
`event.previousEventFingerprint` before claiming. The materialised index includes the
attachments map and can be rebuilt solely from the event log.

The in-memory index is a replaceable optimisation: every load observes the on-disk
event/claim census, then incrementally applies new events when the cached head is still
a prefix of the log. Full workspace snapshots are not written. An event is validated
against the exact current aggregate before its claim is created, so an invalid sequence,
fingerprint or chain cannot poison the log. A cached head is already known-good and the
chained head commits the prior history; a fresh replay must catch a historical tamper.
Returned state is a defensive copy of the graph maps. Startup and reads fail closed on a
gap, fingerprint mismatch, event-chain mismatch, invalid transition, unfinished claim,
or a cached head that no longer matches durable files.

An `attachment_recross` event stores the canonical public intent
(`expectedWorkspaceRevision` plus sorted selected attachment heads) alongside the
server-derived exact `declaredAgainst` tuple and copied successor edge fields. The
enclosing event retains `projectId` and `mutationId`. Replay applies only those
persisted fields inside the aggregate; it never asks Thread, SysON, Graphology or a role
catalogue to rederive a newer basis. One valid batch is one claimed event file, so a
failed item cannot leave a durable partial recross.

The global agent-resource listing is never used to reconstruct project membership.
