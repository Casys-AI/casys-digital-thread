from build123d import Box, Cylinder, Pos

arm_length = 100.0
arm_width = 16.0
arm_height = 5.0
arm_mount_pitch = 20.0
arm_mount_hole_radius = 1.6

beam = Pos(0, 0, arm_height / 2) * Box(arm_length, arm_width, arm_height)
hole = Cylinder(arm_mount_hole_radius, arm_height * 3)
inner_hole = Pos(-arm_length / 2 + arm_mount_pitch / 2, 0, arm_height / 2) * hole
outer_hole = Pos(-arm_length / 2 + arm_mount_pitch * 3 / 2, 0, arm_height / 2) * hole

result = beam - inner_hole - outer_hole
