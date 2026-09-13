from build123d import Cylinder, Pos

motor_radius = 8.95
motor_height = 16.6

result = Pos(0, 0, motor_height / 2) * Cylinder(motor_radius, motor_height)
