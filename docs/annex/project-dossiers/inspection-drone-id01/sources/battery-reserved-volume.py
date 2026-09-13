from build123d import Box, Pos

battery_reserved_length = 38.0
battery_reserved_width = 34.0
battery_reserved_height = 25.0

result = Pos(0, 0, battery_reserved_height / 2) * Box(battery_reserved_length, battery_reserved_width, battery_reserved_height)
