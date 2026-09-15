# -*- coding: utf-8 -*-
"""
FTTH Network Analysis Backend
Extracted from fonds.py for backend API usage without GUI dependencies
Handles shortest path calculations, network optimization, and bandwidth analysis
"""

import psycopg2
import math
from typing import Dict, List, Tuple, Set, Optional, Any
import json


class Point:
    """Simple Point class to replace QgsPoint"""

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


class DistanceCalculator:
    """Distance calculation utilities"""

    @staticmethod
    def measure_line(point1: Point, point2: Point) -> float:
        """Calculate Euclidean distance between two points"""
        dx = point2.x - point1.x
        dy = point2.y - point1.y
        return math.sqrt(dx * dx + dy * dy)


class Graph:
    """Graph algorithms for FTTH network optimization"""

    def __init__(self, graph_dict=None):
        if graph_dict is None:
            graph_dict = {}
        self.__graph_dict = graph_dict

    def get_graph(self):
        return self.__graph_dict

    def make_set(self, parent: Dict, rank: Dict, vertice: str):
        """Create a disjoint set for Union-Find"""
        parent[vertice] = vertice
        rank[vertice] = 0

    def find(self, parent: Dict, vertice: str) -> str:
        """Find root of set with path compression"""
        if parent[vertice] != vertice:
            parent[vertice] = self.find(parent, parent[vertice])
        return parent[vertice]

    def union(self, parent: Dict, rank: Dict, vertice1: str, vertice2: str):
        """Union two sets by rank"""
        root1 = self.find(parent, vertice1)
        root2 = self.find(parent, vertice2)
        if root1 != root2:
            if rank[root1] > rank[root2]:
                parent[root2] = root1
            else:
                parent[root1] = root2
            if rank[root1] == rank[root2]:
                rank[root2] += 1

    def kruskal(self, parent: Dict, rank: Dict, graph: Dict) -> List[Tuple]:
        """Kruskal's algorithm for minimum spanning tree"""
        for vertice in graph["vertices"]:
            self.make_set(parent, rank, vertice)

        minimum_spanning_tree = set()
        edges = list(graph["edges"])
        edges.sort()

        for edge in edges:
            weight, vertice1, vertice2 = edge
            if self.find(parent, vertice1) != self.find(parent, vertice2):
                self.union(parent, rank, vertice1, vertice2)
                minimum_spanning_tree.add(edge)

        return sorted(minimum_spanning_tree)

    def create_graph(self, shafts_data: List[Dict], edges_data: List[Dict]) -> Dict:
        """Create graph from shaft and edge data"""
        vertices = []
        shaft_positions = {}

        for shaft in shafts_data:
            vertices.append(str(shaft["id"]))
            shaft_positions[str(shaft["id"])] = Point(shaft["x"], shaft["y"])

        edges = set()
        for edge in edges_data:
            shaft_1_id = str(edge["shaft_1"])
            shaft_2_id = str(edge["shaft_2"])

            if shaft_1_id in shaft_positions and shaft_2_id in shaft_positions:
                point1 = shaft_positions[shaft_1_id]
                point2 = shaft_positions[shaft_2_id]
                distance = DistanceCalculator.measure_line(point1, point2)

                edges.add((int(distance), shaft_1_id, shaft_2_id))
                edges.add((int(distance), shaft_2_id, shaft_1_id))

        return {"vertices": vertices, "edges": edges}

    def change_graph_representation(self, graph: Dict) -> Dict:
        """Convert edge list to adjacency list representation"""
        g = {}
        for d, n1, n2 in graph["edges"]:
            if n1 not in g:
                g[n1] = {}
            if n2 not in g:
                g[n2] = {}

        for d, n1, n2 in graph["edges"]:
            g[n1][n2] = d
            g[n2][n1] = d

        return g

    def bellman_ford(self, graph: Dict, source: str) -> Tuple[Dict, Dict]:
        """Bellman-Ford algorithm for shortest paths"""
        distance, predecessor = {}, {}

        for node in graph:
            distance[node], predecessor[node] = float("inf"), None
        distance[source] = 0

        # Relax edges
        for _ in range(len(graph) - 1):
            for node in graph:
                for neighbour in graph[node]:
                    if distance[neighbour] > distance[node] + graph[node][neighbour]:
                        distance[neighbour] = distance[node] + graph[node][neighbour]
                        predecessor[neighbour] = node

        # Check for negative cycles
        for node in graph:
            for neighbour in graph[node]:
                if distance[neighbour] > distance[node] + graph[node][neighbour]:
                    raise ValueError("Negative weight cycle detected")

        return distance, predecessor


