# Documentation

Audience: both · Diátaxis: map · Kind: how-to

Ce dépôt classe la doc avec [Diátaxis](https://diataxis.fr/) (`tutorials/`, `how-to/`,
`reference/`, `explanations/`, `legacy/`), puis par thème. Les titres de pages restent
en anglais. Les RFCs ont leur propre foyer : ce ne sont pas des pages Diátaxis.

## En 30 secondes

L’atelier commande dans le chat. Le cockpit observe. Les labels
(`unavailable`, `unresolved`, `error`, `provisional`, `documentary`, `unverified`,
`demo`, `TRACE GAP`, `UNLINKED`, `pass`) se lisent tels quels — ce ne sont pas des
succès cachés.

## Si tu es un humain

Ne commence pas par un RFC. Lis dans cet ordre :

1. [Product direction](explanations/product/product-direction.md) — ce que le produit
   promet, et les trois branches de jugement (behave / make / buy).
2. [Follow the engineering loop](tutorials/first-engineering-loop.md) — une fois la
   boucle, cockpit en lecture seule.
3. [Run the behave loop from zero](how-to/behave/run-the-behave-loop-from-zero.md) —
   script vivant pour un **nouveau** projet, branche behave seulement.
4. [Proofs and verdicts](explanations/product/proofs-and-verdicts.md) — pourquoi CAD,
   FEA, simulation et évaluation restent des étapes séparées.

## Si tu es un agent

Ne paraphrase pas. Lis dans cet ordre :

1. [AGENTS.md](../AGENTS.md) — autorités, pièges, labels.
2. [Agent workspace](reference/agent/agent-workspace.md) — tools, opérations, grants.
3. [Lookalike traps](reference/agent/lookalike-traps.md) — paires qui ne sont pas des
   substituts.
4. Le how-to de la branche (souvent
   [run the behave loop from zero](how-to/behave/run-the-behave-loop-from-zero.md) ou
   [walk the post-proof loop](how-to/behave/walk-the-post-proof-loop.md)).

## Qu’est-ce qu’un RFC

Un RFC ici est un **brief de chantier** ou une **étude** — parfois rejetée. Ce n’est
pas le how-to ni le contrat produit. Une fois le lot fusionné, la vérité est la page
vivante. Index, statuts et « lire plutôt » :
[docs/rfcs/README.md](rfcs/README.md).

## Catalogue Diátaxis

### Tutorials

- [Follow the engineering loop](tutorials/first-engineering-loop.md)

### How-to — `behave/`

- [Run the behave loop from zero](how-to/behave/run-the-behave-loop-from-zero.md)
- [Walk the post-proof loop](how-to/behave/walk-the-post-proof-loop.md)
- [Sequence a SysON seed work item](how-to/behave/sequence-seed-work-item.md)

### How-to — `compile/`

- [Author architecture SysML](how-to/compile/author-architecture-sysml.md)
- [Compile brief parameters](how-to/compile/compile-brief-parameters.md)
- [Compile FEA parameters](how-to/compile/compile-fea-parameters.md)
- [Compile sensitivity parameters](how-to/compile/compile-sensitivity-parameters.md)

### How-to — `run/`

- [Run admitted Modelica](how-to/run/run-admitted-modelica.md)
- [Recover a quarantined provider run](how-to/run/recover-a-quarantined-provider-run.md)

### How-to — `cockpit/`

- [Preview the native Workbench](how-to/cockpit/preview-native-workbench.md)
- [The Console browser preview is retired](how-to/cockpit/preview-console.md)
- [Do not add an MCP App](how-to/cockpit/add-mcp-app.md)

### How-to — `extend/`

- [Add a recorded analysis engine](how-to/extend/add-a-recorded-analysis-engine.md)

### Reference — `agent/`

- [Agent workspace](reference/agent/agent-workspace.md)
- [Lookalike traps](reference/agent/lookalike-traps.md)

### Reference — `runtime/`

- [Workspace map](reference/runtime/workspace-map.md)
- [Workspace source map](reference/runtime/workspace-source-map.md)
- [MCP console](reference/runtime/console.md)

### Reference — `pipeline/`

- [Source analysis and authority pipeline](reference/pipeline/analysis-authority-pipeline.md)
- [Compilation and isolation](reference/pipeline/compilation-and-isolation.md)
- [Admitted source isolated execution](reference/pipeline/admitted-source-isolated-execution.md)

### Reference — `contracts/`

- [ThreadSnapshot](reference/contracts/thread-snapshot.md)
- [EngineeringProjectSnapshot](reference/contracts/engineering-project.md)
- [Living project brief](reference/contracts/project-brief.md)
- [Mechanical proof case](reference/contracts/mechanical-proof-case.md)
- [Cross-tool component identity](reference/contracts/thread-components.md)
- [Native thread workflow YAML](reference/contracts/thread-workflows.md)
- [Graph data model](reference/contracts/graph-data-model.md)

### Reference — `providers/`

- [Building blocks](reference/providers/building-blocks.md)
- [Providers, analyses, evidence and oracles](reference/providers/provider-analysis-oracle-taxonomy.md)
- [Oracle units](reference/providers/oracle-units.md)

### Explanations — `product/`

- [Product direction](explanations/product/product-direction.md)
- [Proofs and verdicts](explanations/product/proofs-and-verdicts.md)
- [Industry positioning](explanations/product/positioning.md)
- [Closed-language compilation](explanations/product/closed-language-compilation.md)

### Explanations — `cockpit/`

- [Native digital-thread Workbench](explanations/cockpit/native-digital-thread-workbench.md)
- [Lineage-feed Workbench UX](explanations/cockpit/graph-workbench-ux.md)
- [The cockpit component language](explanations/cockpit/mcp-view-component-language.md)

### Explanations — `oracles/`

- [Oracle coverage roadmap](explanations/oracles/oracle-coverage-roadmap.md)
- [Oracle market study (2026-08-05)](explanations/oracles/oracle-market-study-2026-08-05.md)
  — recherche datée, pas un contrat.
- [Compliance evidence cases](explanations/oracles/compliance-evidence-cases.md)

### Legacy

- [CM-01 V3 archived golden dossier](legacy/cm01-v3.md) — audit, pas une opération.

### RFCs

- [RFC home](rfcs/README.md) — briefs de chantier et études ; pas la vérité produit.
