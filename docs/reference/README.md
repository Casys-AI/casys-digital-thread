# Reference
> Verified-Against: af031bea (2026-09-13).

Audience: both · Diátaxis: reference · Kind: index

Reference pages define exact contracts and inventories. Use them to look up what the
current implementation accepts, owns, persists, or exposes. They are not a recommended
reading sequence.

Each page carries a `Verified-Against` header naming its content baseline: the last
commit that changed the page's substance (the header line itself is metadata, not
content). The pin records the page baseline; it does not prove that the implementation was
re-audited on that date. After committing a content change, update the pin in a
separate metadata commit so it names an existing commit without a self-reference.
`deno task report:doc-freshness` lists pages missing a header, pinning an unknown
commit, or based on a commit older than 8 weeks.

| Area | Owns |
| --- | --- |
| [`agent/`](agent/) | Agent authority, tool surface, placement rules, and lookalike traps |
| [`contracts/`](contracts/) | Cross-domain records, schemas, and workflow contracts |
| [`domains/`](domains/README.md) | Living engineering-domain coverage and boundedness |
| [`pipeline/`](pipeline/) | Capture, analysis, admission, execution, evaluation, and publication patterns |
| [`providers/`](providers/README.md) | Provider boundaries, identities, and reviewed capabilities |
| [`runtime/`](runtime/) | Local topology, ports, control plane, capability packs, and runtime ownership |
| [`codebase/`](codebase/codebase-map.md) | File-level implementation census by capability |

The registered catalogue and backend code remain authoritative when a reference page
drifts. Report the mismatch; do not create a second operation or authority path in
documentation.
