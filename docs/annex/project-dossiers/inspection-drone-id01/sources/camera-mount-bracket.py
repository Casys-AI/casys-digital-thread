from build123d import Box, Cylinder, Pos, Rot

bracket_width = 35.0
base_depth = 30.0
bracket_height = 35.0
thickness = 3.0
camera_pitch_x = 21.0
camera_pitch_z = 12.5
camera_hole_radius = 1.1
camera_lower_z = 10.0
base_pitch_x = 20.0
base_offset_y = -7.5
base_hole_radius = 1.6

base = Pos(0, 0, thickness / 2) * Box(bracket_width, base_depth, thickness)
back = Pos(0, (base_depth - thickness) / 2, bracket_height / 2) * Box(bracket_width, thickness, bracket_height)

camera_hole = Rot(90, 0, 0) * Cylinder(camera_hole_radius, thickness * 3)
camera_lower_left = Pos(-camera_pitch_x / 2, (base_depth - thickness) / 2, camera_lower_z) * camera_hole
camera_lower_right = Pos(camera_pitch_x / 2, (base_depth - thickness) / 2, camera_lower_z) * camera_hole
camera_upper_left = Pos(-camera_pitch_x / 2, (base_depth - thickness) / 2, camera_lower_z + camera_pitch_z) * camera_hole
camera_upper_right = Pos(camera_pitch_x / 2, (base_depth - thickness) / 2, camera_lower_z + camera_pitch_z) * camera_hole
base_hole = Cylinder(base_hole_radius, thickness * 3)
base_left = Pos(-base_pitch_x / 2, base_offset_y, thickness / 2) * base_hole
base_right = Pos(base_pitch_x / 2, base_offset_y, thickness / 2) * base_hole

result = base + back - camera_lower_left - camera_lower_right - camera_upper_left - camera_upper_right - base_left - base_right
