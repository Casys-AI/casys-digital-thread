# Reference: first-party microVM distribution

Audience: maintainer · Diátaxis: reference · Kind: contract

This page is infrastructure release metadata for the five physical first-party
Microsandbox worker images. It is not an agent-facing project surface, not a
provider/tool/endpoint selector, and not a catalogue rewrite. Publication:
[Publish first-party microVM images](../../../how-to/maintainers/publish-first-party-microvm-images.md).
Candidate import:
[Import a first-party microVM image candidate](../../../how-to/maintainers/import-a-first-party-microvm-image-candidate.md).

## Independently recorded provenance fields

The fields below remain separate even when two systems happen to return the same SHA-256
text. Equality does not turn an OCI build identity into a Microsandbox runtime
observation.

| Identity                         | Meaning                                                                                       | Must not be treated as                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Logical catalogued microvm-image | One unit/material/cache recipe in the first-party catalogue                                   | A distinct physical OCI image                                                            |
| `physicalImageId`                | Stable descriptor-level identity of one physical worker image                                 | A field of the mutable build recipe or of the acquisition source                         |
| `buildRecipe`                    | Repo-owned Dockerfile, context, `linux/arm64`, expected user/entrypoint/labels                | Proof of a bit-reproducible image or a runtime pin                                       |
| Acquisition `source`             | How local cache preparation obtains bytes today (`trusted-dockerfile` or future `oci-digest`) | The GHCR candidate name or the Microsandbox runtime digest                               |
| Candidate OCI index              | Buildx output digest with requested SBOM/provenance and a unique commit-and-workflow-run tag  | The `linux/arm64` image manifest or a Microsandbox runtime pin                           |
| Candidate arm64 manifest         | Exact `linux/arm64` child selected from the raw OCI index                                     | The index digest, a qualification result, or a runtime pin                               |
| Candidate Microsandbox digest    | Manifest digest observed after `docker save` + Microsandbox `Image.load` of that arm64 image  | A replacement for the separately recorded OCI index, platform-manifest, or catalogue pin |
| Qualification target             | The current catalogued Microsandbox runtime pin the candidate may later be compared against   | An output image identity or an automatic pin update                                      |

Five logical bootstrap descriptors currently map one-to-one to five physical images.
Modelica qualified-kit and admitted-source bindings share one installable atom, so they
are one logical target. The versioned distribution contract rejects any count other than
five unique physical images and five unique logical targets. The distribution matrix is
derived from `createFirstPartyMicrosandboxImageBootstrapDescriptors(catalog)`; it is not
a second hard-coded worker list.

Package names are lowercase repositories under `ghcr.io/casys-ai/` of the form
`casys-digital-thread-<physicalImageId>`. Publication never uses `latest`.

## What distribution does and does not do

Distribution emits candidate OCI images for the current recipes. Publication does not
pull, import, qualify, or promote. A later maintainer-only import/inspection path may
pull the exact `linux/arm64` platform manifest from one repository receipt and import it
under a non-catalog Microsandbox candidate identity. That path still does not:

- change or claim the catalogued Microsandbox runtime digest;
- load under the active catalogue pin;
- run a per-domain qualification gate;
- select a provider, tool, endpoint, or argument;
- make a package public;
- grant redistribution clearance.

A successful GHCR push creates only a candidate. Publication leaves the current
capability and qualification state unchanged; the candidate is not an acquisition source
until a separate review qualifies its exact arm64 manifest on the target ARM Mac and
promotes its exact OCI digest.

Every candidate receipt carries the complete input matrix, its fingerprint, the index
and arm64-manifest references, exact Buildx metadata, and the existing qualification
target. It deliberately records `licence: unresolved`, `anonymousPull: not-run`,
`runtimeQualification: not-run`, `eligibleForPromotion: false`, and SBOM/provenance as
`requested`. These literal states prevent a successful build from being mistaken for
distribution clearance, anonymous availability, or runtime evidence.

## Non-reproducibility and notices

The worker Dockerfiles install packages from moving APT repositories. A later rebuild of
the same git commit is not bit-reproducible proof and is not the catalogued runtime
digest. Buildx provenance and SBOM, when attached to the candidate, are candidate
artifacts. They do not clear third-party licence, notice, or source obligations for the
aggregate image. Do not label an image only with this repository's `AGPL-3.0-only`
licence.

New GHCR packages are not assumed public. Anonymous pull is not a publication claim. The
workflow must run from the reviewed GitHub publication mirror; an internal development
remote alone is not a public distribution surface. Package visibility, anonymous pull,
and aggregate-image licence review happen after candidate build, before any runtime
promotion.

