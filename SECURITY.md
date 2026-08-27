# Security Policy

Casys Digital Thread is an active alpha. It is not yet a hardened multi-user
service or a certified engineering system.

## Reporting a vulnerability

Please report security vulnerabilities privately:

1. Use GitHub Private Vulnerability Reporting through the repository's **Security** tab
   if that feature is enabled.
2. Otherwise email `hello@casys.ai` with the subject
   `[SECURITY] Casys Digital Thread`.

Do not open a public issue, discussion, or pull request containing exploit details. Do
not include live credentials, customer data, private engineering artifacts, or files
from `state/local/`. If a credential may already be exposed, revoke or rotate it first,
then report the surrounding vulnerability with sanitized evidence.

A useful report includes:

- the affected commit, version, component, or image digest;
- the expected security boundary and the observed behavior;
- minimal, sanitized reproduction steps;
- the potential impact and required preconditions;
- any mitigation already tested.

We will handle reports on a best-effort basis. No response or remediation SLA is
promised for this alpha, and submission does not imply a bug-bounty payment. We may ask
for more information and coordinate a disclosure date after a fix is available.

## Repository and provider scope

This repository owns the engineering control plane, registered operations, CAS and WAL
integration, immutable project and Thread state, the read-only Workbench, the Desktop
shell, and local worker definitions. The authority boundary is documented in
[AGENTS.md](AGENTS.md) and the
[agent workspace reference](docs/reference/agent/agent-workspace.md).

Engineering provider servers are maintained in separate repositories and delivered as
published images. Report a provider vulnerability through that provider repository's
security policy. If the correct repository is unclear, use the private Casys contact
above and identify the provider name and exact image digest. Vulnerabilities in an
upstream dependency should also be reported upstream; notify Casys privately when the
Digital Thread integration is affected.

Examples of relevant reports include:

- bypass or forgery of human MRTR confirmation;
- unauthorized provider, tool, argument, lowering, or runtime selection;
- a Workbench path that mutates project state or receives provider credentials;
- path traversal, arbitrary file access, secret disclosure, or unsafe network exposure;
- a local worker or microVM sandbox escape;
- tampering, replay, or identity confusion in CAS, WAL, project, or Thread records;
- a supply-chain issue affecting a pinned dependency or published image.

## Security boundaries and limitations

- Loopback binding limits network exposure but is not a substitute for user
  authentication or multi-user authorization.
- The Workbench is intended to remain a passive `GET` and SSE projection. Commands and
  provider calls remain behind the registered server path.
- Local state, real evidence, credentials, and signing keys must never be committed.
- A successful parser, provider, solver, or isolated execution proves only its bounded
  recorded result. It is not by itself a product-safety, manufacturing, conformity,
  release, or certification decision.
- Findings that depend on unsupported modifications or on compromising another person's
  data or account may not be reproducible or actionable. Do not disrupt services, access
  data you do not own, or perform destructive operations while testing.

For the current runtime assumptions and local exposure model, see
[Local runtime and ports](docs/reference/runtime/local-runtime-and-ports.md).
