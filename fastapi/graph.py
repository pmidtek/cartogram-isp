# ===== graph.py (rewritten) =====
from typing import Dict, List, Tuple
from geoCalculator import (
    Point,
    DistanceCalculator,
)


class Graph:
    """Graph algorithms for FTTH network optimization (uses float distances)

    This version keeps edges as a list (allowing duplicates) and uses floats
    for weights to avoid 0-length integer truncation.
    """

    def __init__(self, graph_dict=None):
        if graph_dict is None:
            graph_dict = {}
        self.__graph_dict = graph_dict

    def get_graph(self):
        return self.__graph_dict

    def make_set(self, parent: Dict, rank: Dict, vertice: str):
        parent[vertice] = vertice
        rank[vertice] = 0

    def find(self, parent: Dict, vertice: str) -> str:
        if parent[vertice] != vertice:
            parent[vertice] = self.find(parent, parent[vertice])
        return parent[vertice]

    def union(self, parent: Dict, rank: Dict, vertice1: str, vertice2: str):
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
        for vertice in graph.get("vertices", []):
            self.make_set(parent, rank, vertice)

        minimum_spanning_tree = set()
        edges = list(graph.get("edges", []))
        edges.sort(key=lambda e: e[0])

        for edge in edges:
            weight, vertice1, vertice2 = edge
            if self.find(parent, vertice1) != self.find(parent, vertice2):
                self.union(parent, rank, vertice1, vertice2)
                minimum_spanning_tree.add(edge)

        return sorted(minimum_spanning_tree)

    def create_graph(self, shafts_data: List[Dict], edges_data: List[Dict]) -> Dict:
        """Create graph from shaft and edge data (weights are floats)"""
        vertices = []
        shaft_positions = {}

        for shaft in shafts_data:
            vid = str(shaft["id"])
            vertices.append(vid)
            shaft_positions[vid] = Point(shaft["x"], shaft["y"])

        edges: List[Tuple[float, str, str]] = []
        processed_pairs = set()  # To avoid duplicate edges

        for edge in edges_data:
            try:
                shaft_1_id = str(edge["shaft_1"])
                shaft_2_id = str(edge["shaft_2"])
            except Exception:
                continue

            if shaft_1_id in shaft_positions and shaft_2_id in shaft_positions:
                # Create a sorted pair to check for duplicates
                pair = tuple(sorted([shaft_1_id, shaft_2_id]))
                if pair in processed_pairs:
                    continue
                processed_pairs.add(pair)

                # Use actual edge length from database if available, otherwise calculate
                try:
                    distance = float(edge.get("length", 0))
                    if distance <= 0:  # fallback to calculated distance
                        point1 = shaft_positions[shaft_1_id]
                        point2 = shaft_positions[shaft_2_id]
                        distance = float(
                            DistanceCalculator.measure_line(point1, point2)
                        )
                except (ValueError, TypeError):
                    point1 = shaft_positions[shaft_1_id]
                    point2 = shaft_positions[shaft_2_id]
                    distance = float(DistanceCalculator.measure_line(point1, point2))

                # Add both directions for undirected graph
                edges.append((distance, shaft_1_id, shaft_2_id))
                edges.append((distance, shaft_2_id, shaft_1_id))

        return {"vertices": vertices, "edges": edges}

    def change_graph_representation(self, graph: Dict) -> Dict:
        """Convert edge list to adjacency dict representation with float weights"""
        g: Dict[str, Dict[str, float]] = {}
        for d, n1, n2 in graph.get("edges", []):
            if n1 not in g:
                g[n1] = {}
            if n2 not in g:
                g[n2] = {}

        for d, n1, n2 in graph.get("edges", []):
            g[n1][n2] = float(d)
            g[n2][n1] = float(d)

        return g

    def bellman_ford(
        self, graph: Dict, source: str, target: str = None
    ) -> Tuple[Dict, Dict]:
        """Bellman-Ford algorithm returning (distance, predecessor)"""
        distance, predecessor = {}, {}

        for node in graph:
            distance[node], predecessor[node] = float("inf"), None
        if source not in graph:
            # if source is isolated return empty
            return {}, {}
        distance[source] = 0.0

        # Relax edges |V|-1 times
        nodes = list(graph.keys())
        for _ in range(max(0, len(nodes) - 1)):
            updated = False
            for node in nodes:
                for neighbour, w in graph[node].items():
                    if distance[node] + w < distance.get(neighbour, float("inf")):
                        distance[neighbour] = distance[node] + w
                        predecessor[neighbour] = node
                        updated = True
            if not updated:
                break

        # check negative cycles (unlikely for distances)
        for node in nodes:
            for neighbour, w in graph[node].items():
                if distance.get(node, float("inf")) + w < distance.get(
                    neighbour, float("inf")
                ):
                    raise ValueError("Negative weight cycle detected")

        return distance, predecessor

    def get_shortest_path(self, graph: Dict, source: str, target: str) -> List[str]:
        """Get shortest path from source to target using Bellman-Ford"""
        distance, predecessor = self.bellman_ford(graph, source)

        if target not in distance or distance[target] == float("inf"):
            return []

        path = []
        current = target
        while current is not None:
            path.append(current)
            current = predecessor.get(current)
        path.reverse()

        return path
