import psycopg2
import os
from dotenv import load_dotenv
from urllib.parse import urlparse

load_dotenv()


def check_table_exists(cur, table_name):
    """Check if a table exists in the database"""
    cur.execute(
        """
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = %s
        );
    """,
        (table_name,),
    )
    return cur.fetchone()[0]


def rebuild_network(table_name):
    """Rebuild network from table_name using proper explode, snap, noding, shafts, and edges."""

    # Parse DB connection string from .env
    db_url = os.getenv("DB_CONNECTION_STRING")
    if not db_url:
        print("❌ DB_CONNECTION_STRING not found in environment")
        return {"success": False, "error": "DB_CONNECTION_STRING not found"}

    parsed = urlparse(db_url)

    try:
        print("rebuild network is starting 123")
        conn = psycopg2.connect(
            host=parsed.hostname,
            port=parsed.port or 5432,
            database=parsed.path[1:],  # Remove leading '/'
            user=parsed.username,
            password=parsed.password,
        )
        cur = conn.cursor()

        edges_table_name = f"{table_name}_edges"

        # Clean old tables
        cur.execute(
            f"""
            DROP TABLE IF EXISTS {table_name}_exploded CASCADE;
            DROP TABLE IF EXISTS {table_name}_exploded_snap CASCADE;
            DROP TABLE IF EXISTS {table_name}_noded CASCADE;
            DROP TABLE IF EXISTS shaft_nodes CASCADE;
            DROP TABLE IF EXISTS {edges_table_name} CASCADE;
        """
        )

        # 1️⃣ Explode & transform
        cur.execute(
            f"""
            CREATE TABLE {table_name}_exploded AS
            SELECT (ST_Dump(ST_Transform(geom, 32750))).geom::geometry(LineString,32750) AS geom
            FROM {table_name};
        """
        )
        print("✅ Exploded and transformed")

        # 2️⃣ Snap to grid
        cur.execute(
            f"""
            CREATE TABLE {table_name}_exploded_snap AS
            SELECT ST_SnapToGrid(geom, 0.01)::geometry(LineString,32750) AS geom
            FROM {table_name}_exploded;
        """
        )
        print("✅ Snapped to grid")

        # 3️⃣ Node intersections
        cur.execute(
            f"""
            CREATE TABLE {table_name}_noded AS
            SELECT (ST_Dump(ST_Node(ST_Collect(geom)))).geom::geometry(LineString,32750) AS geom
            FROM {table_name}_exploded_snap;
        """
        )
        print("✅ Noded at intersections")

        # 4️⃣ Remove slivers < 0.2m
        cur.execute(
            f"""
            DELETE FROM {table_name}_noded WHERE ST_Length(geom) < 0.2;
        """
        )
        print("✅ Removed slivers")

        # 5️⃣ Shaft nodes from endpoints
        cur.execute(
            f"""
            CREATE TABLE shaft_nodes AS
            SELECT row_number() OVER () AS id,
                   ST_Transform(pt, 4326)::geometry(Point,4326) AS geom
            FROM (
              SELECT DISTINCT ST_StartPoint(geom) AS pt FROM {table_name}_noded
              UNION
              SELECT DISTINCT ST_EndPoint(geom)   AS pt FROM {table_name}_noded
            ) endpoints;
        """
        )
        print("✅ Created shaft_nodes")

        # XY view for debug
        cur.execute(
            f"""
            CREATE OR REPLACE VIEW shaft_nodes_xy AS
            SELECT id, ST_X(geom) AS x, ST_Y(geom) AS y, geom
            FROM shaft_nodes;
        """
        )
        print("✅ Created shaft_nodes_xy view")

        # 6️⃣ Edges between shafts
        cur.execute(
            f"""
            CREATE TABLE {edges_table_name} AS
            WITH e AS (
              SELECT row_number() OVER () AS ogc_fid, geom
              FROM {table_name}_noded
            )
            SELECT
              e.ogc_fid,
              s1.id AS shaft_1,
              s2.id AS shaft_2,
              ST_Length(e.geom) AS length_m,
              ST_Transform(e.geom, 4326)::geometry(LineString,4326) AS geom
            FROM e
            JOIN shaft_nodes s1 ON ST_Equals(ST_Transform(ST_StartPoint(e.geom),4326), s1.geom)
            JOIN shaft_nodes s2 ON ST_Equals(ST_Transform(ST_EndPoint  (e.geom),4326), s2.geom)
            WHERE s1.id <> s2.id;
        """
        )
        print("✅ Created edges table")

        # 7️⃣ Add cost and reverse_cost
        cur.execute(
            f"""
            ALTER TABLE {edges_table_name} 
            ADD COLUMN cost double precision,
            ADD COLUMN reverse_cost double precision;

            UPDATE {edges_table_name}
            SET cost = ST_Length(geom::geography),
                reverse_cost = ST_Length(geom::geography);
        """
        )
        print("✅ Added cost & reverse_cost")

        conn.commit()
        cur.close()
        conn.close()
        print("🎯 Network rebuild complete!")
        return {"success": True}

    except Exception as e:
        print(f"❌ Error rebuilding network: {e}")
        return {"success": False, "error": str(e)}
