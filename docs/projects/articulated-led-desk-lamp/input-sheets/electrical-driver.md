# G5 — electrical driver input sheet

Audience: human · Diátaxis: how-to · Kind: decision input

Status: `unknown`. The current repository has no registered ngspice product run, so a
complete sheet still cannot be queued until the generic executable adapter is qualified.

## Circuit boundary and source

| Required fact                                                          | Human/source entry |
| ---------------------------------------------------------------------- | ------------------ |
| Product revision and subject `LedDriver`                               | `unknown`          |
| D1 boundary: closed semantic IR or exact attested circuit-only netlist | `unknown`          |
| Circuit source identity, author, revision, media type, and fingerprint | `unknown`          |
| Component/model identities and provenance                              | `unknown`          |
| Supply and named test condition                                        | `unknown`          |
| Assumptions, exclusions, and applicability                             | `unknown`          |

## Observations, signs, and criteria

| Required fact                                                 | Human/source entry |
| ------------------------------------------------------------- | ------------------ |
| Analysis: operating point or reduced transient                | `unknown`          |
| Requested voltage observations and references                 | `unknown`          |
| Requested current observations and sign directions            | `unknown`          |
| Requested power observations, operands, and sign convention   | `unknown`          |
| Requested event-time observation and meaning, if applicable   | `unknown`          |
| Requirement metrics, operators, thresholds, and V/A/W/s units | `unknown`          |
| D3 evaluator choice and rationale                             | `unknown`          |
| Intended consequence and responsible reviewer                 | `unknown`          |

Do not provide an MCP envelope, provider/tool name, `.control`, shell command, host
path, image, timeout, or runtime option. ngspice would be an engine, not an oracle; its
captured observations require a separate qualified L4 evaluation and explicit L5.
