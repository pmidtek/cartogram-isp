import os
import traceback

import dramatiq.results
from dramatiq.middleware import TimeLimitExceeded
from osgeo import gdal

from utils import init_gdal_config, logger


@dramatiq.actor(store_results=True)
def convert(input_file: str, output_file: str, **kwargs):
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

        # Open the source dataset
        src_ds = gdal.OpenEx(
            f"/vsis3/{bucket}/{storage_root}{input_file}",
            gdal.GA_ReadOnly,
        )

        # COG creation options
        creation_options = [
            "TILED=YES",
            "COMPRESS=DEFLATE",
            "BIGTIFF=IF_SAFER",
            "COPY_SRC_OVERVIEWS=YES",
            "BLOCKXSIZE=512",
            "BLOCKYSIZE=512",
        ]

        # Convert to COG
        gdal.Translate(
            f"/vsis3/{bucket}/{storage_root}{output_file}",
            src_ds,
            format="GTiff",
            creationOptions=creation_options,
        )

        # Close the dataset
        src_ds = None
    except Exception as err:
        error_traceback = traceback.format_exc()
        if isinstance(err, TimeLimitExceeded):
            error_message = "Time limit exceeded. File might be too big to process."
        else:
            error_message = str(err)
            logger.error(error_traceback)
        return {"error": error_message, "traceback": error_traceback}
