"""Graph route in-memory untuk pencarian jalur kabel.

Menggantikan pgr_KSP: semua edge yang dibutuhkan sudah ada di Python
(hasil insert_route_fc_bulk), jadi shortest path tidak perlu round trip
ke database. Node graph = site_point_id, bobot = length_m route.
"""

import heapq
from collections import defaultdict


class RouteGraph:
    """Graph tak berarah berbobot di atas site_point_id.

    Semantik sama dengan pgr_KSP(..., k=1, directed=FALSE) tapi terbatas
    pada route milik project yang sedang diproses.
    """

    def __init__(self):
        # node -> [(neighbor, cost, route_id), ...]
        self._adj = defaultdict(list)

    @classmethod
    def from_route_records(cls, records):
        """records: iterable (route_id, site_from, site_to, length_m)."""
        graph = cls()
        for route_id, site_from, site_to, length_m in records:
            graph.add_edge(site_from, site_to, length_m, route_id)
        return graph

    def add_edge(self, a, b, cost, route_id):
        # site point yang tergabung (build_site_clusters tol 20m) bisa
        # menghasilkan self-loop; tidak berguna untuk pencarian jalur.
        if a is None or b is None:
            return
        a = int(a)
        b = int(b)
        if a == b:
            return
        cost = float(cost) if cost is not None else 0.0
        if cost < 0:
            cost = 0.0
        route_id = int(route_id)
        self._adj[a].append((b, cost, route_id))
        self._adj[b].append((a, cost, route_id))

    def __len__(self):
        return len(self._adj)

    def shortest_paths(self, source, targets, max_dist=None):
        """Dijkstra satu sumber ke banyak target, dengan early exit.

        Return dict: target -> (route_ids, length_m). Target yang tidak
        terjangkau (atau di luar max_dist) tidak muncul di hasil.
        """
        source = int(source)
        pending = {int(t) for t in targets}
        pending.discard(source)
        result = {}
        if not pending or source not in self._adj:
            return result

        dist = {source: 0.0}
        prev = {}  # node -> (prev_node, route_id)
        heap = [(0.0, source)]
        settled = set()

        while heap and pending:
            d, node = heapq.heappop(heap)
            if node in settled:
                continue
            # jarak hanya membesar; sisa target pasti di luar jangkauan.
            if max_dist is not None and d > max_dist:
                break
            settled.add(node)

            if node in pending:
                pending.discard(node)
                result[node] = (self._trace(prev, source, node), d)

            for neighbor, cost, route_id in self._adj[node]:
                if neighbor in settled:
                    continue
                nd = d + cost
                if nd < dist.get(neighbor, float("inf")):
                    dist[neighbor] = nd
                    prev[neighbor] = (node, route_id)
                    heapq.heappush(heap, (nd, neighbor))

        return result

    def shortest_path(self, source, target, max_dist=None):
        """Versi satu target. Return (route_ids, length_m) atau None."""
        return self.shortest_paths(source, [target], max_dist=max_dist).get(
            int(target)
        )

    @staticmethod
    def _trace(prev, source, target):
        route_ids = []
        node = target
        while node != source:
            node, route_id = prev[node]
            route_ids.append(route_id)
        route_ids.reverse()
        return route_ids
