# Reference: Modelica closed subset v1

Audience: both · Diátaxis: reference · Kind: contract

This page describes what `simulate.run-admitted-modelica@1` can execute today. It is the
worker contract, not a claim of general Modelica or Modelica Standard Library support.

## Executable source form

Apart from whitespace and comments, the admitted source has this exact shape:

```modelica
model ModelName
  "Optional description"
  parameter Real initialTemperature(unit = "degC") = 10;
  parameter Real heatingRate(unit = "K/s") = 2;
  output Real temperatureC(
    unit = "degC",
    start = initialTemperature,
    fixed = true);
equation
  der(temperatureC) = heatingRate;
end ModelName;
```

`ModelName` may be any Modelica identifier and must match the closing name. The
description is optional. The two parameter declarations may appear in either order;
their names, types, units and sole `unit` attribute are exact. The output name and its
three attributes are exact, although attribute order is not significant. There is one
equation and no content after the root model.

| Input                | Exact limit                                                             |
| -------------------- | ----------------------------------------------------------------------- |
| Source bytes         | Non-empty canonical UTF-8, no NUL, at most 262,144 bytes                |
| `initialTemperature` | Finite numeric literal, `-50 <= value <= 100`, unit `degC`              |
| `heatingRate`        | Finite numeric literal, `0.1 <= value <= 10`, unit `K/s`                |
| Variables            | Exactly one `output Real temperatureC`                                  |
| Dynamics             | Exactly `der(temperatureC) = heatingRate`                               |
| MSL coverage         | None: the model uses built-in `Real`; 0 of 286 inventoried MSL packages |

Imports, `extends`, packages, components, `connect`, arrays, functions, algorithms,
events, additional equations and external code are not admitted. The documentary
[OpenModelica inventory](../../../../config/modelica-api/inventory-omc-1.27.0.json)
records the wider language surface; no analyzer generates qualification tables from it
today.

## Server-owned scenario and result

The source does not choose the solver or scenario.

| Field                      | Registered value                                         |
| -------------------------- | -------------------------------------------------------- |
| Scenario                   | `linear-ramp-nominal`                                    |
| Time grid                  | `0 s` through `2 s`, 20 intervals                        |
| Solver                     | `dassl`                                                  |
| Simulation request timeout | 30,000 ms                                                |
| Required metric            | `temperature_final`, unit `degC`                         |
| Expected trajectory        | `temperatureC(t) = initialTemperature + heatingRate * t` |

The worker reopens the CSV, verifies the complete admitted grid and trajectory, and
accepts exactly `evidence.json` and `result.csv`. This is a solver-conformance ramp; it
does not claim a physical heat balance.

## KNOWN GAP — frontend and worker parsers differ

The capture frontend currently recognizes a broader syntax than the execution worker:
scalar `parameter Real` and `output Real` declarations, one equation section,
`der(name) = expression` or `name = expression`, and narrow arithmetic expressions. The
compiler refuses reported `unresolvedConstructs`, but it does not enforce the worker's
exact parameter names, output attributes or single ramp equation.

Consequently, `parser.status: passed` — even with zero unresolved constructs — is not
proof that the worker will accept the source. A semantically bound first-order model
using names such as `rate` and `y` can reach compilation readiness and still fail closed
in the microVM because only `heatingRate`, `initialTemperature` and `temperatureC` are
registered there. Until both stages share one executable validator, author only the
exact form above and preserve any worker rejection as `error`.

Code authorities:

- [capture parser](../../../../src/domain/modelica/source/parse.ts)
- [source analyzer](../../../../src/adapters/modelica/source/qualified-source-analyzer.ts)
- [admitted worker parser and result validator](../../../../src/adapters/modelica/admitted/closed-subset-v1/run.ts)
- [compilation profile catalogue](../../../../src/adapters/compile/admission/fixed-technical-compilation-profile-catalog-provider.ts)
