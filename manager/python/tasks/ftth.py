import traceback
import os
from dotenv import load_dotenv
from urllib.parse import urlparse

import dramatiq
from dramatiq.middleware import TimeLimitExceeded
from psycopg2 import sql

from ftth.ftthAnalysis import FTTHAnalyzer
from ftth.geoCalculator import Point
from ftth.dataPreparation import rebuild_network
from ftth.virtualShaft import VirtualShaftManager

from utils import (
    logger,
    pool,
    is_dev_mode,
)

# Load environment variables1
load_dotenv()


@dramatiq.actor(store_results=True, time_limit=1800000)
def ftth(
    startpoint: str,
    endpoint: str,
    tablename: str,
    fiber_attenuation_db_per_km: float = 0.25,
    splice_loss_db: float = 0.15,
    splice_every_km: float = 1.0,
    connector_loss_db: float = 0.40,
    connectors_entry: int = 3,
    connectors_exit: int = 3,
    fixed_loss_db: float = 0.0,
    splitter_level1_loss_db: float = 0.0,
    splitter_level1_count: int = 0,
    splitter_level2_loss_db: float = 0.0,
    splitter_level2_count: int = 0,
    splitter_level3_loss_db: float = 0.0,
    splitter_level3_count: int = 0,
):
    """Combined FTTH analysis with automatic network creation if needed"""
    conn = None
    try:
        conn = pool.getconn()
        with conn:
            with conn.cursor() as cur:
                # Parse startpoint and endpoint
                try:
                    x1, y1 = map(float, startpoint.split(","))
                    x2, y2 = map(float, endpoint.split(","))
                except ValueError:
                    return {
                        "error": "Invalid format. Use 'x,y' for startpoint and endpoint."
                    }

                # Check if base table exists
                cur.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_name = %s
                    );
                """, (tablename,))
                
                base_table_exists = cur.fetchone()[0]
                
                if not base_table_exists:
                    return {
                        "error": "The table has not been added, we cant find it"
                    }

                # Check if edges table exists
                edges_table_name = f"{tablename}_edges"
                cur.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_name = %s
                    );
                """, (edges_table_name,))
                
                edges_table_exists = cur.fetchone()[0]

                # If edges table doesn't exist, create the FTTH network
                if not edges_table_exists:
                    network_result = rebuild_network(tablename)
                    if not network_result["success"]:
                        return {
                            "error": f"Failed to create network: {network_result.get('error', 'Unknown error')}"
                        }

                # Get database configuration for FTTH analyzer
                db_url = os.getenv("DB_CONNECTION_STRING")
                if not db_url:
                    return {"error": "DB_CONNECTION_STRING not found in environment"}

                parsed = urlparse(db_url)
                db_config = {
                    "host": parsed.hostname,
                    "port": str(parsed.port) if parsed.port else "5432",
                    "database": parsed.path[1:],  # Remove leading '/'
                    "user": parsed.username,
                    "password": parsed.password,
                }

                # Check for virtual shaft creation opportunity
                virtual_shaft_manager = VirtualShaftManager()
                start_point = Point(x1, y1)
                end_point = Point(x2, y2)
                
                # Check if points intersect with the base table edges  
                start_intersects = virtual_shaft_manager.check_point_intersects_linestring(start_point, tablename)
                end_intersects = virtual_shaft_manager.check_point_intersects_linestring(end_point, tablename)
                
                virtual_shaft_info = {
                    "start_virtual_shaft_id": None,
                    "end_virtual_shaft_id": None,
                    "virtual_shafts_created": False
                }
                
                # Create virtual shafts only if they intersect
                if start_intersects:
                    start_virtual_result = virtual_shaft_manager.create_virtual_shaft_on_intersection(start_point, tablename)
                    if start_virtual_result.get("success"):
                        virtual_shaft_info["start_virtual_shaft_id"] = start_virtual_result["virtual_shaft_id"]
                        virtual_shaft_info["virtual_shafts_created"] = True
                
                if end_intersects:
                    end_virtual_result = virtual_shaft_manager.create_virtual_shaft_on_intersection(end_point, tablename)
                    if end_virtual_result.get("success"):
                        virtual_shaft_info["end_virtual_shaft_id"] = end_virtual_result["virtual_shaft_id"]
                        virtual_shaft_info["virtual_shafts_created"] = True

                # Log the database configuration being used
                logger.info(f"Database config: host={db_config['host']}, database={db_config['database']}")
                logger.info(f"Using edges table: {edges_table_name}")
                logger.info(f"Analysis points: start=({x1}, {y1}), end=({x2}, {y2})")

                # Now perform FTTH analysis with dynamic table name
                analyzer = FTTHAnalyzer(
                    db_config,
                    conn,  # Use the pool connection
                    {
                        "shafts": "shaft_nodes",
                        "edges": edges_table_name,
                    },
                )

                logger.info("Starting FTTH shortest path analysis...")
                result = analyzer.get_shortest_path_analysis(
                    Point(x1, y1), 
                    Point(x2, y2),
                    fiber_attenuation_db_per_km=fiber_attenuation_db_per_km,
                    splice_loss_db=splice_loss_db,
                    splice_every_km=splice_every_km,
                    connector_loss_db=connector_loss_db,
                    connectors_entry=connectors_entry,
                    connectors_exit=connectors_exit,
                    fixed_loss_db=fixed_loss_db,
                    splitter_level1_loss_db=splitter_level1_loss_db,
                    splitter_level1_count=splitter_level1_count,
                    splitter_level2_loss_db=splitter_level2_loss_db,
                    splitter_level2_count=splitter_level2_count,
                    splitter_level3_loss_db=splitter_level3_loss_db,
                    splitter_level3_count=splitter_level3_count,
                    virtual_shaft_info=virtual_shaft_info
                )
                logger.info(f"FTTH analysis result: {result}")

                if "error" in result:
                    logger.error(f"FTTH analysis failed: {result}")
                    return result

                response_data = {
                    "success": result.get("success", False),
                    "summary": result.get("summary", {}),
                    "network_created": not edges_table_exists,
                    "edges_table": edges_table_name,
                }
                
                # Add virtual shaft information if any were created
                if virtual_shaft_info["virtual_shafts_created"]:
                    response_data["virtual_shafts"] = {
                        "start_virtual_shaft_id": virtual_shaft_info.get("start_virtual_shaft_id"),
                        "end_virtual_shaft_id": virtual_shaft_info.get("end_virtual_shaft_id"),
                        "virtual_shafts_used": True
                    }
                
                logger.info("FTTH analysis completed successfully")
                logger.info(f"Final response data: {response_data}")
                return response_data

    except Exception as err:
        error_traceback = traceback.format_exc()
        if isinstance(err, TimeLimitExceeded):
            error_message = "Time limit exceeded. File might be too big to process."
        else:
            error_message = str(err)
            logger.error(error_traceback)
        return {"error": error_message, "traceback": error_traceback}
    finally:
        if conn:
            pool.putconn(conn)