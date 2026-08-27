# Agent skills

These skills are reusable agent workflows for the Casys Digital Thread atelier. They
orchestrate the public documentation; they do not replace it or create a second
authority model.

## Ownership boundary

| Location                                            | Owns                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| [`AGENTS.md`](../../AGENTS.md)                      | Always-on authority rules, non-negotiables, and literal states         |
| [`docs/reference/`](../../docs/reference/README.md) | Public contracts, current identities, coverage, and runtime boundaries |
| [`docs/how-to/`](../../docs/how-to/README.md)       | Human-readable procedures for reproducible goals                       |
| `.agents/skills/`                                   | Triggering, routing, stopping conditions, and agent orchestration      |
| [`scripts/`](../../scripts/)                        | Deterministic checks and repeatable automation                         |

If a skill conflicts with the current registry, a public contract, persisted project
state, or runtime observation, stop and report the drift. Never use skill text to invent
an operation, provider choice, argument, identity, result, or authority grant.

## Skill catalogue

| Skill                                                                           | Use it when                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`guide-industrial-project`](guide-industrial-project/SKILL.md)                 | Turning plain-language intent into a reviewable brief, decisions, and a bounded engineering loop |
| [`admit-and-run-engineering-source`](admit-and-run-engineering-source/SKILL.md) | Capturing, admitting, and executing existing Build123d, Modelica, or circuit-only SPICE source   |
| [`recover-engineering-run`](recover-engineering-run/SKILL.md)                   | Diagnosing a quarantined acknowledged dispatch and governing its human reconciliation            |
| [`extend-engineering-capability`](extend-engineering-capability/SKILL.md)       | Extending one bounded CAD, Modelica, FEA, or SysML authority surface                             |
| [`prepare-public-release`](prepare-public-release/SKILL.md)                     | Auditing and preparing an exact commit for public visibility or release                          |

Choose the narrowest matching skill. A deterministic source check or provider preflight
does not need its own skill when an existing task or script already owns the action.

## Folder convention

Each skill directory has one concise `SKILL.md`. Optional content has one purpose:

- `agents/openai.yaml` provides discovery metadata and a default invocation prompt;
- `references/` holds conditional routing, gates, or result formats loaded only when
  needed;
- `scripts/` is reserved for deterministic logic that would otherwise be rewritten.

Do not add a second README, changelog, copied contract catalogue, or duplicated how-to
inside an individual skill.
