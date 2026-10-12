"""Focused tests for atomic file persistence."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from rugby_data.storage import atomic_write_text


class AtomicWriteTests(unittest.TestCase):
    def test_fsyncs_parent_directory_after_replacing_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.txt"
            events = []
            original_open = os.open
            original_replace = os.replace
            original_fsync = os.fsync

            def open_directory(name, flags, *args):
                if name == path.parent:
                    self.assertEqual(flags, os.O_RDONLY)
                    events.append("open parent")
                return original_open(name, flags, *args)

            def replace(source, destination):
                events.append("replace")
                original_replace(source, destination)

            def fsync(fd):
                events.append("fsync")
                original_fsync(fd)

            with (
                patch("rugby_data.storage.os.open", side_effect=open_directory),
                patch("rugby_data.storage.os.replace", side_effect=replace),
                patch("rugby_data.storage.os.fsync", side_effect=fsync),
            ):
                atomic_write_text(path, "saved")

            self.assertEqual(path.read_text(), "saved")
            self.assertEqual(events, ["fsync", "replace", "open parent", "fsync"])


if __name__ == "__main__":
    unittest.main()
