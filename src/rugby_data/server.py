"""Backwards-compatible server module wrapping api_app."""

from pathlib import Path

import uvicorn

from .api_app import DatasetSnapshot, create_app

__all__ = ["DatasetServer", "DatasetSnapshot", "create_app"]


class DatasetServer:
    """Compatibility wrapper that runs the FastAPI app via Uvicorn in a thread."""

    def __init__(self, server_address: tuple[str, int], dataset_path: Path):
        self.host, self.port = server_address
        self.dataset_path = dataset_path
        self.app = create_app(dataset_path)
        self.config = uvicorn.Config(
            self.app, host=self.host, port=self.port, log_level="warning"
        )
        self.server = uvicorn.Server(self.config)
        self.server_port = self.port
        self.server_address = (self.host, self.port)

    def serve_forever(self):
        self.server.run()

    def shutdown(self):
        self.server.should_exit = True

    def server_close(self):
        self.shutdown()
