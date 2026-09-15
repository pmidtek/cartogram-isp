import os

import numpy as np
from osgeo import gdal, osr

from utils import generate_local_temp_dir_path


def gdt_to_numpy_type(gdt: gdal.GDT_Unknown):
    match gdt:
        case gdal.GDT_Byte:
            return np.byte
        case gdal.GDT_Int8:
            return np.ubyte
        case gdal.GDT_UInt16:
            return np.uint16
        case gdal.GDT_Int16:
            return np.int16
        case gdal.GDT_UInt32:
            return np.uint32
        case gdal.GDT_Int32:
            return np.int32
        case gdal.GDT_UInt64:
            return np.uint64
        case gdal.GDT_Int64:
            return np.int64
        case gdal.GDT_Float32:
            return np.float32
        case gdal.GDT_Float64:
            return np.float64
        case _:
            raise Exception(
                "Unsupported data. Raster must be 8/16/32/64 bit integer or 32/64 bit float"
            )


def dem_to_terrain_rgb(bucket: str, object_key: str):
    storage_root = (
        os.environ.get("STORAGE_S3_ROOT", "") + "/"
        if os.environ.get("STORAGE_S3_ROOT")
        else ""
    )
    input_file = f"/vsis3/{bucket}/{storage_root}{object_key}"
    input_dataset: gdal.Dataset = gdal.Open(input_file)
    input_srs: osr.SpatialReference = input_dataset.GetSpatialRef()

    if input_srs is None:
        raise Exception("Raster doesn't have spatial reference system")

    if input_dataset.RasterCount != 1:
        raise Exception("Raster must have single band")

    input_band: gdal.Band = input_dataset.GetRasterBand(1)
    min_value: float
    max_value: float
    (min_value, max_value) = input_band.ComputeRasterMinMax()

    nodata_value: float
    if input_band.DataType == gdal.GDT_Int64:
        nodata_value = input_band.GetNoDataValueAsInt64()
    elif input_band.DataType == gdal.GDT_UInt64:
        nodata_value = input_band.GetNoDataValueAsUInt64()
    else:
        nodata_value = input_band.GetNoDataValue()

    if nodata_value is not None:
        if nodata_value < min_value:
            min_value = nodata_value
        elif nodata_value > max_value:
            max_value = nodata_value

    if max_value - min_value > 256**3:
        raise Exception(
            "Unsupported data. Data range (including NODATA value) must not exceeds 16777216"
        )

    output_dir = generate_local_temp_dir_path(object_key)
    os.mkdir(output_dir)
    output_path = os.path.join(output_dir, object_key)

    driver: gdal.Driver = gdal.GetDriverByName("GTiff")
    output_dataset: gdal.Dataset = driver.Create(
        output_path, input_dataset.RasterXSize, input_dataset.RasterYSize, 3
    )
    output_dataset.SetSpatialRef(input_srs)
    output_dataset.SetGeoTransform(input_dataset.GetGeoTransform())
    r_band: gdal.Band = output_dataset.GetRasterBand(1)
    g_band: gdal.Band = output_dataset.GetRasterBand(2)
    b_band: gdal.Band = output_dataset.GetRasterBand(3)

    # use scanline to minimize memory usage
    for line_offset in range(input_dataset.RasterYSize):
        input_data = np.ndarray(
            (input_dataset.RasterXSize, 1),
            gdt_to_numpy_type(input_band.DataType),
            input_band.ReadRaster(0, line_offset, None, 1),
        )

        input_data = (input_data + 10000) / 0.1
        r = (
            (((input_data // 256) // 256) / 256) - (((input_data // 256) // 256) // 256)
        ) * 256
        g = (((input_data // 256) / 256) - ((input_data // 256) // 256)) * 256
        b = ((input_data / 256) - (input_data // 256)) * 256

        r_band.WriteRaster(
            0,
            line_offset,
            input_dataset.RasterXSize,
            1,
            r.astype(np.byte).tobytes(),
        )
        g_band.WriteRaster(
            0,
            line_offset,
            input_dataset.RasterXSize,
            1,
            g.astype(np.byte).tobytes(),
        )
        b_band.WriteRaster(
            0,
            line_offset,
            input_dataset.RasterXSize,
            1,
            b.astype(np.byte).tobytes(),
        )

    return output_path
