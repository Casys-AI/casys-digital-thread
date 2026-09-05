# How-to guides

Audience: both · Diátaxis: how-to · Kind: index

Use these guides when you already know the outcome you need. They are procedures, not
conceptual introductions, exhaustive contracts, or proof that every prerequisite is
available on the current machine.

| Area                               | Use it to                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`setup/`](setup/)                 | Validate a source checkout without claiming the full atelier is ready                                                                                                                                                                                                                                                                                                                                                                                                            |
| [`verify-design/`](verify-design/) | Walk a project, verify a new design, review proof, and close bounded branches                                                                                                                                                                                                                                                                                                                                                                                                    |
| [`workbench/`](workbench/)         | Preview or extend the read-only Workbench surface                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [`compile/`](compile/)             | Capture and compile reviewed engineering source or parameters                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [`run/`](run/)                     | Execute or recover an admitted simulation path                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| [`agents/`](agents/)               | Follow agent-only sequencing procedures, including [project capability authorization](agents/review-project-capability-authorization.md)                                                                                                                                                                                                                                                                                                                                         |
| [`maintainers/`](maintainers/)     | Preflight providers, [administer the local capability runtime](maintainers/administer-local-capability-runtime.md), [publish first-party microVM images](maintainers/publish-first-party-microvm-images.md), [import a first-party microVM image candidate](maintainers/import-a-first-party-microvm-image-candidate.md), [qualify a first-party microVM image candidate](maintainers/qualify-a-first-party-microvm-image-candidate.md), and prepare a public repository release |
| [`extend/`](extend/)               | Add or change a reviewed engineering capability                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Human-facing filenames use an action plus an outcome. Provider names, operation IDs, and
contract versions appear where exact execution requires them, not as substitutes for the
goal.

Start with
[Walk through an engineering project](verify-design/walk-through-an-engineering-project.md)
to inspect an existing dated path, or
[Verify a new design from scratch](verify-design/verify-a-new-design-from-scratch.md)
when the stated prerequisites are already satisfied.

For the bounded mechanism path, use
[Verify prescribed kinematics](verify-design/verify-prescribed-kinematics.md). If its
single L3 dispatch ends with an unknown provider outcome, switch to
[Recover a prescribed-kinematics observation](run/recover-prescribed-kinematics-observation.md)
instead of retrying it.
