# G5 — electrical driver input sheet

Audience: human · Diátaxis: how-to · Kind: decision input

Status: `reviewed YOLO source` on 2026-08-22; AL01 admitted ngspice L3–L5 later
observed through Thread r22 (see [runtime evidence](../runtime-evidence.md)). The
circuit and criterion remain delegated demo choices, not a vendor model.

## Circuit boundary and source

| Required fact                                                          | Human/source entry |
| ---------------------------------------------------------------------- | ------------------ |
| Product revision and subject `LedDriver`                               | Decision basis: project r34 / Thread r4; `LedDriver` only |
| D1 boundary: closed semantic IR or exact attested circuit-only netlist | Exact attested circuit-only ngspice netlist |
| Circuit source identity, author, revision, media type, and fingerprint | `al01-led-driver-op-v1`, delegated reviewer, revision 1, `text/x-spice`; capture fingerprint must come from the source-capture tool |
| Component/model identities and provenance                              | Ideal 12 V source `V1`; `330 ohm` series resistor `R1`; explicit demonstration diode model `DLED` in the netlist |
| Supply and named test condition                                        | `12 V` DC operating point, ambient conceptual bench condition |
| Assumptions, exclusions, and applicability                             | Ideal source and explicit diode model; no mains, tolerance, temperature sweep, transient, EMC, optical output, safety, reliability, or component qualification |

Exact reviewed circuit-only source:

```spice
* AL01 LED-driver concept operating point
V1 VIN 0 DC 12
R1 VIN LED 330
D1 LED 0 DLED
.model DLED D(Is=1e-20 N=2 Rs=10 Cjo=10p)
.op
.end
```

## Observations, signs, and criteria

| Required fact                                                 | Human/source entry |
| ------------------------------------------------------------- | ------------------ |
| Analysis: operating point or reduced transient                | DC operating point |
| Requested voltage observations and references                 | `V(LED)` relative to ground |
| Requested current observations and sign directions            | `-I(V1)` as current delivered by the source |
| Requested power observations, operands, and sign convention   | `12 * -I(V1)` W as positive source-delivered electrical power |
| Requested event-time observation and meaning, if applicable   | Not applicable     |
| Requirement metrics, operators, thresholds, and V/A/W/s units | `ledCurrent >= 0.02 A`, `ledCurrent <= 0.04 A`, `electricalPower <= 0.5 W` |
| D3 evaluator choice and rationale                             | Separate server-owned exact scalar comparator after captured engine evidence; ngspice is not the oracle |
| Intended consequence and responsible reviewer                 | Accept only the bounded concept operating point if every named L4 criterion passes; reviewer `local-yolo:startup-opt-in` under explicit paired-conversation delegation |

The diode parameters and all circuit values are explicit delegated demonstration
assumptions. They are not a vendor model or a component recommendation.

Do not provide an MCP envelope, provider/tool name, `.control`, shell command, host
path, image, timeout, or runtime option. ngspice is an engine, not an oracle; its
captured observations require a separate qualified L4 evaluation and explicit L5.
