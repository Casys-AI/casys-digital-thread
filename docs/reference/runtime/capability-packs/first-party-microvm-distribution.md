# Reference: first-party microVM distribution

Audience: maintainer · Diátaxis: reference · Kind: contract

This page is infrastructure release metadata for the five physical first-party
Microsandbox worker images. It is not an agent-facing project surface, not a
provider/tool/endpoint selector, and not a catalogue rewrite. Procedure:
[Publish first-party microVM images](../../../how-to/maintainers/publish-first-party-microvm-images.md).

## Identities that stay separate

| Identity                         | Meaning                                                                                       | Must not be treated as                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Logical catalogued microvm-image | One unit/material/cache recipe in the first-party catalogue                                   | A distinct physical OCI image                                    |
| `physicalImageId`                | Stable descriptor-level identity of one physical worker image                                 | A field of the mutable build recipe or of the acquisition source |
| `buildRecipe`                    | Repo-owned Dockerfile, context, `linux/arm64`, expected user/entrypoint/labels                | Proof of a bit-reproducible image or a runtime pin               |
| Acquisition `source`             | How local cache preparation obtains bytes today (`trusted-dockerfile` or future `oci-digest`) | The GHCR candidate name or the Microsandbox runtime digest       |
| Candidate GHCR image             | Digest-addressed publication with a unique commit-and-workflow-run locator tag                | The catalogued Microsandbox runtime digest                       |
| Qualification target             | The current catalogued Microsandbox runtime pin the candidate may later be compared against   | An output image identity or an automatic pin update              |

Six logical bootstrap descriptors currently map to five physical images. Modelica
qualified and admitted share one physical image. The distribution matrix is derived from
`createFirstPartyMicrosandboxImageBootstrapDescriptors(catalog)`; it is not a second
hard-coded worker list.

Package names are lowercase repositories under `ghcr.io/casys-ai/` of the form
`casys-digital-thread-<physicalImageId>`. Publication never uses `latest`.

## What distribution does and does not do

Distribution emits candidate OCI images for the current recipes. It does not:

- change or claim the catalogued Microsandbox runtime digest;
- pull, qualify, or import into the local Microsandbox cache;
- select a provider, tool, endpoint, or argument;
- make a package public;
- grant redistribution clearance.

A successful GHCR push creates only a candidate. Publication leaves the current
capability and qualification state unchanged; the candidate is not an acquisition source
until a separate review qualifies it on the target ARM Mac and promotes its exact OCI
digest.

## Non-reproducibility and notices

The worker Dockerfiles install packages from moving APT repositories. A later rebuild of
the same git commit is not bit-reproducible proof and is not the catalogued runtime
digest. Buildx provenance and SBOM, when attached to the candidate, are candidate
artifacts. They do not clear third-party licence, notice, or source obligations for the
aggregate image. Do not label an image only with this repository's `AGPL-3.0-only`
licence.

New GHCR packages are not assumed public. Anonymous pull is not a publication claim.

## Platform

Candidates are `linux/arm64` only, built on the official native ARM runner
`ubuntu-24.04-arm`. QEMU and cross-compilation are not a substitute. If that runner is
missing or queued, the publication stays unperformed; it is not a reason to emit an
`amd64` or emulated image.

Planning output is `deno task release:first-party-microvm-images:matrix`. The opt-in
workflow is `.github/workflows/publish-first-party-microvm-images.yml`.
