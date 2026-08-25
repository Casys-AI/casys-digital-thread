# PS-01 SysML

Audience: both · Diátaxis: reference · Kind: project domain status

Thread r3 seals one `DesktopPartsSorter` `PartDefinition`, six component definitions and
six exact typed occurrences: frame, transport, sensing, diverter, driveControl and
collection.

The live provider omitted typed usages when the full textual package was inserted. The
renderer recovery now creates native `PartUsage` plus `FeatureTyping`, sets the target
through code-owned AQL and rereads the exact target identity before publication. PS-01
r3 is the positive runtime proof.

No `AttributeUsage` exists yet for the nine technical parameters reported by the
compilation preview. Ports, flows, placements and behaviors remain outside this capture.
