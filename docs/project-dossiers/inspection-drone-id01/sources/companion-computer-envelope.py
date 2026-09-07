from build123d import Box, Pos

computer_length = 65.0
computer_width = 30.0
computer_height = 10.0

result = Pos(0, 0, computer_height / 2) * Box(computer_length, computer_width, computer_height)
