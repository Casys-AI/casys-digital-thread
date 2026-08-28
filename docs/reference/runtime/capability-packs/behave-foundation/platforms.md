# Behave Foundation platform coverage

Review date: 2026-08-28.

The complete candidate is supported only on `linux/arm64`. On an Apple Silicon Mac,
Docker Desktop and the local Microsandbox backend run these Linux ARM64 materials.

| Material | Exact runtime identity | Candidate platform |
| --- | --- | --- |
| `syson-db` | `postgres@sha256:926f8799aef36e00001cfe15fba7abbd37d3c5224ea57e4c858e4bb670f10561` | `linux/arm64` |
| `syson-app` | `ghcr.io/casys-ai/syson@sha256:fc599abb95587913de11ff6de68060b5593956abc0c47bc753cd19e2987141a6` | `linux/arm64` |
| `mcp-syson` | `ghcr.io/casys-ai/engineering-toolchain@sha256:c04922cc2c0f503c34277c5a1dc81ab28b141945acad90345e2d16882535b4bc` | `linux/arm64` |
| `mcp-build123d-sandbox` | `ghcr.io/casys-ai/engineering-toolchain@sha256:7a255f24448ddb6de496c4e47c2d1634c63daea67e9082b558257287215b23b5` | `linux/arm64` |
| `calculix-worker` | `casys/calculix-microsandbox-worker@sha256:9b3a7468bfbc3f0fe27f7a9ac17c0eb72f1925968173e5a01d985cfa19cbc0a2` | `linux/arm64` |

The four registry materials were inspected as OCI manifests containing an ARM64 Linux
variant. The CalculiX worker claim comes from the existing ARM64 qualification path and
its fixed server-owned runtime profile.

The registry images also expose other platforms, but this candidate makes no complete
`linux/amd64` claim: the exact CalculiX microVM worker has not been qualified there.
