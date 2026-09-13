# MCS-02 — SysML / SysON

The live renderer path produced architecture r3,
`architecture-f189abef6b84f0d9a2592515077c19c3fceefa465a017a2462a370b49aeee4b8`.
The exact product graph contains eight `PartDefinition` identities: the root system plus
RailFrame, Carriage, CameraMount, BeltDrive, StepperMotor, MotorDriver and
MotionController. The root owns seven exact `PartUsage` occurrences targeting those
seven component definitions.

Exact attachment targets used by technical capture:

- RailFrame `74d544b1-e563-4570-bc68-2f12bdb7d8b2`;
- MotionController `209e25ad-2923-485e-a6c3-15dc1ed654c2`;
- MotorDriver `c5e3a075-c429-4fe7-aa36-d434b33af8b0`.

System requirements were written at r8 and RailFrame structural requirements at r9.
This proves the bounded renderer/readback/requirements surface and SysML-first source
navigation. It does not prove arbitrary SysML, placements, ports, flows, behaviors or a
complete assembly model.
