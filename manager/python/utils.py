from contextlib import contextmanager
from tempfile import gettempdir

import re
import time
import dramatiq_pg
import dramatiq.results
import logging
import os
import psycopg2.pool

from dotenv import load_dotenv
from minio import Minio
from osgeo import gdal
from urllib.parse import urlparse

load_dotenv()

logger = logging.getLogger(__name__)

DB_DSN = os.environ.get("DB_CONNECTION_STRING")

# Broker dramatiq-pg memegang koneksi LISTEN permanen (satu per queue, mis.
# "default" + "default.DQ") dan butuh koneksi tambahan untuk ack/nack/enqueue.
# Kalau pool-nya dishare dengan task, task yang jalan lama (FTTH bisa berjam-jam)
# menghabiskan kuota dan broker ikut mati -> "connection pool exhausted".
# Karena itu broker dan task pakai pool terpisah.
#
# Total maksimal ke Postgres per proses worker = BROKER_POOL_MAX + TASK_POOL_MAX.
# Dijaga di 10 (sebelumnya 8 untuk semuanya, dan itu terlalu mepet).
#   broker 8 = 2 koneksi LISTEN permanen ("default" + "default.DQ")
#              + 6 sisa untuk ack/nack/enqueue/simpan hasil
#   task   6 = pas untuk 2 thread worker (-t 2) di puncak pemakaian:
#              per task 1 koneksi utama + 1 seq_conn (fase insert)
#              + 1 koneksi status yang dipinjam sesaat
BROKER_POOL_MAX = int(os.environ.get("DB_BROKER_POOL_MAX", "8"))
TASK_POOL_MIN = int(os.environ.get("DB_POOL_MIN", "2"))
TASK_POOL_MAX = int(os.environ.get("DB_POOL_MAX", "6"))
# Saat pool penuh, tunggu koneksi bebas selama N detik sebelum menyerah.
TASK_POOL_WAIT = float(os.environ.get("DB_POOL_WAIT_TIMEOUT", "60"))


class TaskConnectionPool(psycopg2.pool.ThreadedConnectionPool):
    """Pool untuk task geoprocessing.

    Dua perbedaan dari ThreadedConnectionPool biasa:
    - ``putconn`` mereset ``autocommit`` supaya koneksi tidak kembali ke pool
      dalam mode autocommit dan merusak transaksi task berikutnya.
    - ``getconn`` menunggu sampai ``TASK_POOL_WAIT`` detik saat pool penuh,
      bukan langsung melempar PoolError.
    """

    def getconn(self, key=None):
        deadline = time.monotonic() + TASK_POOL_WAIT
        warned = False
        while True:
            try:
                return super().getconn(key)
            except psycopg2.pool.PoolError as err:
                if "exhausted" not in str(err) or time.monotonic() >= deadline:
                    raise
                if not warned:
                    warned = True
                    logger.warning(
                        "DB pool penuh (%s koneksi terpakai), menunggu koneksi "
                        "bebas maks %ss...",
                        self.maxconn,
                        TASK_POOL_WAIT,
                    )
                time.sleep(0.5)

    def putconn(self, conn=None, key=None, close=False):
        if conn is not None and not close and not conn.closed:
            try:
                if conn.autocommit:
                    conn.rollback()
                    conn.autocommit = False
            except Exception:
                logger.warning("Gagal mereset koneksi, ditutup saja", exc_info=True)
                close = True
        super().putconn(conn, key=key, close=close)


broker_pool = psycopg2.pool.ThreadedConnectionPool(1, BROKER_POOL_MAX, dsn=DB_DSN)
pool = TaskConnectionPool(TASK_POOL_MIN, TASK_POOL_MAX, dsn=DB_DSN)

dramatiq.set_broker(
    dramatiq_pg.PostgresBroker(
        pool=broker_pool, schema="public", table="geoprocessing_queue"
    )
)


@contextmanager
def db_conn(autocommit: bool = False):
    """Ambil koneksi dari pool dan pastikan selalu dikembalikan.

    Pakai ini untuk pekerjaan DB singkat (mis. update status) supaya koneksi
    tidak ditahan sepanjang task berjalan.
    """
    conn = pool.getconn()
    try:
        if autocommit:
            conn.autocommit = True
        yield conn
    finally:
        pool.putconn(conn)


