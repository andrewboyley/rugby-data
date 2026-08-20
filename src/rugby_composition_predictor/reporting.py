"""Progress reporting for long-running builds."""

from abc import ABC, abstractmethod
from typing import Self

from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TaskID,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)


class BuildListener(ABC):
    """Receives events as a build progresses. UI-agnostic."""

    @abstractmethod
    def task_started(self, total: int) -> None: ...

    @abstractmethod
    def event_fetched(
        self, index: int, label: str, activity: str, complete: bool
    ) -> None: ...

    @abstractmethod
    def task_finished(self) -> None: ...


class RichProgressBar(BuildListener):
    def __init__(self) -> None:
        self._progress = Progress(
            SpinnerColumn(),
            TextColumn("[bold]{task.description}"),
            BarColumn(),
            TextColumn("{task.completed}/{task.total}", justify="right"),
            TextColumn("[magenta]{task.fields[activity]}", justify="right"),
            TimeElapsedColumn(),
            TimeRemainingColumn(),
        )
        self._task: TaskID | None = None

    def __enter__(self) -> Self:
        self._progress.start()
        return self

    def __exit__(self, *exc) -> None:
        self._progress.stop()

    def task_started(self, total: int) -> None:
        self._task = self._progress.add_task(
            "Fetching games", total=total, activity="starting..."
        )

    def event_fetched(
        self, index: int, label: str, activity: str, complete: bool
    ) -> None:
        assert self._task is not None
        self._progress.update(
            self._task, advance=1, description=label, activity=f"fetching: {activity}"
        )

    def task_finished(self) -> None:
        pass
