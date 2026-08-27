# Reference: capability-oriented provider architecture

Audience: both · Diátaxis: reference · Kind: contract

This is the cross-provider boundary for an engineering capability. It keeps the Digital
Thread authoritative without making every provider look alike.

## Responsibility split

| Boundary                           | Owns                                                                                             | Must not own                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Application port                   | One engineering capability and its normalized facts                                              | Provider name, MCP tool name, endpoint, or wire envelope      |
| Provider-named adapter             | One provider's typed lowering, transport, receipt and raw-result parsing                         | Casys project, Thread snapshot, MRTR, requirement or verdict  |
| Digital Thread executor            | Exact inputs, registered method/profile selection, WAL, recovery, capture and Thread publication | A generic provider passthrough or a caller-selected adapter   |
| Digital Thread evaluation/decision | Reviewed criteria, oracle result and human approval                                              | Engine execution or reinterpretation of a raw provider result |

An application port describes the capability being requested, not a common provider API.
Its input and result are semantic and versioned: exact artifact bytes and identity in,
normalized factual observations and provenance out. An adapter is allowed to be named
after its provider — for example, an `mcp-build123d` adapter — because that is where an
engine-specific request and response belong.

## Server-owned lowering

An agent chooses only a registered Digital Thread operation. The server reopens the
sealed inputs, selects the capability profile and provider adapter, and constructs the
provider call. Provider, tool, profile, endpoint, runtime, tolerance and arguments are
not public command parameters.

The adapter may use a provider-specific tool, but its result returns through the port as
facts with enough provenance to reread the claim: exact input identities, method/profile
identity, provider receipt or resource identity, and the captured raw-result identity.
`unavailable`, `unresolved`, and `error` remain literal results; they are not omitted or
turned into an inferred success.

This division also means a standalone engineering MCP remains standalone. It can know
its engine-native inputs, profile and raw outputs. It does not know a Casys project,
Engineering Thread snapshot, MRTR, approval, requirement, evaluation or product verdict.
Digital Thread binds those facts to its own immutable state after the call.

## No universal runner

There is no `runTool` application port and no lowest-common-denominator provider model.
Both would either leak provider arguments into the application or erase capabilities
that a qualified method needs to state explicitly.

Instead, each port names one capability and each registered profile declares its exact
input format, supported observation fields, units/tolerance semantics, limitations and
provenance requirements. A provider that cannot report a field leaves it `unavailable`;
one whose exact input cannot be established leaves the result `unresolved`. Adding a
provider is therefore an adapter plus an explicit profile and runtime proof, not an
expansion of every existing provider contract.

## Digital Thread remains the evidence authority

Digital Thread owns operation registration, method/profile versioning, immutable project
and Thread lineage, WAL/recovery, capture reread, approval and any later
oracle/evaluation. A completed provider call is only a captured engineering fact. It is
not a verdict, a human decision, or authority to rerun, correct or mutate the product.

For the qualified assembly-integrity vertical, the shared reopen is the profile-free
[static assembly basis](../domains/cad/static-assembly-basis.md). The observer port and
its profile begin only after that basis exists. The raw
`build123d_observe_assembly_integrity` capability belongs to `mcp-build123d`; its
provider contract is not a Digital Thread public tool. The registered profile and its
runtime evidence make this vertical available without granting callers provider choice.
Its exact post-publication boundary is defined in the living
[assembly-integrity reference](../domains/cad/assembly-integrity.md). A later
kinematics adapter would be a different capability port, not a second profile on this
observer.
