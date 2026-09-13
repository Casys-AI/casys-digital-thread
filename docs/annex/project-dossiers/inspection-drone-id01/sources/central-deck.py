from build123d import Box, Cylinder, Pos, Rot

deck_length = 100.0
deck_width = 100.0
deck_thickness = 3.0
deck_mount_pitch = 80.0
deck_mount_hole_radius = 1.6
deck_camera_hole_world_y = -43.5
deck_camera_hole_pitch = 20.0
deck_camera_frame_yaw = -45.0

plate = Pos(0, 0, deck_thickness / 2) * Box(deck_length, deck_width, deck_thickness)
hole = Cylinder(deck_mount_hole_radius, deck_thickness * 3)
left_hole = Pos(-deck_mount_pitch / 2, 0, deck_thickness / 2) * hole
right_hole = Pos(deck_mount_pitch / 2, 0, deck_thickness / 2) * hole
front_hole = Pos(0, -deck_mount_pitch / 2, deck_thickness / 2) * hole
rear_hole = Pos(0, deck_mount_pitch / 2, deck_thickness / 2) * hole
inner_left_hole = Pos(-deck_mount_pitch / 4, 0, deck_thickness / 2) * hole
inner_right_hole = Pos(deck_mount_pitch / 4, 0, deck_thickness / 2) * hole
inner_front_hole = Pos(0, -deck_mount_pitch / 4, deck_thickness / 2) * hole
inner_rear_hole = Pos(0, deck_mount_pitch / 4, deck_thickness / 2) * hole
camera_world_left = Pos(-deck_camera_hole_pitch / 2, deck_camera_hole_world_y, deck_thickness / 2) * hole
camera_world_right = Pos(deck_camera_hole_pitch / 2, deck_camera_hole_world_y, deck_thickness / 2) * hole
camera_pair = Rot(0, 0, deck_camera_frame_yaw) * (camera_world_left + camera_world_right)

result = plate - left_hole - right_hole - front_hole - rear_hole - inner_left_hole - inner_right_hole - inner_front_hole - inner_rear_hole - camera_pair
