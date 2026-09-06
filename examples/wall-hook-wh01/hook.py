# Root fileId wh01-hook. The import matches UTF-8 hex of fileId wh01-dimensions.
from casys_workspace.f_776830312d64696d656e73696f6e73 import length, width, thickness
from build123d import Box

result = Box(length, width, thickness)
