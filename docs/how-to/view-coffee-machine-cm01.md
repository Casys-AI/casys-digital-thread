# How-to: prepare the CoffeeMachine mechanical workflow

> **Current boundary.** The reviewed DAG now consumes the canonical CM-01 STEP; it does
> not regenerate the historical support bracket. A real solve still requires an approved
> analysis case and a model-owned criterion for a verdict.

## Start the provider MCPs

```bash
docker compose up -d syson-db syson-app mcp-syson mcp-build123d mcp-calculix
```

Docker Compose starts providers only. It does not execute the workflow or compose the
product interface.

## Publish the canonical CAD artifact

Bootstrap the product subject, execute the reviewed SysON-to-CAD build, and attach its
capture:

```bash
deno task thread:assemble
deno task thread:run-coffee-machine-build
deno task thread:attach-coffee-machine-build --run-id=<reported-run-id>
```

The reported STEP path and SHA-256 are canonical evidence. The mechanical runner must
resolve those values from the latest `ThreadSnapshot`; callers must not substitute
another file with the same display name.

## Inspect the reviewed DAG

[`coffee-machine-mechanical-v1.yaml`](../../config/thread-workflows/coffee-machine-mechanical-v1.yaml)
declares:

```text
SysON constraint extraction
             │
             ▼
canonical STEP + SHA-256 → CalculiX → unit-bearing observations
                                                │
                                                ▼
                                      SysON evaluation
```

The execution request must supply a reviewed mesh size, material constants, fixed and
loaded face boxes, and total force vector. The YAML has no material, support, load,
allowable stress, or safety-factor default.

The current live model contains zero `ConstraintUsage` elements. Constraint extraction
therefore remains empty. A reviewed analysis case may still produce FEA evidence, but an
empty evaluation is not a pass or fail and cannot produce a product verdict.

Do not add `120 MPa`, example aluminium properties, or a convenient load merely to make
the chain green. Before product verification, model or reference:

- the selected material specification;
- the governing support and load case;
- the authoritative allowable or performance limit and its source;
- units, design factor, and the traced product element.

There is intentionally no public `thread:run-mechanical` command until that
analysis-case declaration and its snapshot materializer are reviewed. Opening the
Workbench remains read-only.

## Preview the product surface

```bash
deno task preview:thread
```

The feed shows the canonical SysON-to-CAD chain today. A later mechanical runner will
use the same live journal and canonical publication path for CalculiX observations and
any SysON evaluation.