## Platform

Candidates are `linux/arm64` only, built on the official native ARM runner
`ubuntu-24.04-arm`. QEMU and cross-compilation are not a substitute. If that runner is
missing or queued, the publication stays unperformed; it is not a reason to emit an
`amd64` or emulated image.

Planning output is `deno task release:first-party-microvm-images:matrix`. The opt-in
workflow is `.github/workflows/publish-first-party-microvm-images.yml`.

## Candidate import identities

The GHCR receipt is not a Microsandbox cache entry. Maintainer import takes that exact
receipt plus the current server-owned matrix, re-parses and re-binds the receipt before
any Docker or Microsandbox effect, re-reads the OCI index, proves exactly one
`linux/arm64` child matches the receipt, pulls the platform-manifest digest, inspects
OS/arch/user/entrypoint/labels, saves, and generates an invocation-owned nonce for a
unique non-catalog staging tag. It refuses a pre-existing staging tag. Returned
`Image.load` handles must prove the requested tag was applied and must not include the
active catalogue pin. The observed Microsandbox digest is recorded, only the
proven-owned staging reference is removed, and the same archive is loaded again as the
canonical Microsandbox cache reference
`docker.io/casys/first-party-candidate-<physicalImageId>@sha256:<observed-msb-digest>`
derived by `pinnedOciImageReference`. The factual import record still stores the short
`casys/first-party-candidate-<physicalImageId>@sha256:<observed-msb-digest>` identity.

Microsandbox SDK 0.6.8 has `Image.load`, `Image.inspect`, and
`Image.remove(reference, { force: false })`. It has no tag or relabel API. The second
`Image.load` is therefore a re-import that applies the canonical cache reference, not an
in-place retag. `Image.remove` is exact and never force or prune. The active catalogue
target is never loaded, rewritten, or deleted. A generated staging reference is not part
of the deterministic factual import record. If record persistence fails, only a new
final candidate created by that invocation is quarantined. A coherent or incoherent
pre-existing final candidate fails without deletion.

CLI: `deno task release:first-party-microvm-images:import-candidate --receipt=<path>`.
Default mode is planning/read. `--run` is the mutation acknowledgement. Qualification
remains `not-run` and `eligibleForPromotion` remains `false`. The factual import record
is the strict reusable authority for a later per-domain qualification: it preserves the
exact source candidate receipt, recalculates that fingerprint on parse/bind, rebinds to
the current matrix on read, and lives locally under
`state/local/first-party-microsandbox-image-candidate-import/`. It is not a
qualification attestation, catalogue pin, or promotion. Callers cannot select a
provider, image, digest, tool, or argument.

## Candidate qualification

After import, each domain gate consumes only that bound
`first-party-microsandbox-image-candidate-import/3.0` record and executes the exact
cached candidate image. CAD currently owns two distinct physical/runtime atoms:
`build123d-isolated-worker` and `geometry-module-assembler-worker`. CalculiX owns
`calculix-worker`. Modelica owns `modelica-microsandbox-worker` as one physical image
and one logical target; qualification still requires two server-owned profile proofs
(`openmodelica-qualified-kit` and `openmodelica-admitted-modelica`). ngspice owns
`ngspice-worker` as one physical image and one logical target (`casys.spice-worker` /
`ngspice-runtime-image` / `ngspice-admitted-circuit`). They are not substitutes. The
gates accept only `--import-record=<path>` plus `--run` (geometry, CalculiX, Modelica
and ngspice also `--recover`). Modelica has no profile selector. ngspice has no profile,
source or netlist selector. Policy, limits, worker command, fixture and validators stay
code-owned. Import already owns acquisition; qualification never builds Docker, never
deletes the candidate cache, and never writes the active catalogue pin. CalculiX
candidate qualification is not a product FEA verdict. Modelica and ngspice candidate
qualification is not method qualification, not promotion, and not L3/L4/L5 engineering
evidence. The Docker ngspice worker smoke remains distinct.

Candidate state lives under
`state/local/first-party-microsandbox-image-candidate-qualification/<physicalImageId>/<import-record fingerprint>/`.
Success is host/runtime evidence only: `eligibleForPromotion` stays `false`. It is not
L3/L4/L5 engineering evidence. Procedure:
[Qualify a first-party microVM image candidate](../../../how-to/maintainers/qualify-a-first-party-microvm-image-candidate.md).
