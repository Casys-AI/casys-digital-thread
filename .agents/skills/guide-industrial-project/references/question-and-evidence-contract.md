# Question and evidence contract

Use this structure as a reasoning and presentation contract. Map it to the active
control-plane schema instead of inventing unsupported fields.

## Guided question

```yaml
questionId: stable-id
decisionId: optional-existing-decision-id
prompt: one plain-language question
whyItMatters: immediate engineering or product consequence
recommendation:
  value: bounded recommendation
  rationale: why it is preferred now
  confidence: low | medium | high
options:
  - value: option-value
    label: human-readable label
    consequences: observable trade-offs
allowUnknown: true
risk: reversible | material | safety-critical | regulatory
evidenceNeeded: []
```

Do not expose raw internal reasoning. Show the recommendation, assumptions, sources,
confidence, and consequences needed for review.

## Project brief draft

Maintain these logical sections even when the current transport uses another shape:

- intended outcome and primary users;
- mission scenarios and operating environment;
- measurable success criteria;
- constraints and exclusions;
- intended markets plus manufacturing and operating jurisdictions;
- observed facts with exact sources;
- provisional assumptions with owner and review trigger;
- open questions ordered by impact;
- proposed decisions and what each unlocks;
- planned verification and manufacturing evidence.

For compliance work, retain separately: authority, jurisdiction, instrument or standard
identifier, revision/effective date, source URI, applicability rationale, means of
compliance, expected evidence, status, and reviewer. Do not flatten multiple countries
into a fictional global requirement.

## Evidence classes

| Class      | Meaning                                                | May support approval?                                    |
| ---------- | ------------------------------------------------------ | -------------------------------------------------------- |
| observed   | Returned by an identified system or inspected artifact | Yes, within its recorded scope                           |
| calculated | Deterministic result with exact inputs and method      | Yes, when inputs and units are bound                     |
| quoted     | Dated supplier or service quote                        | Yes, for its quantity, validity, and exclusions          |
| estimated  | Model or configured rate with explicit assumptions     | Only as an estimate                                      |
| assumed    | Provisional value selected to keep discovery moving    | No, unless the human explicitly approves that assumption |
| unknown    | Required information is absent                         | No                                                       |

Matching names never prove a join. Link CAD, simulation, SysML, ERP, and cost records
only through explicit identities, content fingerprints, or reviewed bindings.
