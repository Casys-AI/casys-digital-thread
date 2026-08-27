# Documentation

Audience: both · Diátaxis: navigation · Kind: index

This is the human entry point to the Casys Digital Thread documentation. It routes by
goal and document type; it is deliberately not an exhaustive file catalogue.

The person states intent and makes consequential decisions in the paired conversation.
The agent prepares and executes registered operations. The server owns provider, tool,
argument, parser, lowering, runtime, and recovery selection. The Workbench is a
read-only `GET` + SSE projection; it is not another command or approval surface.

Status words remain literal: `unavailable`, `unresolved`, `error`, `provisional`,
`documentary`, `unverified`, `demo`, `TRACE GAP`, and `UNLINKED` are not hidden
successes. A bounded `pass` is not automatically a human closeout, whole-product
verdict, release decision, conformity finding, or certification claim.

## Choose your path

- **Understand the product:** read
  [Product direction](explanations/product/product-direction.md), then
  [Proofs and verdicts](explanations/product/proofs-and-verdicts.md).
- **See the engineering sequence:** use
  [Walk through an engineering project](how-to/verify-design/walk-through-an-engineering-project.md).
- **Verify a new design:** follow
  [Verify a new design from scratch](how-to/verify-design/verify-a-new-design-from-scratch.md),
  then
  [Review and correct after a proof](how-to/verify-design/review-and-correct-after-a-proof.md).
- **Author or compile engineering source:** enter [compile how-tos](how-to/compile/).
- **Run admitted Modelica or SPICE:** enter [run how-tos](how-to/run/).
- **Preview the Workbench:** use
  [Preview the native Workbench](how-to/workbench/preview-native-workbench.md).
- **Inspect dated project evidence:** start at the
  [project-dossier index](project-dossiers/README.md). These pages track observations;
  they do not replace persisted project, Thread, CAS, provider, or human-decision state.
- **Find an exact contract, operation, port, or code location:** enter
  [reference](reference/README.md), especially the
  [engineering domains](reference/domains/README.md),
  [local runtime and ports](reference/runtime/local-runtime-and-ports.md), and
  [codebase map](reference/codebase/codebase-map.md).
- **Understand why a boundary exists:** enter [explanations](explanations/README.md).

Do not begin with an internal planning record when a living how-to, reference, or
explanation exists.

## Agent entry

Agents must start with [AGENTS.md](../AGENTS.md), then read the
[agent workspace](reference/agent/agent-workspace.md) and
[lookalike traps](reference/agent/lookalike-traps.md). After that, use the exact how-to
for the task. This navigation page never substitutes for those authority contracts.
Reusable orchestration lives in the
[agent skill catalogue](../.agents/skills/README.md): skills route to these public pages
and never replace their contracts.

## How Diátaxis is used here

There is currently no `tutorials/` directory because no current page is a true Diátaxis
tutorial. Guided walkthroughs and task recipes live under `how-to/`: they help a reader
complete a concrete task against the current product contracts.

- **How-to** pages are action-oriented procedures for a known goal.
- **Reference** pages state exact contracts, inventories, operations, identities,
  limits, ports, and code locations.
- **Explanations** describe why the product, authority, evidence, and UX boundaries
  exist.
- **Project dossiers and legacy pages are outside Diátaxis.** They preserve dated
  observations or retired material; they are not live product authority. Internal
  planning history is intentionally excluded from public source exports.

## Directory map

| Directory                                         | Purpose                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`how-to/`](how-to/README.md)                     | Walkthroughs and task recipes, grouped by human goal                          |
| [`reference/`](reference/README.md)               | Exact contracts, domains, providers, runtime, pipeline, and codebase maps     |
| [`explanations/`](explanations/README.md)         | Product rationale, verification doctrine, and Workbench design                |
| [`project-dossiers/`](project-dossiers/README.md) | Dated, non-authoritative project tracking and evidence pointers               |
| `legacy/` (reserved)                              | Retired, non-executable historical dossiers; never admission or live evidence |
| [`media/`](media/)                                 | Public images and supporting visual artifacts used by documentation           |

Each deeper index routes its own scope, while domain-specific indexes own detailed
inventories. This page stays short as the tree grows.

## Naming rules

- How-to filenames begin with an action and name the outcome, such as `run-`,
  `compile-`, `review-`, `verify-`, or `preview-`.
- Reference filenames name the contract, subsystem, domain, or inventory they define.
- Explanation filenames name the concept or boundary they explain.
- Project-dossier folders use stable product slugs; their status and runtime evidence
  remain separate pages.
- `README.md` is the entry page for a directory, not a second copy of its contents.
- Dates belong in genuinely dated observations or studies. Temporary suffixes such as
  `copy`, `final`, or `(1)` do not belong in canonical paths.

Internal planning records are work briefs or studies, sometimes rejected. Once work is
integrated, the living truth is the relevant how-to, reference, or explanation.
