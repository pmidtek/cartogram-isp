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
    """Rebuild network from table_name, creating table_name + '_edges' instead of fixed names"""

    # Parse DB connection string from .env
    db_url = os.getenv("DB_CONNECTION_STRING")
    if not db_url:
        print("❌ DB_CONNECTION_STRING not found in environment")
        return {"success": False, "error": "DB_CONNECTION_STRING not found"}

    parsed = urlparse(db_url)

    try:
        conn = psycopg2.connect(
            host=parsed.hostname,
            port=parsed.port or 5432,
            database=parsed.path[1:],  # Remove leading '/'
            user=parsed.username,
            password=parsed.password,
        )
        cur = conn.cursor()

        edges_table_name = f"{table_name}_edges"

        # Check if edges table already exists
        if check_table_exists(cur, edges_table_name):
            print(f"✅ Data already exists: {edges_table_name} table found")
            cur.close()
            conn.close()
            return {"success": True, "existed": True}

        print(f"🔄 Building routing network from table: {table_name}")

        # 1️⃣ Create a noded version of the table
        cur.execute(
            f"""
            DROP TABLE IF EXISTS {table_name}_noded CASCADE;
            CREATE TABLE {table_name}_noded AS
            SELECT (ST_Dump(ST_Node(geom))).geom::geometry(LineString, 4326) AS geom
            FROM {table_name};
        """
        )
        print("✅ Created noded table")

        # 2️⃣ Create shaft_nodes (unique endpoints)
        cur.execute(
            f"""
            DROP TABLE IF EXISTS shaft_nodes CASCADE;
            CREATE TABLE shaft_nodes AS
            SELECT row_number() OVER () AS id, geom
            FROM (
                SELECT DISTINCT ST_StartPoint(geom) AS geom FROM {table_name}_noded
                UNION
                SELECT DISTINCT ST_EndPoint(geom) AS geom FROM {table_name}_noded
            ) pts;
        """
        )
        print("✅ Created shaft_nodes table")

        # 3️⃣ Create {table_name}_edges (link shaft IDs)
        cur.execute(
            f"""
            DROP TABLE IF EXISTS {edges_table_name} CASCADE;
            CREATE TABLE {edges_table_name} AS
            SELECT 
                row_number() OVER () AS ogc_fid,
                s1.id AS shaft_1,
                s2.id AS shaft_2,
                n.geom
            FROM {table_name}_noded n
            JOIN shaft_nodes s1 ON ST_Equals(ST_StartPoint(n.geom), s1.geom)
            JOIN shaft_nodes s2 ON ST_Equals(ST_EndPoint(n.geom), s2.geom);
        """
        )
        print(f"✅ Created {edges_table_name} table")

        # 4️⃣ Add cost and reverse_cost
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
        return {"success": True, "existed": False}

    except Exception as e:
        print(f"❌ Error rebuilding network: {e}")
        return {"success": False, "error": str(e)}
