# Reference: engineering domains

Audience: both · Diátaxis: reference · Kind: index

This directory follows the bounded contexts under `src/domain/`. Engine names stay
inside the domain that owns their engineering meaning: Build123d belongs to CAD,
OpenModelica to Modelica, and CalculiX to FEA.

| Domain      | Owns                                                                  | Start here                           |
| ----------- | --------------------------------------------------------------------- | ------------------------------------ |
| CAD         | Closed-language geometry source, execution drafts, canonical geometry | [CAD](cad/README.md)                 |
| Modelica    | Closed-source dynamic simulation and documentary observations         | [Modelica](modelica/README.md)       |
| FEA         | Mechanical proof declarations, isolated solves and evaluated criteria | [FEA](fea/README.md)                 |
| Make / DFM  | Measured DFM cases and checks over one canonical STEP                 | [Make / DFM](../codebase/make-dfm.md) |
| SysML       | Bounded architecture source, renderer, captures and Thread documents  | [SysML](sysml/README.md) · [language](sysml/language.md) · [paths](sysml/paths.md) |
| Sensitivity | First-order study declarations and catalogued offers                  | [Sensitivity](sensitivity/README.md) |
| Electrical  | LED-driver human fiche and circuit-only SPICE closed subset           | [Electrical](electrical/README.md)   |
| Impact      | Sealed cross-domain manifest, recross, human X09, mechanical X11      | [Impact](impact/README.md)           |
| Source workspace | Draft source tree for one project: modules, files, exact revisions | [Project source workspace](project-source-workspace/README.md) |

H01 size inventory (enforced vs missing cardinalities; no invented numbers):
[SysML](sysml/boundedness.md), [CAD](cad/boundedness.md),
[Modelica](modelica/boundedness.md), [FEA](fea/boundedness.md),
[sensitivity](sensitivity/boundedness.md), [electrical](electrical/boundedness.md),
[impact](impact/boundedness.md), and the shared
[isolation and Thread page](../runtime/isolation-and-thread-boundedness.md).

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

SysON is a provider shared by the SysML, FEA and sensitivity surfaces. The SysML pages
describe the language and evidence contracts owned here; the provider calls, runtime and
recovery boundary remain under [provider references](../providers/syson/README.md).
