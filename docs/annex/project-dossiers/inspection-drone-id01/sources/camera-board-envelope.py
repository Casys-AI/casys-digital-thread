from build123d import Box, Cylinder, Pos

camera_board_width = 25.0
camera_board_height = 24.0
camera_board_thickness = 11.5
camera_board_hole_radius = 1.1
camera_board_pitch_x = 21.0
camera_board_pitch_z = 12.5
camera_board_hole_inset = 2.0

board = Pos(0, 0, camera_board_thickness / 2) * Box(
    camera_board_width,
    camera_board_height,
    camera_board_thickness,
)
hole = Cylinder(camera_board_hole_radius, camera_board_thickness * 3)
lower_left = Pos(
    -camera_board_pitch_x / 2,
    -camera_board_height / 2 + camera_board_hole_inset,
    camera_board_thickness / 2,
) * hole
lower_right = Pos(
    camera_board_pitch_x / 2,
    -camera_board_height / 2 + camera_board_hole_inset,
    camera_board_thickness / 2,
) * hole
upper_left = Pos(
    -camera_board_pitch_x / 2,
    -camera_board_height / 2 + camera_board_hole_inset + camera_board_pitch_z,
    camera_board_thickness / 2,
) * hole
upper_right = Pos(
    camera_board_pitch_x / 2,
    -camera_board_height / 2 + camera_board_hole_inset + camera_board_pitch_z,
    camera_board_thickness / 2,
) * hole

result = board - lower_left - lower_right - upper_left - upper_right
