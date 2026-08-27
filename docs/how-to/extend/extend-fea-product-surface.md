# How-to: extend the FEA product surface

Audience: implementer · Diátaxis: how-to · Kind: runbook

Use this runbook only when the requested physics does not fit the existing FEA surface.
It is not a way to bypass the current proof schema with extra JSON fields or a
hand-written solver deck. For a project that already fits V1, capture a
`mechanical-proof-case-source/1.0` document; see
[coverage](../../reference/domains/fea/coverage.md). Do not add a Git catalog row.

## 1. Close the domain and schema

Define the new method's bounded inputs, units, selections, assumptions, admissible
criteria, and explicit exclusions in the domain schema. Reject every unmodelled native
solver feature. Keep the case declaration about engineering intent and evidence
identities, not provider commands or paths.

## 2. Bind it to a separate MRTR

Extend or introduce the closed proposal grammar so a human can sign the exact new
consequential inputs. Keep the proof seal and any execution MRTR separate. The review
must reopen the captured source and Thread artifacts server-side; it must not accept
raw solver payloads from the caller.

## 3. Implement deterministic Gmsh/CalculiX lowering

Lower the closed declaration into the exact mesh and solver request in server-owned
code. Fix profile, image, wrapper, effective settings, and recovery policy. Reconstruct
and compare generated artifacts before they become evidence; never make a case filename
or project id choose a lowering branch.

## 4. Define the worker and output contract

Give the isolated worker a bounded input bundle and a complete, validated output
manifest. Capture the exact consumed STEP, generated mesh/deck, logs, raw results, and
normalized metrics with byte counts and fingerprints. Preserve fail-closed isolation and
replay semantics.

## 5. Project observations through the oracle

Map only declared metrics to exact requirement identities. Let the constraint oracle own
the requirement comparison and its unit semantics. Keep solver facts, observations, and
`pass`/`fail`/`unresolved`/`error` evaluations distinct.

## 6. Prove the end-to-end authority path

Demonstrate reopening and digest checks from schema through MRTR, lowering, worker,
outputs, observations, oracle capture, WAL/recovery, and Thread publication. A completed
replay must reuse durable evidence rather than dispatch Gmsh, CalculiX, or SysON again.

## 7. Then admit a captured source

Only after those shared capabilities are qualified may a project case use the new
surface. Capture one `mechanical-proof-case-source/1.0` JSON document. That supplies
data for an already-qualified method; it never creates the method itself. Historical
Git catalog rows are not live authority.
