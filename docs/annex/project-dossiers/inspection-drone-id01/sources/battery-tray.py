from build123d import Box, Pos

tray_length = 44.0
tray_width = 40.0
tray_base_thickness = 3.0
tray_wall_thickness = 2.0
tray_wall_height = 32.0

outer = Pos(0, 0, (tray_base_thickness + tray_wall_height) / 2) * Box(tray_length, tray_width, tray_base_thickness + tray_wall_height)
void = Pos(0, 0, tray_base_thickness + tray_wall_height) * Box(tray_length - tray_wall_thickness * 2, tray_width - tray_wall_thickness * 2, tray_wall_height * 2)

result = outer - void
