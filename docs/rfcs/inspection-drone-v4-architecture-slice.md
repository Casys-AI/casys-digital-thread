# Inspection-drone V4 qualitative architecture slice

`architecture.author-inspection-drone@3` is a trusted, server-owned SysON operation. It accepts only the exact approved brief and the r2 SysON seed artifact of `inspection-drone-v4`; it writes one fixed recipe, journals the insertion before dispatch, re-reads the root and package, then persists a content-addressed capture and one r3 descendant snapshot.

The recipe creates `InspectionDrone` composed of `Airframe`, `EnergySystem`, `PropulsionSystem`, `AvionicsAndFlightControl`, and `InspectionCameraPayload`, plus qualitative named requirements. It deliberately retains site/weather/separation, camera mass/power/dimensions/fixation, and autonomy/wind/battery reserve as TBDs. It produces no CAD, physical result, certification claim, flight authorization, or manufacturing verdict.

A WAL entry left at `dispatched` is an unknown provider outcome and is not retried automatically. Provider tool, arguments, and SysML text are owned by the server; an agent supplies only the queued run identity.
