# Reference: engineering domains

Audience: both · Diátaxis: reference · Kind: index

This directory follows the bounded contexts under `src/domain/`. Engine names stay
inside the domain that owns their engineering meaning: Build123d belongs to CAD,
OpenModelica to Modelica, and CalculiX to FEA.

| Domain   | Owns                                                                  | Start here                     |
| -------- | --------------------------------------------------------------------- | ------------------------------ |
| CAD      | Closed-language geometry source, execution drafts, canonical geometry | [CAD](cad/README.md)           |
| Modelica | Closed-source dynamic simulation and documentary observations         | [Modelica](modelica/README.md) |
| FEA      | Mechanical proof declarations, isolated solves and evaluated criteria | [FEA](fea/README.md)           |

Shared contracts remain outside these folders:

- [Closed-language compilation](../../explanations/product/closed-language-compilation.md)
  explains the common product doctrine.
- [Admitted source isolated execution](../pipeline/admitted-source-isolated-execution.md)
  defines the shared CAD/Modelica microVM pattern.
- [Compilation and isolation](../pipeline/compilation-and-isolation.md) defines the
  common isolation, publication and recovery boundary.

Domain pages do not redefine project lifecycle, MRTR or Thread contracts. They link to
those shared references and describe only the language, method and evidence owned by the
domain.
