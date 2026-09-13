from build123d import Box, Pos

carrier_length = 80.0
carrier_width = 80.0
carrier_thickness = 3.0

result = Pos(0, 0, carrier_thickness / 2) * Box(carrier_length, carrier_width, carrier_thickness)
