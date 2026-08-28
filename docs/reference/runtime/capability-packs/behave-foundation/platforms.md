# Behave Foundation platform coverage

Review date: 2026-08-28.

The complete candidate is supported only on `linux/arm64`. On an Apple Silicon Mac,
Docker Desktop and the local Microsandbox backend run these Linux ARM64 materials.

| Material | Exact runtime identity | Candidate platform |
| --- | --- | --- |
| `syson-db` | `postgres@sha256:926f8799aef36e00001cfe15fba7abbd37d3c5224ea57e4c858e4bb670f10561` | `linux/arm64` |
| `syson-app` | `ghcr.io/casys-ai/syson@sha256:fc599abb95587913de11ff6de68060b5593956abc0c47bc753cd19e2987141a6` | `linux/arm64` |
| `mcp-syson` | `ghcr.io/casys-ai/mcp-syson@sha256:87eee6e35a636124d5ba6911492a245d69edcdf1ba67575676c22a0e9d7ce65e` | `linux/amd64`, `linux/arm64` |
| `mcp-build123d-sandbox` | `ghcr.io/casys-ai/engineering-toolchain@sha256:7a255f24448ddb6de496c4e47c2d1634c63daea67e9082b558257287215b23b5` | `linux/arm64` |
| `calculix-worker` | `casys/calculix-microsandbox-worker@sha256:9b3a7468bfbc3f0fe27f7a9ac17c0eb72f1925968173e5a01d985cfa19cbc0a2` | `linux/arm64` |

The dedicated `mcp-syson` 0.8.3 OCI index was inspected with both Linux AMD64 and ARM64
manifests. Its release runtime-contract binds the index to source revision
`cf22348d1f91ba7329e0dbc04db814bca32ff17e`, labels
`org.opencontainers.image.source=https://github.com/Casys-AI/mcp-syson`,
`org.opencontainers.image.revision=cf22348d1f91ba7329e0dbc04db814bca32ff17e`, and
`org.opencontainers.image.version=0.8.3`. The attached contract asset is
`sha256:d4dd56a07bb349579d7378733313b867160c77291b4a065095fffcf3a848393a` and records
HTTP discovery `sha256:58d41a8e20f8030701fc07eb02b3f4ab11d7dff9c3b468a01c2201e8b69f9db8`,
shared tool-contract `sha256:faa2a2615fa7b8152ed8f2f3c654c5f095a8dee9ba0debf34008bcee8dd4400c`,
and shared viewer `sha256:0621f51beb776e35387349112d4cda6052b298ea39213d8a09d017027cce26b3`
fingerprints. This candidate still makes no complete `linux/amd64` claim because the
exact CalculiX microVM worker has not been qualified there.

The remaining registry materials were inspected as OCI manifests containing an ARM64
Linux variant. The CalculiX worker claim comes from the existing ARM64 qualification
path and its fixed server-owned runtime profile.
