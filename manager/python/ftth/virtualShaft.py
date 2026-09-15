import psycopg2
import os
from dotenv import load_dotenv
from urllib.parse import urlparse
from .geoCalculator import Point
from typing import Dict, Optional

load_dotenv()


class VirtualShaftManager:
    """Manages virtual shafts for FTTH routing - only works when points intersect with table linestrings"""
    
    def __init__(self):
        self.db_config = self._get_db_config()
        
    def _get_db_config(self) -> Dict:
        """Parse DB connection string from .env"""
        db_url = os.getenv("DB_CONNECTION_STRING")
        if not db_url:
            raise ValueError("DB_CONNECTION_STRING not found in environment")
        
        parsed = urlparse(db_url)
        return {
            "host": parsed.hostname,
            "port": parsed.port or 5432,
            "database": parsed.path[1:],  # Remove leading '/'
            "user": parsed.username,
            "password": parsed.password,
        }
    
    def connect_db(self):
        """Establish database connection"""
        return psycopg2.connect(**self.db_config)
    
    def check_point_intersects_linestring(self, point: Point, table_name: str) -> bool:
        """Check if a point intersects with any linestring in the base table"""
        conn = self.connect_db()
        cur = conn.cursor()
        
        try:
            # Check if point intersects with any geometry in the base table
            # Transform point to match the table's geometry SRID
            query = f"""
                SELECT EXISTS(
                    SELECT 1 FROM {table_name}
                    WHERE ST_Intersects(
                        geom,
                        ST_Transform(ST_SetSRID(ST_MakePoint(%s, %s), 4326), ST_SRID(geom))
                    )
                )
            """
            cur.execute(query, (point.x, point.y))
            return cur.fetchone()[0]
            
        finally:
            cur.close()
            conn.close()
    
    def get_intersecting_linestring_info(self, point: Point, table_name: str) -> Optional[Dict]:
        """Get information about the linestring that intersects with the point"""
        conn = self.connect_db()
        cur = conn.cursor()
        
        try:
            query = f"""
                SELECT 
                    ogc_fid,
                    ST_AsText(geom) as geometry
                FROM {table_name}
                WHERE ST_Intersects(
                    geom,
                    ST_Transform(ST_SetSRID(ST_MakePoint(%s, %s), 4326), ST_SRID(geom))
                )
                LIMIT 1
            """
            cur.execute(query, (point.x, point.y))
            result = cur.fetchone()
            
            if result:
                return {
                    'ogc_fid': result[0],
                    'geometry': result[1]
                }
            return None
            
        finally:
            cur.close()
            conn.close()
    
    def get_next_shaft_id(self) -> int:
        """Get the next available shaft ID"""
        conn = self.connect_db()
        cur = conn.cursor()
        
        try:
            cur.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM shaft_nodes")
            return cur.fetchone()[0]
        finally:
            cur.close()
            conn.close()
    
    def get_next_edge_id(self, table_name: str) -> int:
        """Get the next available edge ID for the table"""
        conn = self.connect_db()
        cur = conn.cursor()
        
        try:
            cur.execute(f"SELECT COALESCE(MAX(ogc_fid), 0) + 1 FROM {table_name}_edges")
            return cur.fetchone()[0]
        finally:
            cur.close()
            conn.close()
    
    def create_virtual_shaft_on_intersection(self, point: Point, table_name: str) -> Dict:
        """
        Create a virtual shaft only if the point intersects with a linestring in the base table
        
        Steps:
        1. Check if point intersects with any linestring in base table
        2. If yes, create virtual shaft at that point
        3. Find corresponding edges in {table_name}_edges that contain this point
        4. Split those edges and create connections
        
        Returns: Dict with virtual shaft info or error
        """
        conn = self.connect_db()
        cur = conn.cursor()
        
        try:
            # Step 1: Check if point intersects with base table linestrings
            if not self.check_point_intersects_linestring(point, table_name):
                return {"error": f"Point ({point.x}, {point.y}) does not intersect with {table_name} linestrings"}
            
            # Step 2: Get intersecting linestring info
            linestring_info = self.get_intersecting_linestring_info(point, table_name)
            if not linestring_info:
                return {"error": f"Could not find intersecting linestring for point ({point.x}, {point.y})"}
            
            # Step 3: Create virtual shaft at the intersection point
            virtual_shaft_id = self.get_next_shaft_id()
            cur.execute("""
                INSERT INTO shaft_nodes (id, geom) 
                VALUES (%s, ST_Transform(ST_SetSRID(ST_MakePoint(%s, %s), 4326), 
                        (SELECT ST_SRID(geom) FROM shaft_nodes LIMIT 1)))
            """, (virtual_shaft_id, point.x, point.y))
            
            # Step 4: Find corresponding edges in {table_name}_edges that need to be split
            # Look for edges where the point lies on the line between shaft_1 and shaft_2
            edges_to_split_query = f"""
                SELECT 
                    e.ogc_fid,
                    e.shaft_1,
                    e.shaft_2,
                    e.cost,
                    e.reverse_cost,
                    ST_AsText(e.geom) as geometry
                FROM {table_name}_edges e
                JOIN shaft_nodes s1 ON e.shaft_1 = s1.id
                JOIN shaft_nodes s2 ON e.shaft_2 = s2.id
                WHERE ST_Intersects(
                    e.geom,
                    ST_Transform(ST_SetSRID(ST_MakePoint(%s, %s), 4326), ST_SRID(e.geom))
                )
            """
            
            cur.execute(edges_to_split_query, (point.x, point.y))
            edges_to_split = cur.fetchall()
            
            if not edges_to_split:
                # Clean up - remove the virtual shaft we just created
                cur.execute("DELETE FROM shaft_nodes WHERE id = %s", (virtual_shaft_id,))
                return {"error": f"No corresponding edges found to split for point ({point.x}, {point.y})"}
            
            new_edges_created = 0
            
            # Step 5: Split each intersecting edge
            for edge in edges_to_split:
                ogc_fid, shaft_1, shaft_2, cost, reverse_cost, geometry = edge
                
                # Delete original edge
                cur.execute(f"DELETE FROM {table_name}_edges WHERE ogc_fid = %s", (ogc_fid,))
                
                # Create first segment: shaft_1 -> virtual_shaft
                edge_id_1 = self.get_next_edge_id(table_name) + new_edges_created
                cur.execute(f"""
                    INSERT INTO {table_name}_edges (ogc_fid, shaft_1, shaft_2, geom, cost, reverse_cost)
                    SELECT %s, %s, %s, 
                        ST_MakeLine(s1.geom, s2.geom) as geom,
                        ST_Distance(s1.geom::geography, s2.geom::geography) as cost,
                        ST_Distance(s1.geom::geography, s2.geom::geography) as reverse_cost
                    FROM shaft_nodes s1, shaft_nodes s2 
                    WHERE s1.id = %s AND s2.id = %s
                """, (edge_id_1, shaft_1, virtual_shaft_id, shaft_1, virtual_shaft_id))
                new_edges_created += 1
                
                # Create second segment: virtual_shaft -> shaft_2
                edge_id_2 = self.get_next_edge_id(table_name) + new_edges_created
                cur.execute(f"""
                    INSERT INTO {table_name}_edges (ogc_fid, shaft_1, shaft_2, geom, cost, reverse_cost)
                    SELECT %s, %s, %s,
                        ST_MakeLine(s1.geom, s2.geom) as geom,
                        ST_Distance(s1.geom::geography, s2.geom::geography) as cost,
                        ST_Distance(s1.geom::geography, s2.geom::geography) as reverse_cost
                    FROM shaft_nodes s1, shaft_nodes s2 
                    WHERE s1.id = %s AND s2.id = %s
                """, (edge_id_2, virtual_shaft_id, shaft_2, virtual_shaft_id, shaft_2))
                new_edges_created += 1
            
            conn.commit()
            
            return {
                "success": True,
                "virtual_shaft_id": virtual_shaft_id,
                "virtual_shaft_coordinates": f"{point.x}, {point.y}",
                "intersected_linestring": linestring_info['ogc_fid'],
                "edges_split": len(edges_to_split),
                "new_edges_created": new_edges_created,
                "message": f"Virtual shaft created at intersection point ({point.x}, {point.y})"
            }
            
        except Exception as e:
            conn.rollback()
            return {"error": f"Failed to create virtual shaft: {e}"}
        finally:
            cur.close()
            conn.close()
    
    def create_virtual_shafts_for_endpoints(self, start_point: Point, end_point: Point, table_name: str) -> Dict:
        """
        Create virtual shafts for start and end points only if they intersect with table linestrings
        
        Returns: Dict with results for both points or error message
        """
        
        # Check intersections first
        start_intersects = self.check_point_intersects_linestring(start_point, table_name)
        end_intersects = self.check_point_intersects_linestring(end_point, table_name)
        
        if not start_intersects and not end_intersects:
            return {
                "error": f"Your startpoint and endpoint are not in the {table_name} so you can't add the shaft"
            }
        
        results = {
            "success": True,
            "message": "Virtual shaft creation completed",
            "start_point_result": None,
            "end_point_result": None
        }
        
        # Create virtual shaft for start point if it intersects
        if start_intersects:
            start_result = self.create_virtual_shaft_on_intersection(start_point, table_name)
            results["start_point_result"] = start_result
        else:
            results["start_point_result"] = {
                "error": f"Start point ({start_point.x}, {start_point.y}) does not intersect with {table_name}"
            }
        
        # Create virtual shaft for end point if it intersects  
        if end_intersects:
            end_result = self.create_virtual_shaft_on_intersection(end_point, table_name)
            results["end_point_result"] = end_result
        else:
            results["end_point_result"] = {
                "error": f"End point ({end_point.x}, {end_point.y}) does not intersect with {table_name}"
            }
        
        return results