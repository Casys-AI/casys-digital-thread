# Install the Behave Foundation candidate

This procedure prepares only the current `casys.behave-foundation@0.1.0` local
developer candidate. It excludes Modelica, SPICE, assembly integrity, sensitivity,
Make/DFM, Buy/ERP and Chrono.

## Prerequisites

- an Apple Silicon or otherwise supported ARM64 host;
- Deno from the repository toolchain;
- Docker with Compose;
- local Microsandbox `0.6.8`;
- access to the exact public or authorized GHCR images named by the candidate.

## Inspect before changing the host

From the repository root:

```sh
deno task capability:behave:doctor
```

The command is read-only. It prints the repository census, host prerequisites and the
exact images that are reusable or missing. `blocked` means the procedure must stop;
`changes-required` means exact runtime material is absent; `ready` means all observed
material is already present. Its evidence level is `declared` until every material has
the exact reviewed cache identity, then `cached-exact`. `candidate-ready` is still only
`declared`; none of those states is an engineering verdict.

## Attest the declared MCP surface without executing it

After the providers have been started by the explicit operator procedure, run:

```sh
deno task capability:behave:attest
```

This read-only command has a fixed loopback allowlist for the mandatory `mcp-syson` and
`mcp-build123d-sandbox` endpoints. It checks local OCI/microVM identities, `GET
/health`, `server/discover`, `tools/list` and `resources/list`, and fingerprints the
listed input/output schemas. It does not issue `tools/call`, does not read a resource,
does not select a provider tool or arguments, and does not qualify a Behave vertical.
`contract-attested` therefore remains below `vertical-qualified`.

## Prepare the Compose closure

The current manual backend is explicit:

```sh
docker compose pull syson-db syson-app mcp-syson mcp-build123d-sandbox
docker compose up -d syson-db syson-app mcp-syson mcp-build123d-sandbox
```

Do not start the entire Compose fleet for this candidate. The command above preserves
the existing loopback mappings and named volumes.

## CalculiX limitation

The exact CalculiX worker uses `pullPolicy: never` in Microsandbox. The doctor can
observe whether its digest-pinned cache entry exists, but this Lot A candidate does not
import or build it automatically. A fresh external machine therefore remains blocked
for the full static-FEA vertical until a separately reviewed, idempotent cache-preparation
operator is published.

This limitation does not block source publication and must not be hidden by treating a
Docker image or a successful container start as a qualified microVM cache entry.

## Start the application

Once the prerequisite runtime is ready, install the UI dependencies and start the local
Digital Thread through the existing tasks documented in
[Local runtime and ports](../../reference/runtime/local-runtime-and-ports.md). The pack
does not introduce a second server start command or activate itself.

Run the from-zero product walk only through
[Verify a new design from scratch](../verify-design/verify-a-new-design-from-scratch.md).
