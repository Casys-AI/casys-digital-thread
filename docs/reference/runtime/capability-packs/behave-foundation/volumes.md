# Behave Foundation volume lifecycle

Review date: 2026-08-28.

The selected Compose closure owns two named volumes:

| Volume | Writer | Purpose | Removal rule |
| --- | --- | --- | --- |
| `syson-db-data` | `syson-db` | Persistent SysON database | Preserve unless a separate destructive plan explicitly names it. |
| `build123d-sandbox-exports` | `mcp-build123d-sandbox` | Private admitted-CAD staging | It is not Thread evidence; removal still requires a separate cache/data plan. |

`syson-app` and `mcp-syson` add no named volume in this closure. The `chain` network is
runtime topology, not stored evidence. The CalculiX microVM is ephemeral; its durable
attempt, CAS, WAL and Thread evidence stay under the Digital Thread server-owned stores
and are outside pack removal.

Neither install planning nor doctor deletes a volume. A future `remove` implementation
must preserve both volumes by default and must never delete Thread, CAS, WAL or project
state.
