from build123d import Box, Pos

autopilot_length = 54.3
autopilot_width = 39.0
autopilot_height = 17.5

result = Pos(0, 0, autopilot_height / 2) * Box(autopilot_length, autopilot_width, autopilot_height)
