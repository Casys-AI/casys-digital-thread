Audience: human and agent · Diátaxis: none · Kind: RFC input sheet Status: active

# Human input gates for the articulated-lamp demo

This sheet prevents a fast implementation agent from filling physical blanks merely
because the code queue is long. Ask these questions one at a time when their gate is
reached. Record the answer through the project decision surface and bind it to the exact
project revision; this file is not itself an approval record.

An answer is one of: human intent, sourced observed fact, calculated fact, explicit
provisional assumption, or unknown. A provisional assumption cannot support a verdict
until the human approves it with its consequence. An unknown remains `unresolved` and
does not block generic contract/parser/WAL work that needs no physical value.

## G0 — mission and limits

- **Question:** What exact desk-use scenario should the demo represent, and which uses
  are explicitly excluded?
- **Why now:** every requirement, model boundary and final consequence depends on the
  scenario; “a lamp” is not a load case, thermal condition or circuit test.
- **Recommendation:** approve one narrow indoor desk-use story and keep certification,
  mains safety, EMC, optics, fatigue, stability, Make and Buy excluded.
- **Unknown path:** keep the project at L1 and implement only reusable infrastructure.
- **Risk:** material; the answer frames all later evidence.
- **Evidence needed:** approved brief revision and named product owner.

## G1 — architecture vocabulary and parameter ownership

- **Question:** Do `Base`, `Arm`, `LampHead`, `LedDriver` and `PowerSupply` describe the
  intended product structure, and which component owns each reviewed parameter?
- **Why now:** names and ownership become durable SysON identities and exact compilation
  joins.
- **Recommendation:** keep one stable semantic parameter per real meaning and bind
  multiple analyses to it; do not duplicate a power value for thermal and electrical.
- **Unknown path:** create only structural identities and bare handles; typed values,
  units and downstream bindings stay unresolved.
- **Risk:** reversible before the first architecture write, material afterward.
- **Evidence needed:** approved architecture proposal and provider readback capture.

## G2 — mechanical arm question

- **Question:** What sourced arm geometry, material, physical support/load situation and
  named static acceptance criteria should be reviewed?
- **Why now:** the server can lower a closed FEA case, but it cannot invent the physical
  problem that the case represents.
- **Recommendation:** use one isolated arm and one bounded static question; supply
  engineering facts and sources, never a CalculiX deck, mesh commands or provider args.
- **Unknown path:** stop before proof seal; do not copy CA02 or DL05 values.
- **Risk:** material and potentially safety-relevant outside this concept demo.
- **Evidence needed:** exact CAD source/admission, method sheet or source references,
  requirement identities and signed seal/run MRTRs.

## G3 — correction consequence

- **Question:** If and only if the current mechanical L4 literally fails and a measured
  sensitivity exists, may the agent propose the bounded arm lever correction for human
  review?
- **Why now:** a visually useful fail/pass story must not manufacture a failure or turn
  sensitivity data into authority.
- **Recommendation:** authorize a proposal, not an automatic edit; approve its magnitude
  only from the exact derivative, valid neighbourhood and stated consequences.
- **Unknown path:** keep the failed evidence and stop; do not create a corrected STEP.
- **Risk:** material but reversible through a new immutable successor revision.
- **Evidence needed:** exact failed study-base evaluation, sensitivity capture, lever
  join, human approval and complete successor recomputation.

## G4 — thermal method and criterion

- **Question:** What isolated lamp-head thermal boundary, sourced scalar equations,
  parameters, initial state, power input, scenario and named criterion are intended?
- **Why now:** Modelica v2 can execute admitted scalar source, but successful OMC output
  is documentary until the model assumptions and L4 comparison are reviewed.
- **Recommendation:** use one minimal, sourced scalar model within the admitted grammar;
  keep coupled FEA, MSL and general Modelica outside the demo.
- **Unknown path:** implement the generic evaluation contracts but do not author a `.mo`
  model or claim a thermal result.
- **Risk:** material; the model boundary limits the meaning of every observation.
- **Evidence needed:** human method sheet, source references, exact SysML bindings,
  admission, execution evidence, evaluation capture and L5 disposition.

## G5 — electrical circuit and criterion

- **Question:** Which reviewed LED-driver circuit source, component models, supply/test
  condition, requested V/A/W/s observations and criteria define the electrical question?
- **Why now:** `mcp-spice` availability and tool names do not define a product method.
- **Recommendation:** choose the closed server-rendered circuit IR when it represents
  the reviewed source without loss; otherwise attest one immutable circuit-only netlist.
- **Unknown path:** implement pure schemas and provider preflight only; leave the
  product operation `unavailable` and do not guess MCP fields.
- **Risk:** material; no compliance or electrical-safety conclusion is implied.
- **Evidence needed:** signed D1 representation choice, provider contract/preflight,
  method qualification, separate seal/run MRTRs, replayable evidence and L4/L5 records.

## G6 — cross-domain change and independence

- **Question:** What exact reviewed power/brightness change is proposed, which thermal
  and electrical inputs does it affect, and what sourced argument supports mechanical
  independence for this revision?
- **Why now:** omission of a dependency must never preserve a favourable result.
- **Recommendation:** declare positive causal edges and require a separately reviewed
  independence assertion before carrying mechanics forward.
- **Unknown path:** mark the branch `impact-unresolved`; do not rerun everything and do
  not preserve mechanics by default.
- **Risk:** material; it controls which evidence can support the changed product intent.
- **Evidence needed:** exact change, source anchors, impact manifest, prior input
  consumptions, human impact decision and successor branch evidence.

## G7 — final human consequences

- **Question:** For each exact L4 evaluation and the reviewed impact result, what
  consequence does the responsible human accept or reject within the stated limits?
- **Why now:** an engine result or L4 `pass` is never the product decision.
- **Recommendation:** record narrow branch decisions plus one demo-level disposition;
  never use “lamp passed” as a cross-domain shortcut.
- **Unknown path:** leave the evidence at L4 and the demo closeout blocked at L5.
- **Risk:** consequential and non-delegable.
- **Evidence needed:** exact evaluation identities, limitations, project revision,
  reviewer identity and signed decision records.

Return to the [implementation queue](README.md). Each RFC names the exact gate at which
one of these answers becomes mandatory.
