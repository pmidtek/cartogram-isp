from fastapi import FastAPI, Query
from osgeo import ogr
from graph import Graph
from ftthAnalysis import FTTHAnalyzer
from geoCalculator import Point
from fastapi.responses import JSONResponse
from database import DatabaseManager
from dataPreparation import rebuild_network
from virtualShaft import VirtualShaftManager
import os
from dotenv import load_dotenv
from urllib.parse import urlparse
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

app = FastAPI()

# Allow local dev + production frontend
origins = [
    "http://localhost:3000",  # your local Nuxt dev
    "http://127.0.0.1:3000",
    "https://footprint.geodashboard.io",  # if you serve frontend here later
    "https://surge.geodashboard.io",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # or ["*"] for all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def main():
    return {"status": "ok!", "message": "fast api is ready to use! 123"}


@app.get("/check-gdal/")
def check_gdal():
    try:
        return {"status": "GDAL is working!", "version": ogr.GetDriverCount()}
    except Exception as e:
        return {"error": str(e)}


@app.get("/testftth/")
def test_ftth_analysis(
    startpoint: str = Query(..., description="Start point in 'x,y' format"),
    endpoint: str = Query(..., description="End point in 'x,y' format"),
    tablename: str = Query(..., description="Base table name for network creation"),
    fiber_attenuation_db_per_km: float = Query(
        0.25, description="Fiber attenuation in dB per km"
    ),
    splice_loss_db: float = Query(0.15, description="Splice loss in dB"),
    splice_every_km: float = Query(1.0, description="Splice interval in km"),
    connector_loss_db: float = Query(0.40, description="Connector loss in dB"),
    connectors_entry: int = Query(3, description="Number of entry connectors"),
    connectors_exit: int = Query(3, description="Number of exit connectors"),
    fixed_loss_db: float = Query(0.0, description="Fixed loss in dB"),
    splitter_level1_loss_db: float = Query(
        0.0, description="Level 1 splitter loss in dB"
    ),
    splitter_level1_count: int = Query(0, description="Number of level 1 splitters"),
    splitter_level2_loss_db: float = Query(
        0.0, description="Level 2 splitter loss in dB"
    ),
    splitter_level2_count: int = Query(0, description="Number of level 2 splitters"),
    splitter_level3_loss_db: float = Query(
        0.0, description="Level 3 splitter loss in dB"
    ),
    splitter_level3_count: int = Query(0, description="Number of level 3 splitters"),
):
    """Combined FTTH analysis with automatic network creation if needed"""
    try:
        x1, y1 = map(float, startpoint.split(","))
        x2, y2 = map(float, endpoint.split(","))
    except ValueError:
        return JSONResponse(
            content={"error": "Invalid format. Use 'x,y' for startpoint and endpoint."},
            status_code=400,
        )

    # Parse DB connection string from .env
    db_url = os.getenv("DB_CONNECTION_STRING")
    if not db_url:
        return JSONResponse(
            content={"error": "DB_CONNECTION_STRING not found in environment"},
            status_code=500,
        )

    parsed = urlparse(db_url)
    db_config = {
        "host": parsed.hostname,
        "port": str(parsed.port) if parsed.port else "5432",
        "database": parsed.path[1:],  # Remove leading '/'
        "user": parsed.username,
        "password": parsed.password,
    }

    try:
        db_manager = DatabaseManager(db_config)
        if not db_manager.connect():
            return JSONResponse(
                content={"error": "Failed to connect to database"}, status_code=500
            )

        # Check if base table exists
        connection = db_manager.get_connection()
        cursor = connection.cursor()

        cursor.execute(
            """
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = %s
            );
        """,
            (tablename,),
        )

        base_table_exists = cursor.fetchone()[0]

        if not base_table_exists:
            cursor.close()
            db_manager.close()
            return JSONResponse(
                content={"error": "The table has not been added, we cant find it"},
                status_code=404,
            )

        # Check if edges table exists
        edges_table_name = f"{tablename}_edges"
        cursor.execute(
            """
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = %s
            );
        """,
            (edges_table_name,),
        )

        edges_table_exists = cursor.fetchone()[0]
        cursor.close()

        # If edges table doesn't exist, create the FTTH network
        if not edges_table_exists:
            network_result = rebuild_network(tablename)
            if not network_result["success"]:
                db_manager.close()
                return JSONResponse(
                    content={
                        "error": f"Failed to create network: {network_result.get('error', 'Unknown error')}"
                    },
                    status_code=500,
                )

        # Check for virtual shaft creation opportunity
        virtual_shaft_manager = VirtualShaftManager()
        start_point = Point(x1, y1)
        end_point = Point(x2, y2)

        # Check if points intersect with the base table edges
        start_intersects = virtual_shaft_manager.check_point_intersects_linestring(
            start_point, tablename
        )
        end_intersects = virtual_shaft_manager.check_point_intersects_linestring(
            end_point, tablename
        )

        virtual_shaft_info = {
            "start_virtual_shaft_id": None,
            "end_virtual_shaft_id": None,
            "virtual_shafts_created": False,
        }

        # Create virtual shafts only if they intersect
        if start_intersects:
            start_virtual_result = (
                virtual_shaft_manager.create_virtual_shaft_on_intersection(
                    start_point, tablename
                )
            )
            if start_virtual_result.get("success"):
                virtual_shaft_info["start_virtual_shaft_id"] = start_virtual_result[
                    "virtual_shaft_id"
                ]
                virtual_shaft_info["virtual_shafts_created"] = True

        if end_intersects:
            end_virtual_result = (
                virtual_shaft_manager.create_virtual_shaft_on_intersection(
                    end_point, tablename
                )
            )
            if end_virtual_result.get("success"):
                virtual_shaft_info["end_virtual_shaft_id"] = end_virtual_result[
                    "virtual_shaft_id"
                ]
                virtual_shaft_info["virtual_shafts_created"] = True

        # Now perform FTTH analysis with dynamic table name
        analyzer = FTTHAnalyzer(
            db_config,
            db_manager.get_connection(),
            {
                "shafts": "shaft_nodes",
                "edges": edges_table_name,
            },
        )

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
            virtual_shaft_info=virtual_shaft_info,
        )
        db_manager.close()

        if "error" in result:
            return JSONResponse(content=result, status_code=500)

        response_data = {
            "success": result.get("success", False),
            "summary": result.get("summary", {}),
            "network_created": not edges_table_exists,
            "edges_table": edges_table_name,
        }

        # Add virtual shaft information if any were created
        if virtual_shaft_info["virtual_shafts_created"]:
            response_data["virtual_shafts"] = {
                "start_virtual_shaft_id": virtual_shaft_info.get(
                    "start_virtual_shaft_id"
                ),
                "end_virtual_shaft_id": virtual_shaft_info.get("end_virtual_shaft_id"),
                "virtual_shafts_used": True,
            }

        return response_data
    except Exception as e:
        return JSONResponse(
            content={"error": f"FTTH analysis failed: {e}"}, status_code=500
        )
