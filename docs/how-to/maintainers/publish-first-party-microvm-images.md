# How-to: publish first-party microVM images

Audience: maintainer · Diátaxis: how-to · Kind: release procedure

Publish candidate `linux/arm64` OCI images for the five physical first-party
Microsandbox workers. This is opt-in infrastructure release. It does not update the
catalogue pin, qualify a worker, or make a GHCR package public. Contract:
[first-party microVM distribution](../../reference/runtime/capability-packs/first-party-microvm-distribution.md).

Do not run this path to repair a local cache miss. Local acquisition still observes the
exact Microsandbox target and, on miss, reconstructs the in-repo Dockerfile as a
candidate recipe.

## 1. Review the planning matrix

From a clean checkout of the exact commit you intend to publish:

```bash
deno task release:first-party-microvm-images:matrix
```

The command prints compact JSON on stdout. It performs no network, Docker, or file
writes. Confirm five physical images, Modelica qualified and admitted sharing one entry,
lowercase `ghcr.io/casys-ai/casys-digital-thread-<physicalImageId>` names, and no
`latest` or digest publication identity.

## 2. Invoke the workflow on an exact git tag

Create and push a git tag for that commit, then dispatch
`.github/workflows/publish-first-party-microvm-images.yml` on that tag. The workflow
refuses a branch ref. It checks out the tagged commit, rebuilds the matrix, and builds
each image on `ubuntu-24.04-arm` with Docker Buildx. It logs in with `GITHUB_TOKEN`. The
`prepare` job has `contents: read`; the `build` job has `contents: read` and
`packages: write`. It does not use QEMU, a PAT, or `latest`.

Each candidate receives the unique locator tag
`git-<full commit SHA>-run-<workflow run id>-<run attempt>`. This prevents a normal
dispatch or rerun from replacing a previous candidate built from moving APT inputs. The
receipt's OCI digest, not that tag, is the immutable identity used by any later
promotion. Buildx provenance and SBOM are requested when the action supports them.
Per-image JSON and text digest receipts are uploaded as artifacts and written to the job
summary.

If the ARM runner is unavailable, stop. Do not switch the job to `ubuntu-latest` or add
QEMU.

## 3. Treat GHCR output as a candidate

New packages are not assumed public. A private package is not anonymous runtime
availability. Visibility, org policy, and licence/SBOM review of the aggregate image are
separate maintainer decisions. APT-based rebuilds are not bit-reproducible.

The published digest is not the catalogued Microsandbox runtime digest.

## 4. Qualify on the target ARM Mac before any pin change

On the reviewed ARM Mac, pull the candidate by the exact digest from its receipt (with
credentials if the package is private). Do not replace the active catalogue pin or load
it under that active identity by hand. Use a reviewed candidate qualification path and
keep the OCI source digest distinct from the resulting Microsandbox runtime digest. Run
the existing worker/vertical qualification gates for that physical image; the candidate
remains ineligible when qualification fails.

Promotion is a later, reviewed catalogue change. This workflow must not edit
`src/adapters/control-plane/` pins, worker contracts, or the capability-runtime
catalogue.
