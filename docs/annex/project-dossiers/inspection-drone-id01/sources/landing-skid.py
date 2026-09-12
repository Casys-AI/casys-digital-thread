from build123d import Box, Pos

skid_length = 120.0
skid_width = 10.0
skid_base_thickness = 4.0
skid_leg_height = 40.0
skid_leg_width = 10.0
skid_leg_pitch = 60.0

base = Pos(0, 0, skid_base_thickness / 2) * Box(skid_length, skid_width, skid_base_thickness)
leg = Box(skid_leg_width, skid_width, skid_leg_height + skid_base_thickness)
left_leg = Pos(-skid_leg_pitch / 2, 0, (skid_leg_height + skid_base_thickness) / 2) * leg
right_leg = Pos(skid_leg_pitch / 2, 0, (skid_leg_height + skid_base_thickness) / 2) * leg

result = base + left_leg + right_leg