class FTTHAnalyzer:
    """Main FTTH Network Analysis Backend Class"""

    def __init__(self, db_config: Dict[str, str]):
        """
        Initialize FTTH Analyzer with database configuration

        Args:
            db_config: Dictionary containing database connection parameters
                      {'host', 'port', 'database', 'user', 'password'}
        """
        self.db_config = db_config
        self.connection = None
        self.shaft_id = 0
        self.net_line_id = -1
        self.used_points: Set[Point] = set()
        self.shafts_streets_dict: Dict[int, List[Dict]] = {}

        # Default network parameters
        self.max_connections_distance = 50  # meters
        self.max_house_connection = 10  # max houses per shaft
        self.radius = 1
        self.net_type = "Fiber"

    def connect_db(self):
        """Establish database connection"""
        try:
            self.connection = psycopg2.connect(**self.db_config)
            return True
        except Exception as e:
            print(f"Database connection error: {e}")
            return False

    def close_db(self):
        """Close database connection"""
        if self.connection:
            self.connection.close()

    def execute_query(self, query: str, params=None) -> List[Dict]:
        """Execute SQL query and return results"""
        if not self.connection:
            if not self.connect_db():
                return []

        try:
            cursor = self.connection.cursor()
            cursor.execute(query, params)

            if cursor.description:
                columns = [desc[0] for desc in cursor.description]
                results = []
                for row in cursor.fetchall():
                    results.append(dict(zip(columns, row)))
                return results
            else:
                self.connection.commit()
                return []
        except Exception as e:
            print(f"Query execution error: {e}")
            self.connection.rollback()
            return []

    def find_closest_point(self, target_point: Point, points: List[Point]) -> Point:
        """Find the closest point from a list of points"""
        if not points:
            return target_point

        min_distance = float("inf")
        closest_point = points[0]

        for point in points:
            distance = DistanceCalculator.measure_line(target_point, point)
            if distance < min_distance:
                min_distance = distance
                closest_point = point

        return closest_point

    def find_long_distance_points(
        self, point: Point, multi_line_geom: List[List[Point]]
    ) -> Point:
        """Find point that is furthest from given point in multiline geometry"""
        longest_distance = 0
        longest_point = Point(0, 0)

        for line in multi_line_geom:
            for p in line:
                distance = DistanceCalculator.measure_line(point, p)
                if distance > longest_distance:
                    longest_distance = distance
                    longest_point = p

        return longest_point

    def find_line_intersections(self, lines_data: List[Dict]) -> Set[Point]:
        """Find intersection points between lines"""
        intersection_points = set()

        # Simplified intersection detection - in practice, you'd use proper geometric algorithms
        for i, line1 in enumerate(lines_data):
            for j, line2 in enumerate(lines_data[i + 1 :], i + 1):
                # This is a simplified intersection check
                # In real implementation, use proper line intersection algorithms
                pass

        return intersection_points

    def find_start_end_of_lines(self, lines_data: List[Dict]) -> Set[Point]:
        """Find start and end points of all lines"""
        points = set()

        for line in lines_data:
            if "geometry" in line and line["geometry"]:
                # Parse geometry - assuming it's stored as WKT or similar
                # This would need proper geometric parsing in real implementation
                geom = line["geometry"]
                # Add start and end points
                # points.add(start_point)
                # points.add(end_point)

        return points

    def create_shafts(self, streets_data: List[Dict], houses_data: List[Dict]) -> Dict:
        """
        Create network shafts optimally positioned for FTTH coverage

        Returns: Dictionary with shaft creation results
        """
        if not streets_data or not houses_data:
            return {"error": "Missing streets or houses data"}

        # Find intersection and endpoint locations for shaft placement
        shaft_points = set()

        # Add intersection points
        shaft_points.update(self.find_line_intersections(streets_data))

        # Add start/end points of streets
        shaft_points.update(self.find_start_end_of_lines(streets_data))

        # Create shaft records
        shafts_created = []
        self.shaft_id = 0

        for point in shaft_points:
            self.shaft_id += 1

            # Count connected streets
            connected_streets = 0
            closest_street = None
            min_distance = float("inf")

            for street in streets_data:
                # Calculate distance to street - simplified
                street_distance = 0  # This would need proper point-to-line distance
                if street_distance < min_distance:
                    min_distance = street_distance
                    closest_street = street
                    if street_distance < 1:  # Intersection threshold
                        connected_streets += 1

            shaft_data = {
                "id": self.shaft_id,
                "x": point.x,
                "y": point.y,
                "streets_count": connected_streets,
                "houses_count": 0,
                "street_code": closest_street["code"] if closest_street else "",
                "is_start_point": False,
            }

            shafts_created.append(shaft_data)

            # Store shaft-street relationships
            self.shafts_streets_dict[self.shaft_id] = (
                [closest_street] if closest_street else []
            )

        # Insert shafts into database
        if shafts_created:
            self.insert_shafts(shafts_created)

        return {
            "success": True,
            "shafts_created": len(shafts_created),
            "shafts": shafts_created,
        }

    def insert_shafts(self, shafts_data: List[Dict]):
        """Insert shaft data into database"""
        query = """
            INSERT INTO shafts_point (id, x, y, streets_count, houses_count, street_code, is_start_point)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """

        cursor = self.connection.cursor()
        for shaft in shafts_data:
            cursor.execute(
                query,
                (
                    shaft["id"],
                    shaft["x"],
                    shaft["y"],
                    shaft["streets_count"],
                    shaft["houses_count"],
                    shaft["street_code"],
                    shaft["is_start_point"],
                ),
            )
        self.connection.commit()

    def find_available_shaft(
        self, house_point: Point, street_code: str, shafts_data: List[Dict]
    ) -> Optional[Dict]:
        """Find available shaft for house connection"""

        # First, try shafts on the same street
        for shaft in shafts_data:
            if shaft["street_code"] == street_code:
                shaft_point = Point(shaft["x"], shaft["y"])
                distance = DistanceCalculator.measure_line(house_point, shaft_point)

                if (
                    distance <= self.max_connections_distance
                    and shaft["houses_count"] < self.max_house_connection
                ):
                    return shaft

        # If no shaft on same street, find closest available shaft
        closest_shaft = None
        min_distance = float("inf")

        for shaft in shafts_data:
            if shaft["houses_count"] < self.max_house_connection:
                shaft_point = Point(shaft["x"], shaft["y"])
                distance = DistanceCalculator.measure_line(house_point, shaft_point)

                if (
                    distance <= self.max_connections_distance
                    and distance < min_distance
                ):
                    min_distance = distance
                    closest_shaft = shaft

        return closest_shaft

    def create_house_connections(
        self, houses_data: List[Dict], shafts_data: List[Dict], streets_data: List[Dict]
    ) -> Dict:
        """Create connections from houses to shafts"""

        connections_created = []
        self.net_line_id = 0

        for house in houses_data:
            house_point = Point(house["x"], house["y"])

            # Find closest street to determine street code
            closest_street = None
            min_street_distance = float("inf")
            for street in streets_data:
                # Calculate distance to street - simplified
                distance = (
                    0  # This would need proper point-to-line distance calculation
                )
                if distance < min_street_distance:
                    min_street_distance = distance
                    closest_street = street

            if not closest_street:
                continue

            # Find available shaft
            available_shaft = self.find_available_shaft(
                house_point, closest_street["code"], shafts_data
            )

            if available_shaft:
                # Create connection
                self.net_line_id += 1
                shaft_point = Point(available_shaft["x"], available_shaft["y"])
                distance = DistanceCalculator.measure_line(house_point, shaft_point)

                connection = {
                    "id": self.net_line_id,
                    "house_id": house["id"],
                    "shaft_id": available_shaft["id"],
                    "street_code": closest_street["code"],
                    "street_name": closest_street["name"],
                    "connection_type": "Connection",
                    "net_type": self.net_type,
                    "radius": self.radius,
                    "length": distance,
                    "start_x": house_point.x,
                    "start_y": house_point.y,
                    "end_x": shaft_point.x,
                    "end_y": shaft_point.y,
                }

                connections_created.append(connection)

                # Update shaft house count
                available_shaft["houses_count"] += 1

        # Insert connections into database
        if connections_created:
            self.insert_connections(connections_created)

        return {
            "success": True,
            "connections_created": len(connections_created),
            "connections": connections_created,
        }

    def insert_connections(self, connections_data: List[Dict]):
        """Insert connection data into database"""
        query = """
            INSERT INTO connections_line 
            (id, house_id, shaft_id, street_code, street_name, connection_type, 
             net_type, radius, length, start_x, start_y, end_x, end_y)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """

        cursor = self.connection.cursor()
        for conn in connections_data:
            cursor.execute(
                query,
                (
                    conn["id"],
                    conn["house_id"],
                    conn["shaft_id"],
                    conn["street_code"],
                    conn["street_name"],
                    conn["connection_type"],
                    conn["net_type"],
                    conn["radius"],
                    conn["length"],
                    conn["start_x"],
                    conn["start_y"],
                    conn["end_x"],
                    conn["end_y"],
                ),
            )
        self.connection.commit()

    def create_network_kruskal(self, start_point: Point) -> Dict:
        """Create network using Kruskal's minimum spanning tree algorithm"""

        # Get shafts and edges data
        shafts_data = self.execute_query("SELECT * FROM shafts_point")
        edges_data = self.execute_query("SELECT * FROM edges_line")

        if not shafts_data or not edges_data:
            return {"error": "Missing shafts or edges data"}

        # Create graph
        graph_builder = Graph()
        graph = graph_builder.create_graph(shafts_data, edges_data)

        # Run Kruskal's algorithm
        parent = {}
        rank = {}
        spanning_tree = graph_builder.kruskal(parent, rank, graph)

        # Find start shaft
        start_shaft = None
        min_distance = float("inf")
        for shaft in shafts_data:
            shaft_point = Point(shaft["x"], shaft["y"])
            distance = DistanceCalculator.measure_line(start_point, shaft_point)
            if distance < min_distance:
                min_distance = distance
                start_shaft = shaft

        if start_shaft:
            # Mark start shaft
            update_query = "UPDATE shafts_point SET is_start_point = TRUE WHERE id = %s"
            self.execute_query(update_query, (start_shaft["id"],))

        # Create network edges
        network_edges = []
        edge_id = 0

        for edge in spanning_tree:
            weight, shaft_id_1, shaft_id_2 = edge

            # Find corresponding edge data
            matching_edge = None
            for edge_data in edges_data:
                if (
                    str(edge_data["shaft_1"]) == shaft_id_1
                    and str(edge_data["shaft_2"]) == shaft_id_2
                ) or (
                    str(edge_data["shaft_1"]) == shaft_id_2
                    and str(edge_data["shaft_2"]) == shaft_id_1
                ):
                    matching_edge = edge_data
                    break

            if matching_edge:
                edge_id += 1
                network_edge = {
                    "id": edge_id,
                    "street_code": matching_edge["street"],
                    "street_name": matching_edge["name"],
                    "edge_type": "Path",
                    "shaft_1": shaft_id_1,
                    "shaft_2": shaft_id_2,
                    "house_id": -1,
                    "net_type": self.net_type,
                    "radius": self.radius,
                    "length": weight,
                    "algorithm": "Kruskal",
                }
                network_edges.append(network_edge)

        # Insert network edges
        if network_edges:
            self.insert_network_edges(network_edges)

        return {
            "success": True,
            "algorithm": "Kruskal",
            "start_point": str(start_point),
            "edges_created": len(network_edges),
            "edges": network_edges,
        }

    def create_network_bellman_ford(self, start_point: Point) -> Dict:
        """Create network using Bellman-Ford shortest path algorithm"""

        # Get shafts and edges data
        shafts_data = self.execute_query("SELECT * FROM shafts_point")
        edges_data = self.execute_query("SELECT * FROM edges_line")

        if not shafts_data or not edges_data:
            return {"error": "Missing shafts or edges data"}

        # Create graph
        graph_builder = Graph()
        initial_graph = graph_builder.create_graph(shafts_data, edges_data)
        graph = graph_builder.change_graph_representation(initial_graph)

        # Find start shaft
        start_shaft = None
        min_distance = float("inf")
        for shaft in shafts_data:
            shaft_point = Point(shaft["x"], shaft["y"])
            distance = DistanceCalculator.measure_line(start_point, shaft_point)
            if distance < min_distance:
                min_distance = distance
                start_shaft = shaft

        if not start_shaft:
            return {"error": "No suitable start shaft found"}

        # Run Bellman-Ford algorithm
        try:
            distances, predecessors = graph_builder.bellman_ford(
                graph, str(start_shaft["id"])
            )
        except ValueError as e:
            return {"error": str(e)}

        # Mark start shaft
        update_query = "UPDATE shafts_point SET is_start_point = TRUE WHERE id = %s"
        self.execute_query(update_query, (start_shaft["id"],))

        # Create network edges from predecessors
        network_edges = []
        edge_id = 0

        for node, predecessor in predecessors.items():
            if predecessor is not None:
                # Find corresponding edge data
                matching_edge = None
                for edge_data in edges_data:
                    if (
                        str(edge_data["shaft_1"]) == node
                        and str(edge_data["shaft_2"]) == predecessor
                    ) or (
                        str(edge_data["shaft_1"]) == predecessor
                        and str(edge_data["shaft_2"]) == node
                    ):
                        matching_edge = edge_data
                        break

                if matching_edge:
                    edge_id += 1
                    network_edge = {
                        "id": edge_id,
                        "street_code": matching_edge["street"],
                        "street_name": matching_edge["name"],
                        "edge_type": "Path",
                        "shaft_1": predecessor,
                        "shaft_2": node,
                        "house_id": -1,
                        "net_type": self.net_type,
                        "radius": self.radius,
                        "length": matching_edge["length"],
                        "algorithm": "Bellman-Ford",
                    }
                    network_edges.append(network_edge)

        # Insert network edges
        if network_edges:
            self.insert_network_edges(network_edges)

        return {
            "success": True,
            "algorithm": "Bellman-Ford",
            "start_point": str(start_point),
            "edges_created": len(network_edges),
            "edges": network_edges,
            "distances": distances,
        }

    def insert_network_edges(self, edges_data: List[Dict]):
        """Insert network edge data into database"""
        query = """
            INSERT INTO network_edges 
            (id, street_code, street_name, edge_type, shaft_1, shaft_2, house_id,
             net_type, radius, length, algorithm)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """

        cursor = self.connection.cursor()
        for edge in edges_data:
            cursor.execute(
                query,
                (
                    edge["id"],
                    edge["street_code"],
                    edge["street_name"],
                    edge["edge_type"],
                    edge["shaft_1"],
                    edge["shaft_2"],
                    edge["house_id"],
                    edge["net_type"],
                    edge["radius"],
                    edge["length"],
                    edge["algorithm"],
                ),
            )
        self.connection.commit()

    def analyze_network_bandwidth(self, algorithm: str = "kruskal") -> Dict:
        """Analyze network bandwidth and capacity"""

        # Get network data
        shafts_query = "SELECT * FROM shafts_point"
        connections_query = "SELECT * FROM connections_line"
        edges_query = f"SELECT * FROM network_edges WHERE algorithm = %s"

        shafts_data = self.execute_query(shafts_query)
        connections_data = self.execute_query(connections_query)
        edges_data = self.execute_query(edges_query, (algorithm.capitalize(),))

        # Calculate bandwidth requirements
        total_houses = len(connections_data)
        total_shafts = len(shafts_data)
        total_network_length = sum(edge["length"] for edge in edges_data)

        # Calculate shaft utilization
        shaft_utilization = {}
        for shaft in shafts_data:
            shaft_connections = [
                c for c in connections_data if c["shaft_id"] == shaft["id"]
            ]
            utilization = len(shaft_connections) / self.max_house_connection
            shaft_utilization[shaft["id"]] = {
                "connections": len(shaft_connections),
                "utilization_percent": utilization * 100,
                "available_capacity": self.max_house_connection
                - len(shaft_connections),
            }

        # Find bottlenecks (highly utilized shafts)
        bottlenecks = [
            shaft_id
            for shaft_id, data in shaft_utilization.items()
            if data["utilization_percent"] > 80
        ]

        return {
            "success": True,
            "algorithm": algorithm,
            "total_houses": total_houses,
            "total_shafts": total_shafts,
            "total_network_length": total_network_length,
            "average_connection_length": (
                sum(c["length"] for c in connections_data) / len(connections_data)
                if connections_data
                else 0
            ),
            "shaft_utilization": shaft_utilization,
            "bottlenecks": bottlenecks,
            "network_efficiency": {
                "coverage_ratio": (
                    total_houses / total_shafts if total_shafts > 0 else 0
                ),
                "avg_shaft_utilization": (
                    sum(
                        data["utilization_percent"]
                        for data in shaft_utilization.values()
                    )
                    / len(shaft_utilization)
                    if shaft_utilization
                    else 0
                ),
            },
        }

    def get_shortest_path_analysis(
        self, start_point: Point, end_point: Point = None
    ) -> Dict:
        """Get shortest path analysis between points"""

        # Get network data
        shafts_data = self.execute_query("SELECT * FROM shafts_point")
        edges_data = self.execute_query("SELECT * FROM edges_line")

        if not shafts_data or not edges_data:
            return {"error": "Missing network data"}

        # Build graph
        graph_builder = Graph()
        initial_graph = graph_builder.create_graph(shafts_data, edges_data)
        graph = graph_builder.change_graph_representation(initial_graph)

        # Find start shaft
        start_shaft = None
        min_distance = float("inf")
        for shaft in shafts_data:
            shaft_point = Point(shaft["x"], shaft["y"])
            distance = DistanceCalculator.measure_line(start_point, shaft_point)
            if distance < min_distance:
                min_distance = distance
                start_shaft = shaft

        if not start_shaft:
            return {"error": "No suitable start shaft found"}

        try:
            # Calculate shortest paths from start point
            distances, predecessors = graph_builder.bellman_ford(
                graph, str(start_shaft["id"])
            )

            result = {
                "success": True,
                "start_point": str(start_point),
                "start_shaft_id": start_shaft["id"],
                "shortest_distances": distances,
                "path_tree": predecessors,
            }

            # If end point specified, find specific path
            if end_point:
                end_shaft = None
                min_end_distance = float("inf")
                for shaft in shafts_data:
                    shaft_point = Point(shaft["x"], shaft["y"])
                    distance = DistanceCalculator.measure_line(end_point, shaft_point)
                    if distance < min_end_distance:
                        min_end_distance = distance
                        end_shaft = shaft

                if end_shaft:
                    # Reconstruct path
                    path = []
                    current = str(end_shaft["id"])
                    while current is not None:
                        path.append(current)
                        current = predecessors.get(current)
                    path.reverse()

                    result.update(
                        {
                            "end_point": str(end_point),
                            "end_shaft_id": end_shaft["id"],
                            "shortest_path": path,
                            "path_distance": distances.get(
                                str(end_shaft["id"]), float("inf")
                            ),
                        }
                    )

            return result

        except ValueError as e:
            return {"error": str(e)}

    def set_network_parameters(
        self,
        max_distance: int = 50,
        max_connections: int = 10,
        radius: int = 1,
        net_type: str = "Fiber",
    ):
        """Set network analysis parameters"""
        self.max_connections_distance = max_distance
        self.max_house_connection = max_connections
        self.radius = radius
        self.net_type = net_type

    def get_network_summary(self) -> Dict:
        """Get comprehensive network summary"""

        # Get all data
        shafts_data = self.execute_query("SELECT * FROM shafts_point")
        connections_data = self.execute_query("SELECT * FROM connections_line")
        kruskal_edges = self.execute_query(
            "SELECT * FROM network_edges WHERE algorithm = 'Kruskal'"
        )
        bellman_edges = self.execute_query(
            "SELECT * FROM network_edges WHERE algorithm = 'Bellman-Ford'"
        )

        summary = {
            "network_statistics": {
                "total_shafts": len(shafts_data),
                "total_connections": len(connections_data),
                "kruskal_edges": len(kruskal_edges),
                "bellman_ford_edges": len(bellman_edges),
            },
            "parameters": {
                "max_connection_distance": self.max_connections_distance,
                "max_house_connections": self.max_house_connection,
                "fiber_radius": self.radius,
                "network_type": self.net_type,
            },
        }

        if shafts_data:
            # Calculate network metrics
            total_kruskal_length = sum(edge["length"] for edge in kruskal_edges)
            total_bellman_length = sum(edge["length"] for edge in bellman_edges)
            total_connection_length = sum(conn["length"] for conn in connections_data)

            summary["network_metrics"] = {
                "kruskal_total_length": total_kruskal_length,
                "bellman_ford_total_length": total_bellman_length,
                "total_connection_length": total_connection_length,
                "average_connection_length": (
                    total_connection_length / len(connections_data)
                    if connections_data
                    else 0
                ),
            }

        return summary


