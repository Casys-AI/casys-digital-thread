# Casys Digital Thread

**An executable digital thread** — requirement → system model → geometry → physics → proof, traversed and verified by AI agents instead of maintained by hand.

Everywhere else, the digital thread is a traceability *concept*: document links, exports, a spreadsheet a systems engineer keeps alive. This one executes: an agent walks the thread, derives each artifact from the previous one, and proves the result against the model's own requirements — with units, margins, and named conflicts.

```
SysML v2 model          mcp-syson         requirements, constraints, part structure
      │
      ▼
generated geometry      mcp-build123d     CAD as code — exact mass properties, STEP
      │
      ▼
computed physics        mcp-calculix      Gmsh mesh + CalculiX FEA — stress, displacement
      │
      ▼
verified verdict        constraint-solver units-aware evaluation, z3 satisfiability
```

The chain answers, continuously and in minutes, the question that today takes weeks between requirement freeze and design review: **does this design hold every requirement it traces to — with computed proof?**

## Positioning

The research community is converging on this pattern under the name **physics-in-the-loop** (generate-and-verify / LLM-Modulo family): the agent proposes, sound physical tools dispose. See [docs/positioning.md](docs/positioning.md) for the full analysis and references. What distinguishes this implementation:

- **Model-driven** — the thread starts from a SysML v2 model with traced requirements, not from a prompt.
- **Units are values** — 2.5 kg against a 4 lb budget *fails*; unit-blind comparison is the false positive this stack exists to prevent.
- **Composable at protocol level** — each link is an independent MCP server; the agent composes them, no glue code between packages.
- **The computation is the oracle, not the product** — no LLM inside any tool; verdicts come from OCCT, z3, CalculiX.

## Working in this repo

This is the **workspace**, not a source tree. The servers live in their own repos and run from the published image — you clone only this.

Requirements: Docker (Desktop on macOS).

```bash
# 1. Bring up SysON + the three MCP servers over HTTP (optional, for the full stack)
docker compose up -d          # SysON UI: http://localhost:8180

# 2. Or just open this folder in Claude Code:
#    .mcp.json wires syson / build123d / calculix over stdio via the toolchain image.
#    SysON must be reachable on localhost:8180 (docker compose up syson-db syson-app).
```

The `cad-exports` named volume is shared between build123d and calculix: a STEP exported by `build123d_export` is immediately readable by `calculix_solve_static` at `/exports/<name>.step`.

## Repository map

| Path | Contents |
|---|---|
| `.mcp.json` | Claude Code wiring for the three servers (Docker stdio) |
| `docker-compose.yml` | The full stack: SysON + MCP servers over HTTP |
| `docs/positioning.md` | Industry & SOTA positioning, references |
| `examples/bracket/` | The end-to-end walkthrough with real numbers |
| `experiments/oracle/` | The oracle experiment — the project's decisive measurement |

## The ecosystem (public building blocks)

| Package | Registry | Role |
|---|---|---|
| [`@casys/mcp-syson`](https://jsr.io/@casys/mcp-syson) | JSR | SysML v2 models, constraints, part structure |
| [`@casys/mcp-build123d`](https://jsr.io/@casys/mcp-build123d) | JSR | parametric CAD as code |
| [`@casys/mcp-calculix`](https://jsr.io/@casys/mcp-calculix) | JSR | FEA — mesh + linear static solve |
| [`@casys/constraint-solver`](https://jsr.io/@casys/constraint-solver) | JSR | units-aware evaluation + z3 solving |
| [`@casys/mcp-server`](https://jsr.io/@casys/mcp-server) | JSR | the MCP framework all servers build on |
| [`engineering-toolchain`](https://github.com/Casys-AI/engineering-toolchain) | GHCR | one image bundling the chain + system backends |
| [`@casys/mcp-erpnext`](https://jsr.io/@casys/mcp-erpnext) | JSR | costing side: part structure → ERPNext BOM with real prices |

## License

MIT (this workspace). Each building block carries its own license (all MIT).
