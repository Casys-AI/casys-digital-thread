# How-to: prepare a clean public source mirror

Audience: maintainers · Diátaxis: how-to · Kind: publication preparation

Use this path when the private development repository contains branches, retired
projects, or historical artifacts that are not part of the public release. It publishes
one reviewed source tree without treating the private Git history as product payload.

This procedure prepares a candidate only. Creating a repository, deleting remote refs,
force-pushing, changing visibility, tagging, and announcing remain separate external
actions that require explicit authorization.

## Boundary

- The private development remote remains the authority for unpublished work.
- The public mirror starts from one exact, clean, reviewed **export tree**.
- No private branch, tag, reflog, unreachable object, or earlier commit is copied.
- The root licence and every notice required by the exported content remain in the
  exported tree.
- The private source may retain provider-specific development prompts that the committed
  public-export attributes intentionally omit. Those omissions must be documented,
  tested, and limited to the declared paths; they are not a way to hide product source
  or licence material.
- A clean mirror does not make OCI images, providers, microVM workers, Desktop bundles,
  or live engineering evidence part of the source release.

Do not use a repository visibility toggle when the existing remote contains history
outside this boundary. Do not solve that mismatch with an unreviewed history rewrite.

## 1. Freeze and validate the source tree

Record the private candidate commit and tree. Run the source gates from a clean clone of
that exact commit, then complete the source inventory procedure:

- [Validate a source checkout](../setup/validate-a-source-checkout.md)
- [Generate a source-alpha SBOM](source-alpha-sbom.md)

This private-stage inventory is a preflight repetition, not a publishable release asset.
It catches preparation mistakes before a public root exists.

Leave every provider or artifact gate not run as `unavailable` or `not run`.

## 2. Export tracked bytes only

Create the public seed from `git archive <candidate>`, not from the working directory.
The archive excludes `.git`, ignored state, untracked files, local dependencies, build
output, and only the development-only paths marked `export-ignore` in the candidate's
committed `.gitattributes`. Inspect its file list and hash before using it:

```bash
git archive --format=tar <candidate> | tar -tf -
```

The public boundary currently omits `.grok/**`, `.claude/**`, `.cursor/**`, `.codex/**`,
and `CLAUDE.md`, which are provider-specific internal prompting, local configuration,
and command pointers. It also omits the private design history under `docs/assets/**`
and `docs/rfcs/**`. It retains `AGENTS.md`, `.agents/skills/**`, `.github/**`, the
living Diátaxis documentation, and contributor-facing media under `docs/media/**`.
A raw candidate Git tree can therefore differ from the exported tree only at the
declared, tested `export-ignore` paths. Compare the public seed with the archive file
list, not with an unchecked checkout listing.

Initialize a new temporary Git repository from the extracted archive and create one root
commit. Record both identities:

- the private candidate commit and tree, as preparation provenance;
- the public root commit, as the only history proposed for publication.

The two commit ids are expected to differ. Equality of the reviewed exported file tree,
not equality with the raw private candidate tree, is the relevant check.

## 3. Re-run public-scope gates

Against the clean-root repository:

1. scan the complete reachable history and the checked-out tree with the reviewed secret
   scanner;
2. verify that personal absolute paths, private endpoints, `state/local`, credentials,
   and non-public project artifacts are absent;
3. run the full source-validation sequence;
4. build and verify the source-alpha inventory twice from the same commit;
5. confirm that validation creates only ignored outputs.

Only source-alpha assets regenerated and verified twice from the public root commit may
be published. Do not publish an inventory, checksum, notice bundle, or archive produced
at the private preflight stage.

Keep raw scanner findings private. A public release record may contain counts, tool
identity, scope, and outcome, but never a suspected secret value.

## 4. Review before any remote action

Compare the proposed public tree with the private candidate. Review the README, licence,
security route, contribution policy, documentation links, and release claims as a new
contributor would see them.

Only after that review may a maintainer separately authorize the exact public remote,
root commit, visibility, branch settings, tag, assets, and announcement. Verify the
result anonymously after publication.
