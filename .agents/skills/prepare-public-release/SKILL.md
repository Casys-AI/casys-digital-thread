---
name: prepare-public-release
description: Audit and prepare an exact repository commit for public visibility or release, including reachable history, fresh-clone validation, claimed artifacts, licences, collaboration settings, and anonymous verification. Use for public-readiness work; do not use for a routine internal commit, push, or source check.
---

# Prepare a public release

Orchestrate recorded release evidence without replacing the maintained checklist.

## Establish the release basis

1. Read [`AGENTS.md`](../../../AGENTS.md).
2. Read
   [prepare a public repository release](../../../docs/how-to/maintainers/prepare-a-public-release.md)
   completely.
3. Use [release evidence record](references/release-evidence-record.md) to record
   results.
4. Classify the request as audit, repository remediation, or authorized publication.

Record the candidate commit, authoritative development remote and head, publication
remote and head, initial worktree state, claimed platforms, capabilities, images,
Desktop artifacts, and release assets. Do not assume that two remotes contain the same
commit.

A request to prepare or audit does not authorize changing visibility, publishing
artifacts, rotating credentials, rewriting history, tagging, or announcing.

## Execute the authoritative checklist

Follow the maintained release checklist in order.

For the contributor gate, read
[validate a source checkout](../../../docs/how-to/setup/validate-a-source-checkout.md)
completely and execute it from a clean clone of the exact candidate commit. Record the
initial and final `git status --short`; do not absorb validation drift into the release.

Run provider, image, microVM, packaging, and platform gates only for capabilities the
release claims. Keep source validation, provider availability, runtime qualification,
Desktop distribution, and live engineering evidence as separate claims.

Scan the complete history reachable from the refs being published. Never print a
discovered secret value into logs or the evidence record.

## Remediate within scope

When repository remediation is requested, fix only reviewed in-repository findings and
rerun the affected gates. Preserve unrelated worktree changes.

Treat these as separately authorized external actions:

- changing repository visibility or collaboration/security settings;
- pushing or rewriting publication history;
- rotating or revoking credentials;
- publishing OCI images or Desktop artifacts;
- creating tags or releases;
- announcing the release.

Immediately before an authorized external action, re-resolve its exact commit, remote,
artifact digest, and target.

## Stop conditions

Stop publication and report the exact failed state when:

- a credential or private artifact is reachable in published history;
- development and publication heads diverge without reviewed reconciliation;
- the final candidate cannot be reproduced from a clean clone;
- a claimed image cannot be pulled anonymously by digest;
- a required runtime qualification or platform artifact is missing;
- licences, notices, source availability, relinking material, or SBOM coverage remain
  unresolved;
- validation creates unreviewed tracked drift;
- a claimed platform was not tested;
- the private vulnerability-reporting path cannot be verified;
- an external action lacks explicit authorization.

Keep failed, not-run, `unavailable`, and unresolved items literal. Do not tag or
announce a commit that did not pass the recorded gates.

## Finish

Return the evidence record, exact eligible commit, remaining failures, and external
actions performed or still unauthorized. If publication was authorized and completed,
verify the public result anonymously before calling the release complete.
