# How-to: qualify CalculiX HTTP on an ARM64 host

Audience: maintainer · Diátaxis: how-to · Kind: procedure

Use this private host procedure only for the one code-owned native CalculiX HTTP
candidate. It does not create project or Thread evidence, authorize an engineering run,
or make a structural, safety or flight verdict. The repository catalogue baseline stays
`unqualified`; a successful exact attestation is a host-local operational overlay.

Do not substitute manual Docker `pull`, `up`, `down`, `-v`, prune, an HTTP call or the
root Compose project. H1 owns acquisition, start, lease, stop and observation for this
probe. The fixed candidate owns its image, group, provider protocol, STEP fixture and
solver method.

## 1. Review the closed candidate

From the repository root, run:

```bash
deno task capability:qualify review --candidate=calculix-http-arm64-native-v1
```

The candidate requires an observed and targeted Docker daemon `linux/arm64`, mode
`native`, launch group `casys-mcp-calculix@1.0.0` in Compose project
`casys-mcp-calculix-v1`, and the pinned `casys.mcp-calculix@0.8.2` material with its
unchanged image digest. The group retains exactly `calculix-inputs:/inputs`,
`calculix-runs:/var/lib/mcp-calculix-runs`, and `calculix-exports:/exports`. `/exports`
is required by the image but remains private and retained: it is never proof/evidence or
a CAD exchange. The group has no Docker healthcheck; its sealed readiness is MCP
`tools/list` (15 s total, 1 s per attempt, 250 ms retry). Review recrosses the current
catalogue, admin policy/lock, launch group, host identity, code-owned fixture and
qualification specification. It neither starts the group nor calls the provider.

Read the returned `reviewFingerprint`. It is time-sensitive and is recomputed under the
host mutation lock before apply. Do not supply a provider, image, digest, platform, URL,
tool, token, project, MRTR, Thread, method argument or source path; the CLI refuses
those selectors.

## 2. Apply the exact review

```bash
deno task capability:qualify apply \
  --candidate=calculix-http-arm64-native-v1 \
  --review-fingerprint=<sha256> \
  --confirm
```

H1 prepares durable WAL before mutation, acquires the exact material if needed, starts
the sealed group from an inactive state, stages the fixed bracket STEP under its lease,
and claims one recorded solve. Qualification then requires the same attempt-derived
request id, completed readback, ordered nine-resource ledger, exact `resources/list`
bijection, independent byte hashes, closed request/method, bounded factual metrics, an
H1 stop proof, observed inactive state and a reread exact attestation.

The terminal phase must be read literally. Only `attested` with a `qualified` recorded
outcome supports the host overlay. `failed`, `unavailable`, `quarantined`, `stopped` or
a process exit do not. An attested host binding still says nothing about a product's
strength or requirements.

## 3. Recover the existing WAL

If apply reports a recoverable non-terminal state, continue only that candidate:

```bash
deno task capability:qualify recover --candidate=calculix-http-arm64-native-v1
```

Recovery never starts a second group and, after the dispatch claim, never submits a
second solve. It reads only the exact persisted request id and completes factual
readback, timeout, stop and lease cleanup. Do not delete the WAL or retained provider
volumes to retry; a new qualification basis requires a code-owned candidate or
specification change.

The resulting attestation can make only the exact native binding operationally effective
on this exact host. It creates no product proof, CAS or Thread artifact, satisfied
requirement, resistance verdict, safety claim or flight qualification. For the state
machine and authority contract, read
[local runtime qualification](../../reference/runtime/capability-packs/local-runtime-qualification.md).
