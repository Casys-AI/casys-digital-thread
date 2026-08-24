# Persistence and recovery

## Authority

The project-scoped event log is the recovery authority. Each event contains the exact
previous workspace revision, mutation identity, bounded mutation payload and canonical
fingerprint. Publication uses compare-and-swap semantics on the next workspace
revision and fails closed on a claimed but incompletely published event.

An event is accepted only after referenced agent-resource bytes have been reopened and
the aggregate transition has been validated. A successful reply is sent only after
the event is durable.

## Derived index

The materialised index is a replaceable read optimisation, not a second source of
truth. It may contain the current module and file lookup maps, but it is not copied as
a new full workspace snapshot for every event. It carries the exact last applied event
revision and fingerprint and can be rebuilt solely from the event log.

Startup and reads fail closed when the log has a gap, fingerprint mismatch, invalid
transition, unfinished claim, or an index claiming a revision not reproduced by the
log. The global agent-resource listing is never used to reconstruct project
membership.

## Bounded historical reads

Exact historical file revisions are read from their creation event plus later
tombstone state. Tree and search pagination run against an exact workspace revision.
Implementation may use derived checkpoints for bounded replay, provided checkpoints
are fingerprinted, rebuildable and never treated as mutation authority.

## Concurrency and acknowledgement loss

The workspace revision serialises accepted mutations, including mutations to disjoint
files. A later atomic batch may reduce round trips but does not introduce per-file
branches. Exact mutation-id replay makes acknowledgement loss idempotent; a reused id
with a different command is corruption or caller error and is rejected.
