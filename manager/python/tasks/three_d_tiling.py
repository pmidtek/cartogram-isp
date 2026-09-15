from uuid import uuid4
import os
import shutil
import traceback

from dramatiq.middleware import TimeLimitExceeded
from minio.deleteobjects import DeleteObject
from py3dtiles.convert import convert as convert_to_3d_tiles
from pyproj import CRS
import dramatiq.results


# from lib.raster_tiling import delete_generated_tiles
from lib.register_table import register_3d_tile
from utils import (
    generate_local_temp_dir_path,
    init_gdal_config,
    logger,
    minio_client,
    pool,
)


def delete_generated_3d_tiles(bucket: str, layer_id: str):
    storage_root = (
        os.environ.get("STORAGE_S3_ROOT", "") + "/"
        if os.environ.get("STORAGE_S3_ROOT")
        else ""
    )
    delete_object_list = map(
        lambda x: DeleteObject(x.object_name),
        minio_client.list_objects(
            bucket, f"{storage_root}3d-tiles/{layer_id}/", recursive=True
        ),
    )
    errors = minio_client.remove_objects(bucket, delete_object_list)
    return errors


def upload_3d_tiles(bucket: str, layer_id: str, tiles_dir_path: str):
    storage_root = (
        os.environ.get("STORAGE_S3_ROOT", "") + "/"
        if os.environ.get("STORAGE_S3_ROOT")
        else ""
    )
    files = os.walk(tiles_dir_path)
    for dirpath, _, filenames in files:
        prefix = f"{storage_root}3d-tiles/{layer_id}{dirpath[len(tiles_dir_path):]}/"
        for filename in filenames:
            current_file = os.path.join(dirpath, filename)
            minio_client.fput_object(bucket, f"{prefix}{filename}", current_file)


@dramatiq.actor(store_results=True, time_limit=3600000)
def three_d_tiling(
    object_key: str,
    uploader: str,
    three_d_alias: str,
    has_color: bool,
    additional_config: dict | None,
    **kwargs,
):
    conn = None
    try:
        init_gdal_config()
        bucket = os.environ.get("STORAGE_S3_BUCKET")
        if not bucket:
            raise Exception("S3 bucket not configured")
        storage_root = (
            os.environ.get("STORAGE_S3_ROOT", "") + "/"
            if os.environ.get("STORAGE_S3_ROOT")
            else ""
        )
        temp_dir_path = generate_local_temp_dir_path(object_key)
        temp_file_path = os.path.join(temp_dir_path, object_key)
        layer_id = ""

        minio_client.fget_object(bucket, storage_root + object_key, temp_file_path)

        temp_tiles_dir_path = os.path.join(temp_dir_path, "3dtiles/")
        convert_to_3d_tiles(
            temp_file_path,
            outfolder=temp_tiles_dir_path,
            crs_out=CRS.from_epsg(4978),
            rgb=has_color,
        )

        layer_id = str(uuid4())
        upload_3d_tiles(bucket, layer_id, temp_tiles_dir_path)

        conn = pool.getconn()
        register_3d_tile(conn, layer_id, three_d_alias, uploader, additional_config)

        return {"layer_id": layer_id}
    except Exception as err:
        del_errs = []
        if layer_id and bucket:
            del_err_generator = delete_generated_3d_tiles(bucket, layer_id)
            for del_err in del_err_generator:
                del_errs.append(del_err)

        error_traceback = traceback.format_exc()
        if isinstance(err, TimeLimitExceeded):
            error_message = "Time limit exceeded. File might be too big to process."
        else:
            error_message = str(err)
            logger.error(error_traceback)

        if len(del_errs):
            error_message += f" Error deleting half generated tiles. Please delete manually via S3 console: {str(del_errs)}"

        return {"error": error_message, "traceback": error_traceback}
    finally:
        # cleanup
        if conn:
            pool.putconn(conn)
        if os.path.isdir(temp_dir_path):
            shutil.rmtree(temp_dir_path)
