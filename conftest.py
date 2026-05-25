"""
Root conftest.py — ensures the project root is on sys.path
so that `import backend` works from any test directory.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
