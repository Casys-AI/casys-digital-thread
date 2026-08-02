# Preview a guided project discovery

> **Diátaxis category: how-to.** Use this guide to inspect one live, agent-authored
> pre-project conversation before opening the technical cockpit.

## Start the MCP control plane

Build the repository and start the loopback Console MCP server:

```bash
npm --prefix src/ui ci
deno task start
```

The server listens on `http://127.0.0.1:3020/mcp`. An agent starts a discovery with
`project_discovery_start`, then prepares one bounded question with
`project_discovery_question_propose`. Use `project_discovery_snapshot` before every
subsequent mutation and pass its exact revision.

The checked local example is `drone-concept`. Its first pass preserves this reported
intent:

```text
Je veux concevoir un drone modifiable, pouvoir tester sa physique et estimer son coût de fabrication.
```

The first question asks for the mission. It does not ask the beginner to choose a motor,
battery, material, legal category, or solver input.

## Start the Discovery Workbench

In another terminal:

```bash
deno task preview:discovery
```

Open:

```text
http://127.0.0.1:5174/?discovery=drone-concept
```

The task rebuilds the dedicated single-file Preact surface, then serves the same
immutable revisions used by MCP. It does not launch SysON, build123d, CalculiX,
Modelica, or ERPNext.

## Verify the live truth source

The ordinary JSON endpoint is:

```text
GET http://127.0.0.1:5174/api/project-discoveries/drone-concept
```

It returns `X-Casys-Data-Source: immutable-project-discovery-snapshot`. The event stream
at `/api/project-discoveries/drone-concept/events` emits a complete replacement document
only when the immutable revision changes. Page loads and reconnects execute no agent or
engineering tool.

The page is the shared record for a paired human-and-agent conversation, not a
questionnaire. The agent asks the current question in the conversation. Once you agree
an answer, the agent records it through MCP and the open page receives the new immutable
revision.

The page should show:

- one plain-language intent;
- exactly one read-only active question to discuss with the agent;
- why the answer matters;
- an agent recommendation, bounded alternatives, and their consequences;
- a visible `I don't know` path to discuss with the agent;
- a folded working brief instead of a technical dashboard.

`Correct from cockpit` is deliberately folded. It is a recovery path for a temporarily
unavailable conversation or a record correction, not the normal way to work. Opening it
reveals the bounded direct-answer controls; selecting one sends an explicit same-origin
human command and appends a new revision. The next question appears only after an agent
observes that revision and calls the corresponding MCP authoring tool. The SSE stream
carries the resulting snapshot to the already-open page.

When the agent has enough reviewed context it may propose a brief. Only the browser
reviewer can approve it or request a revision. After approval, one
`Start engineering project` action is available. It sends an explicit same-origin human
command to `POST /api/project-discoveries/:id/handoff` and creates revision 1 under
`state/local/engineering-projects/`, with the approved brief preserved as its
provenance. This is only a project shell: it creates no SysON model, `ThreadSnapshot`,
simulation, technical evidence, or published agent plan, and it does not redirect to an
empty technical cockpit.