urlparsed_s3_endpoint = urlparse(os.environ.get("STORAGE_S3_ENDPOINT", ""))
s3_endpoint = (
    urlparsed_s3_endpoint.netloc
    if urlparsed_s3_endpoint.scheme
    else urlparsed_s3_endpoint.path
)

minio_client = Minio(
    endpoint=s3_endpoint,
    access_key=os.environ.get("STORAGE_S3_KEY"),
    secret_key=os.environ.get("STORAGE_S3_SECRET"),
    region=os.environ.get("STORAGE_S3_REGION"),
    secure=False if urlparsed_s3_endpoint.scheme == "http" else True,
)


def init_gdal_config():
    logger.info("Initializing GDAL config")

    gdal.AllRegister()
    gdal.UseExceptions()
    gdal.SetConfigOption("AWS_ACCESS_KEY_ID", os.environ.get("STORAGE_S3_KEY"))
    gdal.SetConfigOption("AWS_SECRET_ACCESS_KEY", os.environ.get("STORAGE_S3_SECRET"))
    gdal.SetConfigOption("AWS_S3_ENDPOINT", s3_endpoint)
    gdal.SetConfigOption("AWS_REGION", os.environ.get("STORAGE_S3_REGION"))
    gdal.SetConfigOption(
        "AWS_HTTPS", "NO" if urlparsed_s3_endpoint.scheme == "http" else "YES"
    )
    gdal.SetConfigOption(
        "AWS_VIRTUAL_HOSTING", "TRUE" if s3_endpoint == "s3.amazonaws.com" else "FALSE"
    )
    gdal.SetConfigOption("PG_USE_COPY", "YES")


def is_dev_mode():
    dev_mode = os.getenv(
        "DEV_MODE", "false"
    )  # Default to 'false' if the environment variable is not set
    return dev_mode.lower() == "true"


def create_bbox_polygon(lon_min, lat_min, lon_max, lat_max):
    # Flip if the absolute latitude is greater than 90 or if lat > lon
    if (
        abs(lat_min) > 90
        or abs(lat_max) > 90
        or abs(lat_min) > abs(lon_min)
        or abs(lat_max) > abs(lon_max)
    ):
        lon_min, lat_min = lat_min, lon_min
        lon_max, lat_max = lat_max, lon_max

    # Define the polygon coordinates for the bounding box
    coordinates = [
        [
            [lon_min, lat_min],  # Bottom left
            [lon_min, lat_max],  # Top left
            [lon_max, lat_max],  # Top right
            [lon_max, lat_min],  # Bottom right
            [lon_min, lat_min],  # Closing the loop
        ]
    ]

    # Create a GeoJSON Polygon
    return {"type": "Polygon", "coordinates": coordinates}


def generate_local_temp_dir_path(object_key: str):
    return os.path.join(gettempdir(), f"geodashboard_geoprocessing_{object_key}")


def generate_vrt_path(object_key: str):
    return f"/vsimem/{object_key}.vrt"


# List of PostgreSQL reserved keywords (you can expand this list as needed)
POSTGRES_RESERVED_KEYWORDS = {
    "select",
    "table",
    "user",
    "group",
    "insert",
    "update",
    "delete",
    "from",
    "where",
    "join",
    "order",
    "by",
    "limit",
}


def sanitize_table_name(table_name: str) -> str:
    # Convert to lowercase to match PostgreSQL default behavior
    table_name = table_name.lower()

    # Replace any restricted characters with underscores
    table_name = re.sub(r"[^a-zA-Z0-9_]", "_", table_name)

    # Replace multiple underscores with a single underscore
    table_name = re.sub(r"_+", "_", table_name)

    # Ensure the name starts with a letter or underscore, not a number
    if not re.match(r"^[a-zA-Z_]", table_name):
        table_name = f"_{table_name}"

    # Truncate to 63 characters (PostgreSQL identifier limit)
    table_name = table_name[:63]

    # Check if the table name is a reserved keyword, and add a prefix if it is
    if table_name in POSTGRES_RESERVED_KEYWORDS:
        table_name = f"tbl_{table_name}"

    return table_name
