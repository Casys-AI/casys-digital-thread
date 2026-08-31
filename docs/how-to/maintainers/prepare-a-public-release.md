# How-to: prepare a public repository release

Audience: maintainers · Diátaxis: how-to · Kind: release checklist

Use this checklist before changing repository visibility. Passing source tests is
necessary, but it does not prove that a fresh contributor can obtain the runtime or that
the distributed Desktop and container images satisfy their notice obligations.

Record the exact commit, tool versions, commands, and results for every completed item.
Leave an unchecked or failed item literal; do not turn it into a release claim.

## 1. Choose the exact publication commit

- Identify the authoritative development remote and the GitHub publication remote.
- Compare their exact heads and review every unpublished commit.
- Publish one reviewed commit; do not rely on a visibility toggle to synchronize
  divergent remotes.
- Create the release from a clean clone of that exact commit.
- When private history is intentionally outside the release boundary, use the
  [clean public mirror procedure](prepare-a-clean-public-mirror.md) instead of exposing
  or rewriting that history implicitly.

## 2. Audit the public data boundary

- Scan the complete reachable Git history with a reviewed secret scanner, not only the
  current worktree.
- Confirm that `.env`, credentials, signing keys, customer data, private engineering
  artifacts, and `state/local/` never became reachable Git objects.
- Review tracked internal workflows, fixtures, screenshots, and absolute user paths for
  material that should not be public.
- Rotate any credential that may have been exposed before publishing the history.

## 3. Prove the contributor path from a fresh clone

- Run [Validate a source checkout](../setup/validate-a-source-checkout.md).
- Verify that the root README states every required prerequisite and does not describe
  `docker compose up -d` as clone-only while a service still needs a sibling repository,
  external environment file, or external Docker network.
- Either make optional integrations opt-in or name their prerequisites at the exact
  command that uses them.
- Verify the documented commands on every operating system the release claims to
  support. Unsupported platforms remain unsupported.

## 4. Prove distributable runtime availability

- Pull every documented GHCR image anonymously by its pinned digest.
- Prepare and run the documented qualification gate for each fixed local microVM worker
  image. `pullPolicy: "never"` is not a bootstrap path.
- Verify the expected CPU architecture for each published image and Desktop artifact.
- Keep a missing image, failed pull, or absent qualification `unavailable`.

## 5. Reconcile licences, notices, and software inventory

- Generate and retain an SBOM for the source checkout, each published OCI image, and
  each packaged Desktop artifact.
- For the deliberately narrower source-alpha inventory, follow
  [Generate a source-alpha SBOM](source-alpha-sbom.md). It does not clear the OCI or
  Desktop artifact obligations in this checklist.
- Review direct and transitive licences. The repository's `AGPL-3.0-only` licence is not
  an aggregate licence for providers, solvers, native libraries, Node, or other bundled
  runtimes.
- Preserve the licence, notice, source-availability, and relinking material required by
  every redistributed component.
- Check final artifacts, not only package manifests: a notice present in a downloaded
  archive is insufficient if packaging copies only its executable.
- Make OCI licence labels describe the aggregate image accurately; do not label an image
  only with the workspace licence when it contains differently licensed software.

## 6. Configure the public collaboration surface

- Keep [CONTRIBUTING.md](../../../CONTRIBUTING.md) and
  [SECURITY.md](../../../SECURITY.md) aligned with the actual repository settings.
- Enable a private vulnerability-reporting route before inviting public reports.
- Define supported branches, issue scope, branch protection, required checks, and the
  maintainer path for provider-specific reports.
- Decide whether a code of conduct and governance policy are required for the intended
  contributor community.

## 7. Run release gates

At minimum, run the source, UI, test, evidence, and documentation gates documented in
[Validate a source checkout](../setup/validate-a-source-checkout.md). Then run the
provider and microVM gates relevant to the capabilities claimed by the release.

After every command, inspect `git status --short`. A validation side effect, generated
bundle, or lockfile drift is not part of the release unless it is separately reviewed.

## 8. Verify the public result anonymously

After the visibility change, use a signed-out session or isolated environment to verify
the repository, release assets, documentation links, image pulls, security-reporting
path, and fresh-clone commands. Tag and announce only the commit that passed the
recorded checks.
