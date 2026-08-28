# Behave Foundation candidate review

This folder records the narrow, fingerprinted review inputs used to render the
`casys.behave-foundation@0.1.0` **local developer candidate**. It does not qualify a
production deployment and it never activates a runtime.

Project-level semantic demand is a separate record. See the
[project capability demand contract](../project-capability-demand.md).

The review is deliberately split by concern:

- [platform coverage](platforms.md);
- [licence boundary](licences.md);
- [volume lifecycle](volumes.md);
- [security boundary](security.md).

The machine-readable review descriptor under
`config/capability-packs/behave-foundation.review.json` pins the exact SHA-256 of each
page. A changed page invalidates the candidate until the descriptor is reviewed again.

Installation guidance lives in
[Install the Behave Foundation candidate](../../../../how-to/setup/install-behave-foundation.md).

## Evidence levels are not substitutes

The inspection and doctor use one ordered vocabulary. Each label means only the
evidence named below; it does not silently inherit the next label.

| Level | What was observed | What it does not prove |
| --- | --- | --- |
| `declared` | Reviewed repository declarations, pins and candidate inputs. A `candidate-ready` census remains at this level. | A local image, running provider, provider contract or engineering result. |
| `cached-exact` | Every mandatory material is present locally with the reviewed OCI/microVM digest and platform. | A provider endpoint, its declared schema, a provider tool invocation or a product result. |
| `contract-attested` | In addition to the exact **set** of local materials, the mandatory MCP endpoints declared the expected `/health.status`, protocol and exact `server/discover.serverInfo.name`/`.version`, then `tools/list` and `resources/list`; the listed input/output schemas are fingerprinted. | A tool execution, provider side effect, canonical geometry or static-FEA proof. |
| `vertical-qualified` | A separately registered, evidence-producing end-to-end gate has qualified the relevant vertical. | Qualification of another vertical or a general production release. |

The current census and doctor never claim `vertical-qualified`. The contract
attestor never sends `tools/call`, selects a provider tool or passes provider
arguments. Its fixed targets are the repository-owned mandatory MCP boundaries
only: `mcp-syson@0.6.0` and the `mcp-build123d-sandbox` endpoint declaring
`mcp-build123d@0.5.0`. The latter service-name/identity distinction is deliberate;
a healthy lookalike endpoint is `declared`, never `contract-attested`. Each OCI
observation also reports the exact Docker `RepoDigest` which matched after standard
repository-alias normalization, rather than an arbitrary digest from the local image.
A schema fingerprint is an `observed-not-verified` identity of that live
declaration, not an assertion that it matches a separately reviewed golden
contract. The `packRole` fields are equally narrow: `fleetRequired` is the
`mcp-fleet` flag (or `null` for a non-fleet material); `memberOfPack` records
the reviewed Behave closure; `requiredForOperation` is a direct candidate
binding claim, not a transitive Compose dependency; `qualifiedForPack` remains
false until a separate gate records qualification.
