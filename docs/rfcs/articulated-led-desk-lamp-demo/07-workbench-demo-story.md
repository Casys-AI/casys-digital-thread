Audience: agent · Diátaxis: none · Kind: RFC Status: active Living pages:
[Product direction](../../explanations/product/product-direction.md),
[Agent workspace](../../reference/agent/agent-workspace.md)

# RFC: 07 — read-only Workbench story for the lamp demo

The Workbench makes the engineering loop understandable; it does not become a second
authority. Every screen remains a projection of project/Thread state fetched through GET
and SSE. It receives no command endpoint, MCP credential, provider tool, review
approval, solver parameter, or retry control.

Implement this spec only after the backend publishes stable evidence shapes for the
mechanical, thermal and electrical branches. Until then, use typed projector fixtures,
not hard-coded demo JSON in components.

## The story the viewer must understand

Within one minute, a viewer should be able to answer:

1. What lamp is being designed and what did the human approve?
2. Which three Behave questions are independent?
3. Which evidence currently supports each question?
4. What failed, what correction was approved, and what changed afterward?
5. Why did a power change invalidate thermal/electrical evidence but preserve unrelated
   mechanical evidence?
6. Which states remain documentary, unresolved, provisional or unavailable?

The screen must not lead with provider names, hashes or graph topology. Those remain
inspectable details.

## Presentation scenes

| Scene        | Primary statement                                                         | Required projected facts                                                             |
| ------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Intent       | “An articulated LED desk lamp is under reviewed design.”                  | approved brief revision, human decisions, current project stage                      |
| Architecture | “These components and parameter handles exist.”                           | system/components/usages/attributes and exact source identities                      |
| Mechanical   | “The arm failed/passed these named limits on this STEP.”                  | canonical geometry, stress/displacement observations, evaluations, margins           |
| Correction   | “This reviewed lever changed; this successor proof replaced the old one.” | proposal, approval, old/new fingerprints, supersession and impact                    |
| Thermal      | “This admitted model predicts this temperature behaviour.”                | Modelica source/admission/run, final/max observation, documentary or evaluated state |
| Electrical   | “This sealed circuit produced these bounded observations.”                | circuit case, ngspice evidence, V/A/W/s metrics and evaluations                      |
| Impact       | “Only these branches became stale after the power decision.”              | exact dependency claims, invalidated/current evidence and retained mechanical branch |

## Execution queue

### U01 — freeze the read-model contract

Inventory the exact project and Thread artifacts produced by accepted backend specs.
Extend read models under `src/presentation/workbench/` only with facts that actually
exist. Do not expose the entire `EngineeringProjectSnapshot` as a shortcut.

**Accept:** every displayed field has one typed projector origin and one literal empty
state. **Stop:** backend evidence shape still unstable.

### U02 — add branch-neutral decision maturity

Project L1–L5 as presentation vocabulary derived from exact states; never store a second
level in UI state. `pass` maps to L4, not L5. A human decision maps to L5 only when
bound to that exact evaluation/revision.

Use one small pure model with table-driven tests. Do not infer maturity from card order,
provider success, artifact count or operation name fragments.

### U03 — build the three-question summary

Render three sibling Behave questions: mechanical integrity, thermal behaviour and
electrical behaviour. Each tile shows current literal state, latest relevant evidence,
criterion/evaluation, and whether a human consequence exists.

No verdict may cross tiles. A mechanical pass cannot color thermal or electrical green.

### U04 — show one causal correction

Project the arm correction as a before/after sequence: failing evaluation, reviewed
lever proposal, human approval, new CAD/STEP, successor run and new evaluation. Preserve
the old result as historical evidence; do not overwrite or visually erase it.

### U05 — show selective invalidation

When the approved power parameter changes, show thermal/electrical evidence as stale or
impact-unresolved according to persisted claims. Leave mechanical evidence current only
when the backend explicitly proves independence. Never compute dependency logic in the
component.

### U06 — add progressive evidence inspection

From each observation/evaluation, allow inspection of method/profile, units, artifact
identity, producer, revision, hashes, WAL/replay state and limitations. Keep this behind
one disclosure layer so the primary story remains beginner-readable.

### U07 — preserve read-only transport

Use the existing Workbench client/BFF GET + SSE boundary. Add no POST route, review
intent mutation, command callback or MCP call. Add a focused architectural test proving
the new code imports presentation/read models only through allowed paths.

### U08 — implement responsive Preact/Ark UI components

Use the current Preact, Ark UI and Tailwind direction. Reuse primitives and tokens; do
not start Fresh migration, a desktop shell, design-system rewrite or broad navigation
redesign. Components consume typed scene models and contain no Thread traversal logic.

### U09 — build deterministic fixtures and visual states

Create generic fixture builders for:

- before any proof;
- mechanical fail awaiting decision;
- corrected mechanical pass;
- thermal documentary result;
- electrical unavailable/error/evaluated;
- power-change selective invalidation; and
- fully reviewed demo closeout.

Fixtures must not use magic labels to drive behaviour. Screenshots are local review
artifacts unless explicitly requested for durable documentation.

### U10 — run the real projected demo

Point the read-only Workbench at the fresh persisted lamp project. Confirm SSE updates,
scene ordering, literal states, before/after lineage and evidence inspection. Do not
mutate the project to obtain a prettier screenshot.

## Definition of done

The Workbench is done when a new viewer can follow intent → evidence → fail → reviewed
correction → recomputation → selective impact without knowing SysON, build123d,
CalculiX, Modelica, ngspice or MCP. An expert can still inspect those exact details.
Every command and decision remains in the paired agent conversation.

## Validation and commit boundaries

- Pure projector/model tests after U01–U06.
- Focused UI tests after U08/U09; `deno task check:ui` once after integration.
- One manual browser pass against fixtures and one against real persisted state.
- Commit read-model/projector changes separately from visual components. Do not absorb
  unrelated dirty UI work, lockfile churn or generated `dist`/screenshots.
