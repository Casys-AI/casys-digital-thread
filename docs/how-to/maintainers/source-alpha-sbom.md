# How-to: generate a source-alpha SBOM

Audience: maintainers · Diátaxis: how-to · Kind: release procedure

This procedure produces a deterministic inventory for one **committed source checkout**.
It is useful while preparing a public source alpha, but it is not a release switch and
it does not publish a Git tag, repository, image, or Desktop artifact.

## Boundary

The machine-readable boundary is
[source-alpha-scope.json](../../../release/sbom/source-alpha-scope.json). The generated
CycloneDX 1.6 document inventories the root Deno lock and the Workbench npm lock. Its
release manifest SHA-256 hashes every declared input, including the Desktop manifests
and worker locks that are retained as source provenance only.
The committed `.gitattributes` file is itself a hashed `public-export-policy` input,
because its `export-ignore` rules shape the archive bytes.

The scope intentionally excludes all of the following:

- OCI images and layers, base images, operating-system packages, Python wheels, and
  provider artifacts;
- Desktop `.app` bundles, helper binaries, downloaded Node, Codex, or ACPX runtimes,
  code signing, and notarization;
- `node_modules`, caches, build output, `state/local`, Docker volumes, and live
  engineering evidence.
- provider-specific internal prompting retained by the private development checkout:
  `.grok/**`, `.claude/**`, `.cursor/**`, `.codex/**`, and `CLAUDE.md`. The public archive
  keeps `AGENTS.md`, `.agents/skills/**`, and `.github/**`.
- private design history under `docs/assets/**` and `docs/rfcs/**`. Contributor-facing
  media moved to `docs/media/**` remains included.

The source archive therefore proves neither that those artifacts exist nor that any
provider, worker, microVM, Desktop shell, or engineering operation can run. They need
their own artifact-level inventory and qualification gates before a release claims them.

`NOASSERTION` is kept literally when a source lock omits a version, integrity, or
licence. The renderer never guesses a licence from a package name or an upstream
convention.

## Prerequisites

- A clean checkout of the exact candidate commit.
- Deno `2.9.2`, as pinned in [tools.lock.json](../../../release/sbom/tools.lock.json).
- Git on `PATH`; its version is recorded in the generated manifest because Git resolves
  the commit, tree, and tracked source archive.

The renderer is repository-native. It does not download or execute Syft; that fact is
explicitly recorded in the tools lock and output manifest.
The recorded generator SHA-256 is a deterministic digest of every source module named in
`generator.sourceModules`, not merely the small public facade.

## Build and inspect one candidate

Choose a safe label for the output directory. It need not be an existing Git tag; this
command does not create one. Run all commands from the repository root:

```bash
deno task release:source-alpha:build -- --tag v0.1.0-alpha.1
deno task release:source-alpha:render -- --tag v0.1.0-alpha.1
deno task release:source-alpha:verify -- --tag v0.1.0-alpha.1
```

The build creates these ignored, tag-bound files under `dist/release/v0.1.0-alpha.1/`:

| File                           | Meaning                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `source.tar.gz`                | Publicly exportable Git-tracked content at the exact recorded commit and tree, applying committed `export-ignore` rules. |
| `source.sbom.cdx.json`         | Canonical CycloneDX 1.6 source inventory.                                                                                |
| `THIRD_PARTY_NOTICES.md`       | Deterministic source-lock notice table; not an artifact notice bundle.                                                   |
| `source-release-manifest.json` | Commit, tree, archive hash, input hashes, scope hash, tool-lock hash, generator hash, and actual executed tool versions. |
| `SHA256SUMS`                   | Hashes for the four files above.                                                                                         |

`render` is idempotent: it re-renders the notice table from the CycloneDX file and
refreshes `SHA256SUMS`. `verify` regenerates the release representation in memory from
the current clean checkout and rejects any byte mismatch. It does not contact a registry
or a provider.

Keep `dist/release/` out of Git. A candidate asset is tied to both the label and exact
commit; regenerate it after any candidate change instead of committing a stale archive.

## Continue the public-release checklist

This source-only evidence satisfies only the source-inventory part of the broader
[public repository release checklist](prepare-a-public-release.md). Before publishing
anything, separately complete history/secret scanning, fresh-clone validation,
collaboration-security checks, and every image, microVM, and Desktop gate that the
public claim names.
