# Reference: source map — resource ingress

Audience: agent · Diátaxis: reference · Kind: contract

Census of the generic agent-resource envelope. Not a typed CAS, not admission, and not a
per-domain capture tool.

Index: [workspace source map](../codebase/codebase-map.md). Domain coverage stays
on [engineering domains](../domains/README.md).

## Source map

#### [`src/domain/kernel/resource-bytes.ts`](../../../src/domain/kernel/resource-bytes.ts)

Neutral SHA-256 of exact payload bytes. Resource ingress and compile provider-ledger
reads share this digest. Not admission and not a typed CAS fingerprint

#### [`src/domain/resource/`](../../../src/domain/resource)

Generic agent-resource envelope and capture review. Text XOR canonical-base64 blob,
262144-byte bound. Raw byte fingerprint is kernel SHA-256, not the compile
provider-ledger helper and not a typed-store digest. Not admission, not a typed CAS, not
a per-domain capture tool

#### [`src/application/ports/in/resource/`](../../../src/application/ports/in/resource)

Inward `project_resource_capture` port. Name + MIME + exactly one payload. Later public
captures take the full `resourceRef`. Grants none

#### [`src/application/ports/out/resource/`](../../../src/application/ports/out/resource)

Outward raw-resource store, closed interpretation gateway, MCP exposure. No filesystem
or McpApp types

#### [`src/application/use-cases/resource/`](../../../src/application/use-cases/resource)

Draft capture + closed `schemaVersion` registry. Unknown stays raw; invalid known schema
stays unresolved without a typed fingerprint

#### [`src/adapters/resource/`](../../../src/adapters/resource)

File CAS + MCP `resources/read` publisher + thermal/electrical method-sheet codecs that
reuse existing typed stores. Not a generic typed CAS

#### [`src/tools/project-control/resource-capture-tools.ts`](../../../src/tools/project-control/resource-capture-tools.ts)

MCP `project_resource_capture`. Draft CAS only. No path, project, fingerprint, or MRTR
from the caller
