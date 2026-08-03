# Preview a conversation-driven project discovery

> **Diátaxis category: how-to.** Use this guide to inspect one live, agent-authored
> pre-project dossier while the person and agent work in their paired conversation.

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
questionnaire or command console. The agent asks the current question in the
conversation. Once you agree an answer, the agent records it through MCP and the open
page receives the new immutable revision.

The page should show:

- one plain-language intent;
- exactly one read-only active question to discuss with the agent;
- why the answer matters;
- an agent recommendation, bounded alternatives, and their consequences;
- one short reply starter the reviewer can use in the paired conversation or replace
  with a plain-language answer;
- a visible `I don't know` path to discuss with the agent;
- a working brief instead of a technical dashboard;
- no approval, revision, handoff, or provider-execution button.

To correct an answer or draft, tell the agent in the same conversation. It records a new
immutable revision and the SSE stream carries the complete replacement snapshot to the
already-open page. The cockpit never has to notify or wake the agent because it is not a
second input channel.

When the agent has enough context it calls `project_discovery_brief_propose` and tells
you that the organized brief is available in the dossier. Confirm it or explain the
correction in the conversation. For confirmation, the agent calls
`project_discovery_brief_confirm`; the MCP host presents an `elicitation/create` prompt
for that exact brief and fingerprint. An explicit confirmation approves the brief;
declining changes nothing and the agent can prepare a replacement.

After confirmation, the agent calls `project_discovery_project_create`. This creates
revision 1 under `state/local/engineering-projects/`, with the confirmed brief preserved
as provenance. It is only a project shell: it creates no SysON model, `ThreadSnapshot`,
simulation, technical evidence, or published agent plan, and the dossier does not
pretend otherwise.

For a persistent server, set `MCP_MRTR_SIGNING_KEY` before `deno task start`. If it is
absent, local development uses a process-ephemeral key, so finish any pending
confirmation before restarting the server. The current replay store is process-local; do
not load-balance this confirmation flow across multiple instances.
