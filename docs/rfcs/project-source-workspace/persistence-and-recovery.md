# Persistence and recovery

## Authority

The project-scoped event log is the recovery authority. Each event is
`project-source-workspace-event/2.0` and contains the exact previous workspace revision,
`previousEventFingerprint`, mutation identity, bounded mutation payload and canonical
fingerprint. Revision 1 requires `previousEventFingerprint: null`. Later revisions
require the exact prior event fingerprint. That link is included in the event body
fingerprint, so the log is hash-chained. There is no `/1.0` reader, writer or migration.

Publication uses compare-and-swap semantics on the next workspace revision and fails
closed on a claimed but incompletely published event. Append compares the durable
immediate predecessor fingerprint with `event.previousEventFingerprint` before claiming.

An event is accepted only after referenced agent-resource bytes have been reopened and
the aggregate transition has been validated. A successful reply is sent only after the
event is durable.

## Derived index

The materialised index is a replaceable read optimisation, not a second source of truth.
It may contain the current module and file lookup maps, but it is not copied as a new
full workspace snapshot for every event. It carries the exact last applied event
revision and fingerprint and can be rebuilt solely from the event log.

Startup and reads fail closed when the log has a gap, fingerprint mismatch, event-chain
mismatch, invalid transition, unfinished claim, or an index claiming a revision not
reproduced by the log. A cached head is already known-good: the chained head commits the
prior history. A fresh replay must catch a historical tamper. The global agent-resource
listing is never used to reconstruct project membership.

## Bounded historical reads

Exact historical file revisions are read from their creation event plus later tombstone
state. Tree and search pagination run against an exact workspace revision.
Implementation may use derived checkpoints for bounded replay, provided checkpoints are
fingerprinted, rebuildable and never treated as mutation authority.

## Concurrency and acknowledgement loss

The workspace revision serialises accepted mutations, including mutations to disjoint
files. A later atomic batch may reduce round trips but does not introduce per-file
branches. Exact mutation-id replay makes acknowledgement loss idempotent; a reused id
with a different command is corruption or caller error and is rejected.
