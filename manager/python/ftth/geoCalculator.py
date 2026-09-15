import math
import os
from typing import Dict, List


class Point:
    """Point class for geometric calculations"""

    def __init__(self, x: float, y: float):
        self.x = x
        self.y = y

    def __str__(self):
        return f"({self.x},{self.y})"

    def __eq__(self, other):
        if isinstance(other, Point):
            return abs(self.x - other.x) < 1e-9 and abs(self.y - other.y) < 1e-9
        return False

    def __hash__(self):
        return hash((round(self.x, 9), round(self.y, 9)))


class LineString:
    """LineString geometry class for network paths"""

    def __init__(self, points: List[Point]):
        self.points = points

    def length(self) -> float:
        """Calculate total length of LineString"""
        total_length = 0
        for i in range(len(self.points) - 1):
            total_length += DistanceCalculator.measure_line(
                self.points[i], self.points[i + 1]
            )
        return total_length

    def start_point(self) -> Point:
        return self.points[0] if self.points else Point(0, 0)

    def end_point(self) -> Point:
        return self.points[-1] if self.points else Point(0, 0)

    def to_wkt(self) -> str:
        """Convert to WKT format for database storage"""
        coords = [f"{p.x} {p.y}" for p in self.points]
        return f"LINESTRING({', '.join(coords)})"

    @classmethod
    def from_wkt(cls, wkt: str) -> "LineString":
        """Create LineString from WKT"""
        # Simple WKT parser - in production, use proper WKT library
        coords_str = wkt.replace("LINESTRING(", "").replace(")", "")
        coords = []
        for coord_pair in coords_str.split(", "):
            x, y = map(float, coord_pair.split())
            coords.append(Point(x, y))
        return cls(coords)


class DistanceCalculator:
    """Distance calculation utilities"""

    @staticmethod
    def measure_line(point1: Point, point2: Point) -> float:
        """Calculate Euclidean distance between two points"""
        dx = point2.x - point1.x
        dy = point2.y - point1.y
        return math.sqrt(dx * dx + dy * dy)

    @staticmethod
    def point_to_line_distance(
        point: Point, line_start: Point, line_end: Point
    ) -> float:
        """Calculate minimum distance from point to line segment"""
        # Vector from line start to end
        line_vec = Point(line_end.x - line_start.x, line_end.y - line_start.y)
        # Vector from line start to point
        point_vec = Point(point.x - line_start.x, point.y - line_start.y)

        # Project point onto line
        line_len_sq = line_vec.x * line_vec.x + line_vec.y * line_vec.y
        if line_len_sq == 0:
            return DistanceCalculator.measure_line(point, line_start)

        dot_product = point_vec.x * line_vec.x + point_vec.y * line_vec.y
        t = max(0, min(1, dot_product / line_len_sq))

        # Find closest point on line
        closest = Point(line_start.x + t * line_vec.x, line_start.y + t * line_vec.y)
        return DistanceCalculator.measure_line(point, closest)

    @staticmethod
    def project_point_on_segment(
        point: Point, line_start: Point, line_end: Point
    ) -> tuple:
        """Project a point onto a line segment and return (projected_point, distance)."""
        dx = line_end.x - line_start.x
        dy = line_end.y - line_start.y
        seg_len_sq = dx * dx + dy * dy
        if seg_len_sq == 0:
            proj_point = Point(line_start.x, line_start.y)
            return proj_point, DistanceCalculator.measure_line(point, proj_point)

        t = ((point.x - line_start.x) * dx + (point.y - line_start.y) * dy) / seg_len_sq
        t = max(0, min(1, t))

        proj_x = line_start.x + t * dx
        proj_y = line_start.y + t * dy
        proj_point = Point(proj_x, proj_y)

        dist = DistanceCalculator.measure_line(point, proj_point)
        return proj_point, dist


class DiggingCoefficientManager:
    """Manager for loading and using digging coefficients from koeficienty.csv"""

    def __init__(self, csv_path: str = None):
        if csv_path is None:
            csv_path = os.path.join(os.path.dirname(__file__), "koeficienty.csv")
        self.csv_path = csv_path
        self.coefficients = self.load_coefficients()

    def load_coefficients(self) -> Dict[int, Dict[str, float]]:
        """Load digging coefficients from CSV file"""
        coefficients = {}
        try:
            # Try multiple encodings for the CSV file
            encodings = ["utf-8", "windows-1252", "cp1250", "iso-8859-1", "latin1"]
            file_content = None

            for encoding in encodings:
                try:
                    with open(self.csv_path, "r", encoding=encoding) as file:
                        file_content = file.read()
                        break
                except UnicodeDecodeError:
                    continue

            if file_content is None:
                print(
                    f"Error: Could not decode CSV file {self.csv_path} with any supported encoding"
                )
                return {}

            for line in file_content.strip().split("\n"):
                parts = line.strip().split(";")
                if len(parts) >= 3:
                    try:
                        type_id = int(parts[0])
                        description = parts[1]
                        coefficient = float(parts[2])
                        coefficients[type_id] = {
                            "description": description,
                            "coefficient": coefficient,
                        }
                    except ValueError:
                        continue
        except FileNotFoundError:
            print(f"Warning: koeficienty.csv not found at {self.csv_path}")

        return coefficients

    def get_coefficient(self, terrain_type_id: int) -> float:
        """Get digging coefficient for terrain type"""
        return self.coefficients.get(terrain_type_id, {}).get("coefficient", 0.0)

    def get_all_coefficients(self) -> List[float]:
        """Get all coefficients sorted by type ID"""
        return [
            self.coefficients[type_id]["coefficient"]
            for type_id in sorted(self.coefficients.keys())
        ]
