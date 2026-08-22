# SysON authority and runtime boundary

Audience: both · Diátaxis: reference · Kind: runtime contract

The configured SysON provider advertises 31 tools and six provider views. Digital Thread
does not hand that inventory to an agent. Registered operations currently compose only
nine fixed provider tool names, with code-owned arguments and response validators.

Authorities:

- [`operation registry`](../../../../src/orchestration/operations/registry.ts)
- [`server composition root`](../../../../server.ts)
- [`SysON fleet entry`](../../../../config/mcp-fleet.json)

## Registered operation to provider call

| Registered operation                                | Fixed SysON calls                                                                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `architecture.seed-syson-model@2`                   | `syson_project_create`, `syson_model_create`, `syson_element_get`                                                                                           |
| `model.write-architecture@1`                        | `syson_element_children`, `syson_query_aql`, `syson_element_insert_sysml`                                                                                   |
| `model.capture-part-definitions@1`                  | `syson_element_get`, `syson_element_children`, `syson_query_aql`                                                                                            |
| `model.write-requirements@1`                        | `syson_element_get`, `syson_element_children`, `syson_query_aql`, `syson_element_insert_sysml`, `syson_constraint_extract`, optional `syson_element_delete` |
| `model.write-sensitivity-edges@1`                   | `syson_element_insert_sysml`, `syson_constraint_extract`                                                                                                    |
| `verify.evaluate-sensitivity-base@1`                | `syson_constraint_evaluate`                                                                                                                                 |
| `verify.run-fea-static-proof@3`                     | `syson_constraint_evaluate` after local proof publication                                                                                                   |

The union is:

```text
syson_project_create
syson_model_create
syson_element_get
syson_element_children
syson_element_insert_sysml
syson_element_delete
syson_query_aql
syson_constraint_extract
syson_constraint_evaluate
```

`architecture.author-inspection-drone@3` and
`model.capture-inspection-drone-part-definitions@1` are retired and unregistered;
`syson_part_structure` is no longer composed. Generic SysML uses
`model.write-architecture@1` or `model.seal-architecture-sysml@1`. Historical probes
may also use `syson_search`, `syson_project_list`, `syson_project_delete` or
`syson_constraint_solve`; those scripts are not registered project operations.

The shared backend MCP client is transport-generic and does not enforce a SysON
allowlist itself. The safety boundary therefore lives in the registered dispatcher and
the operation-specific call sites. Adding a new call site is an authority change even
when its tool already appears in the fleet manifest.

## No caller-selected provider envelope

Queue and execute tools accept project/work-item/run identities, not provider names,
tool names, endpoints, SysML, AQL or arguments. The dispatcher resolves the exact
operation and one pre-composed executor. If SysON is not configured, SysON-backed
operations are unavailable rather than silently redirected.

The provider implementation and credentials stay outside this repository. Its MCP port
is a backend dependency. The browser receives neither the endpoint nor provider
credentials.

## Recovery boundary

SysON mutations are not assumed idempotent.

- Seed, architecture and requirements writers persist operation-specific WAL state
  before non-idempotent dispatch.
- An acknowledged or ambiguous write is not blindly repeated. The executor reopens
  durable state, performs bounded readback, or quarantines the run for reconciliation.
- Requirements enrichment may delete and reinsert one RequirementUsage; an uncertain
  intermediate state is explicitly a partial-write risk.
- The read-only PartDefinition capture persists a publication record so replay can
  publish the captured result without querying SysON again.
- FEA and sensitivity evaluators journal the exact oracle request/response separately
  from solver evidence.

Completed replay reopens the exact CAS capture and Thread successor. It does not call
SysON again merely because an execute request was repeated.

## Read and presentation boundary

The Workbench does not browse the current SysON model. It projects persisted engineering
project revisions, Thread snapshots and content-addressed captures. Product structure
becomes `unavailable` when exact captured evidence cannot be reopened; the UI does not
repair that gap with a label search or a live provider query.

The six configured `ui://mcp-syson/*` views and the provider's diagram/search tools are
not embedded as Workbench authority. The historical `syson_search` inventory probe
writes a local diagnostic capture; it is neither a live product explorer nor a Thread
revision.
