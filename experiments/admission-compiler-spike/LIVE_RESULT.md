# Integrated admission spike live result

The fixture-only live harness completed on 2026-08-13 against local MCP providers:

- SysON `0.5.2` created and reread one ephemeral project, one `SupportBlock`
  `PartDefinition`, one typed `PartUsage`, one `RequirementUsage`, and two exact
  `ConstraintUsage` objects. Project `6a93ab8b-b68a-457b-b049-83b20b9e6b61` was deleted
  once and a filtered readback returned zero projects.
- build123d produced a 15,354-byte STEP with SHA-256
  `cba565b0edd99731fbb06796fca8c67aa8f26a7e8855ac704fb56ddf625a9b30`.
- CalculiX request `native-smoke-calculix-7d544274-cc99-428d-881e-6993b4ca7f36`
  completed as run `r-4fa1fdb5-75f2-4056-90d1-fe712f438bdc`. All nine ledger resources
  were read by exact URI and rehashed. The result observations were maximum displacement
  `0.000010532284396456116 mm` and maximum von Mises stress `0.05892500743009836 MPa`.
- The separate Modelica solver-conformance request
  `native-smoke-modelica-53070535-3b06-43be-9bec-911cb614bf45` completed as run
  `run_7c2da523-354f-4bef-a71a-e280e4f73a2f` with OpenModelica `1.27.0` and the expected
  final sample `22 degC`.
- Before/after manifests for Engineering Project state, Thread snapshots, cockpit focus,
  and recorded-analysis state were byte-identical. No generated build123d export, newly
  staged CalculiX STEP, or local temporary directory remained.

This is provider-conformance evidence for one closed fixture. It is not a human-approved
brief receipt, production admission, MRTR, durable SysON/Thread model, requirement
verdict, material or mesh qualification, release claim, or proof that arbitrary agent
prose can be compiled safely. Modelica is intentionally not physical evidence for the
mechanical fixture.