# Example usage and API endpoints
if __name__ == "__main__":
    # Database configuration
    db_config = {
        "host": "localhost",
        "port": "5432",
        "database": "ftth_network",
        "user": "postgres",
        "password": "password",
    }

    # Initialize analyzer
    analyzer = FTTHAnalyzer(db_config)

    # Set network parameters
    analyzer.set_network_parameters(
        max_distance=50, max_connections=10, radius=1, net_type="Fiber"
    )

    # Example operations:
    # 1. Create shafts
    # streets_data = analyzer.execute_query("SELECT * FROM streets")
    # houses_data = analyzer.execute_query("SELECT * FROM houses")
    # result = analyzer.create_shafts(streets_data, houses_data)

    # 2. Create connections
    # result = analyzer.create_house_connections(houses_data, shafts_data, streets_data)

    # 3. Analyze with Kruskal
    # start_point = Point(100, 200)
    # result = analyzer.create_network_kruskal(start_point)

    # 4. Analyze with Bellman-Ford
    # result = analyzer.create_network_bellman_ford(start_point)

    # 5. Get bandwidth analysis
    # result = analyzer.analyze_network_bandwidth('kruskal')

    # 6. Get shortest path analysis
    # result = analyzer.get_shortest_path_analysis(Point(100, 200), Point(300, 400))

    # Close connection
    analyzer.close_db()
