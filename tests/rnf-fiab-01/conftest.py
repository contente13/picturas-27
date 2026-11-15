import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
# The workers import the shared helpers as the top-level package "utils".
sys.path.insert(0, os.path.join(REPO, "Tools"))
sys.path.insert(0, HERE)
