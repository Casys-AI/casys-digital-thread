# Capability routes

Read only the route selected for the current request. These links are the maintained
authority; do not reproduce their contracts in the skill.

| Requested extension | Use when                                                                                     | Authoritative runbook                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| CAD closed subset   | A new server-owned Build123d source construct is outside current CAD coverage                | [Extend the CAD closed subset](../../../../docs/how-to/extend/extend-cad-closed-subset.md)               |
| Admitted Modelica   | Project-authored Modelica requires a bounded language construct outside the admitted profile | [Extend admitted Modelica coverage](../../../../docs/how-to/extend/extend-admitted-modelica-coverage.md) |
| FEA product surface | The requested physics or proof method does not fit the qualified FEA schema                  | [Extend the FEA product surface](../../../../docs/how-to/extend/extend-fea-product-surface.md)           |
| Generic SysML       | A generic renderer-backed or documentary SysML concept is outside current coverage           | [Extend the generic SysML surface](../../../../docs/how-to/extend/extend-generic-sysml-surface.md)       |

A new model, product instance, proof case, or source file that fits current coverage is
not a capability extension. Use its normal project workflow.

If a request crosses several rows, split it into independently reviewable authority
extensions. Do not create one catch-all profile or operation.
