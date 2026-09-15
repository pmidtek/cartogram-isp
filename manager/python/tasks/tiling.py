import os
import shutil
import traceback

from dramatiq.middleware import TimeLimitExceeded
import dramatiq.results

from lib.raster_tiling import delete_generated_tiles, raster_tiling
from lib.register_table import (
    register_raster_tile,
)
from lib.dem_to_terrain_rgb import dem_to_terrain_rgb
from utils import generate_local_temp_dir_path, pool, logger, init_gdal_config


@dramatiq.actor(store_results=True)
def tiling(
    object_key: str,
    uploader: str,
    raster_alias: str,
    minzoom: int | None,
    maxzoom: int | None,
    is_terrain: bool,
    additional_config: dict | None,
    **kwargs,
):
    conn = None
    try:
        init_gdal_config()
        bucket = os.environ.get("STORAGE_S3_BUCKET")
        if not bucket:
            raise Exception("S3 bucket not configured")
        layer_id = ""
        if is_terrain:
            terrain_rgb_path = dem_to_terrain_rgb(bucket, object_key)
            (layer_id, xmin, ymin, xmax, ymax, minzoom, maxzoom) = raster_tiling(
                bucket, minzoom, maxzoom, file_path=terrain_rgb_path
            )
        else:
            (layer_id, xmin, ymin, xmax, ymax, minzoom, maxzoom) = raster_tiling(
                bucket, minzoom, maxzoom, object_key
            )
        conn = pool.getconn()
        register_raster_tile(
            conn,
            layer_id,
            raster_alias,
            xmin,
            ymin,
            xmax,
            ymax,
            minzoom,
            maxzoom,
            uploader,
            is_terrain,
            additional_config,
        )
        return {
            "layer_id": layer_id,
            "lon_min": xmin,
            "lat_min": ymin,
            "lon_max": xmax,
            "lat_max": ymax,
            "z_min": minzoom,
            "z_max": maxzoom,
        }
    except Exception as err:
        del_errs = []
        if layer_id and bucket:
            del_err_generator = delete_generated_tiles(bucket, layer_id)
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
        temp_dir_path = generate_local_temp_dir_path(object_key)
        if os.path.isdir(temp_dir_path):
            shutil.rmtree(temp_dir_path)
