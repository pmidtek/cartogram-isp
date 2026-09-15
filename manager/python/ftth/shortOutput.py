from typing import Dict, List, Tuple, Optional
from .geoCalculator import Point, LineString, DistanceCalculator
from .ftthAnalysis import FTTHAnalyzer


class ShortOutputGenerator:
    """Generate detailed shortest path output similar to result2.json format"""
    
    def __init__(self, db_config: Dict[str, str], connection=None, table_config: Dict[str, str] = None):
        self.db_config = db_config
        self.connection = connection
        self.table_config = table_config or {
            "shafts": "shaft_nodes",
            "edges": "kalbar_test",
            "connections": "connections_line",
            "network_edges": "network_edges",
        }
        
    def execute_query(self, query: str, params=None) -> List[Dict]:
        """Execute SQL query and return results"""
        if not self.connection:
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
    
    def get_detailed_shortest_path(self, start_point: Point, end_point: Point) -> Dict:
        """Generate detailed shortest path with complete multilinestring like result2.json"""
        
        try:
            # Get the complete kalbar_test network with detailed geometry
            kalbar_query = f"""
            SELECT ogc_fid, shaft_1, shaft_2, 
                   ST_Length(geom::geography) as length_meters,
                   ST_AsText(geom) as geometry_wkt,
                   ST_NumPoints(geom) as num_points
            FROM {self.table_config['edges']}
            WHERE shaft_1 IS NOT NULL AND shaft_2 IS NOT NULL
            ORDER BY ogc_fid
            """
            
            kalbar_edges = self.execute_query(kalbar_query)
            
            if not kalbar_edges:
                return {"error": "No kalbar_test data available"}
            
            # Use FTTHAnalyzer to get basic path between shafts
            analyzer = FTTHAnalyzer(self.db_config, self.connection, self.table_config)
            basic_result = analyzer.get_shortest_path_analysis(start_point, end_point)
            
            if not basic_result.get("success"):
                return basic_result
                
            path_shaft_ids = basic_result["summary"]["path_shaft_ids"]
            
            # Now build the detailed multilinestring using ALL points from kalbar_test geometries
            all_coordinates = []
            total_distance_meters = 0.0
            
            # Add start point if it's not exactly on a shaft
            start_coords = f"{start_point.x} {start_point.y}"
            
            # Process each segment in the path
            for i in range(len(path_shaft_ids) - 1):
                current_shaft_id = path_shaft_ids[i]
                next_shaft_id = path_shaft_ids[i + 1]
                
                # Find the kalbar_test edge between these shafts
                edge_found = False
                for edge in kalbar_edges:
                    shaft_1_str = str(edge["shaft_1"])
                    shaft_2_str = str(edge["shaft_2"])
                    
                    if ((shaft_1_str == current_shaft_id and shaft_2_str == next_shaft_id) or
                        (shaft_1_str == next_shaft_id and shaft_2_str == current_shaft_id)):
                        
                        # Extract all coordinates from the linestring
                        geom_wkt = edge["geometry_wkt"]
                        if geom_wkt and geom_wkt.startswith("LINESTRING("):
                            coords_str = geom_wkt[11:-1]  # Remove "LINESTRING(" and ")"
                            coord_pairs = coords_str.split(", ")
                            
                            # Determine direction based on shaft order
                            if shaft_1_str == current_shaft_id:
                                # Forward direction
                                for coord_pair in coord_pairs:
                                    coords = coord_pair.strip()
                                    if coords and coords not in all_coordinates:
                                        all_coordinates.append(coords)
                            else:
                                # Reverse direction
                                for coord_pair in reversed(coord_pairs):
                                    coords = coord_pair.strip()
                                    if coords and coords not in all_coordinates:
                                        all_coordinates.append(coords)
                        
                        total_distance_meters += float(edge.get("length_meters", 0))
                        edge_found = True
                        break
                
                if not edge_found:
                    print(f"Warning: No edge found between shafts {current_shaft_id} and {next_shaft_id}")
            
            # Add end point if it's not exactly on a shaft  
            end_coords = f"{end_point.x} {end_point.y}"
            
            # Remove duplicates while preserving order
            unique_coordinates = []
            seen = set()
            
            # Add start point if different from first coordinate
            if all_coordinates and start_coords != all_coordinates[0].strip():
                unique_coordinates.append(start_coords)
            
            for coord in all_coordinates:
                coord = coord.strip()
                if coord not in seen:
                    unique_coordinates.append(coord)
                    seen.add(coord)
            
            # Add end point if different from last coordinate
            if unique_coordinates and end_coords != unique_coordinates[-1].strip():
                unique_coordinates.append(end_coords)
            elif not unique_coordinates:
                # Fallback: direct line from start to end
                unique_coordinates = [start_coords, end_coords]
                total_distance_meters = DistanceCalculator.measure_line(start_point, end_point)
            
            # Create the detailed multilinestring
            if len(unique_coordinates) >= 2:
                multilinestring_coords = ", ".join(unique_coordinates)
                detailed_multilinestring = f"MULTILINESTRING (({multilinestring_coords}))"
            else:
                detailed_multilinestring = f"MULTILINESTRING (({start_coords}, {end_coords}))"
                
            # Calculate additional metrics similar to result2.json
            total_distance_km = total_distance_meters / 1000.0
            
            # Add some additional analysis data (you can customize these)
            analysis_data = f"{total_distance_meters:.1f} meters;{total_distance_km:.2f} km;EPSG:4326"
            
            return {
                "result": f"{detailed_multilinestring};{analysis_data}"
            }
            
        except Exception as e:
            return {"error": f"Detailed path generation failed: {e}"}