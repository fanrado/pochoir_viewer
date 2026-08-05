"""The sampling grid behind a pochoir array.

The .npz files carry no grid metadata, so spacing and origin cannot be
recovered from the data and must be supplied. This module is the only place
allowed to encode the 0.1 mm default; no other module may hardcode it.
"""

from dataclasses import dataclass

Triple = tuple[float, float, float]


@dataclass(frozen=True)
class Grid:
    """Maps integer node indices of a pochoir array to physical coordinates."""

    shape: tuple[int, int, int]
    spacing: Triple = (0.1, 0.1, 0.1)
    origin: Triple = (0.0, 0.0, 0.0)
    units: str = "mm"

    @classmethod
    def from_shape(
        cls,
        shape: tuple[int, int, int],
        spacing: Triple = (0.1, 0.1, 0.1),
        origin: Triple = (0.0, 0.0, 0.0),
    ) -> "Grid":
        """Build a Grid for an array of `shape`, defaulting to 0.1 mm nodes."""
        return cls(shape=tuple(shape), spacing=tuple(spacing), origin=tuple(origin))

    def index_to_mm(self, ijk: tuple[int, int, int]) -> Triple:
        """Physical position of node `ijk`."""
        return tuple(o + i * s for o, i, s in zip(self.origin, ijk, self.spacing))

    def extent_mm(self) -> Triple:
        """Size of the sampled volume along each axis."""
        return tuple(n * s for n, s in zip(self.shape, self.spacing))

    def to_meta(self) -> dict:
        """JSON-serializable description, for embedding in the exported scene."""
        return {
            "shape": list(self.shape),
            "spacing": list(self.spacing),
            "origin": list(self.origin),
            "units": self.units,
            "extent": list(self.extent_mm()),
        }
