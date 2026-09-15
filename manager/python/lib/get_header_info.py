import os
from typing import TypedDict

from osgeo import ogr, gdal, osr

from lib.get_input_data import (
    get_input_data_with_vsi,
    get_input_data_without_vsi_with_vrt,
    get_input_data_with_vsi_with_vrt,
)
from utils import logger


class Fields(TypedDict):
    name: str
    type: str


class HeaderInfo(TypedDict):
    num_features: int
    projection: str
    srs_name: str
    srs_code: str
    fields: list[Fields]
    geom_name: str


def get_header_info_from_data_layer(
    layer: ogr.Layer, format_file: str | None = None
) -> HeaderInfo:
    geom_type: int = layer.GetGeomType()
    temp_geom = ogr.Geometry(geom_type or 3)
    geom_name = temp_geom.GetGeometryName()

    # if "Z" in str(temp_geom):
    #     geom_name = f"{geom_name}Z"

    srs: osr.SpatialReference = layer.GetSpatialRef()
    if srs:
        projection = srs.ExportToWkt()
        srs_name = srs.GetAuthorityName(None)
        srs_code = srs.GetAuthorityCode(None)
    else:
        projection = "null from data layer, set default to WGS 84"
        srs_name = "EPSG"
        srs_code = "4326"

    fields: list[Fields] = []
    defn: ogr.FeatureDefn = layer.GetLayerDefn()

    KML_SYSTEM_FIELDS = {
        "timestamp",
        "begin",
        "end",
        "altitudeMode",
        "tessellate",
        "extrude",
        "visibility",
        "drawOrder",
        "icon",
    }
    for n in range(defn.GetFieldCount()):
        field: ogr.FieldDefn = defn.GetFieldDefn(n)
        field_name = field.GetName()
        field_type = field.GetTypeName()

        if format_file and format_file.lower() == "kml":
            if field_name not in KML_SYSTEM_FIELDS:
                fields.append({"name": field_name, "type": field_type})
                logger.info(f"Detected field: {field_name} (type: {field_type})")
        else:
            fields.append({"name": field_name, "type": field_type})
            logger.info(f"Detected field: {field_name} (type: {field_type})")

    header_info: HeaderInfo = {
        "num_features": layer.GetFeatureCount(),
        "projection": projection,
        "srs_name": srs_name,
        "srs_code": srs_code,
        "fields": fields,
        "geom_name": geom_name,
    }
    logger.info("Get header info from data layer")
    return header_info


def get_driver_short_name(format_file: str):
    match format_file:
        case "shapefile":
            return "ESRI Shapefile"
        case "kml":
            return "KML"
        case "dxf":
            return "DXF"
        case "dwg":
            return "CAD"
        case "gpkg":
            return "GPKG"
        case _:
            raise Exception(f"Unexpected file format: {str}")


def get_gdb_directory(bucket: str, object_key: str):
    storage_root = (
        os.environ.get("STORAGE_S3_ROOT", "") + "/"
        if os.environ.get("STORAGE_S3_ROOT")
        else ""
    )
    src_path = f"/vsizip//vsis3/{bucket}/{storage_root}{object_key}"
    gdb_directory = gdal.ReadDir(src_path)

    return f"{object_key}/{gdb_directory[0]}"


def get_gdal_dataset(
    format_file: str, bucket: str, object_key: str, is_zipped: bool, table_name: str
):
    match format_file:
        case "xls":
            data_source = get_input_data_without_vsi_with_vrt(
                bucket, object_key, is_zipped, "XLS", table_name
            )

        case "xlsx":
            data_source = get_input_data_with_vsi_with_vrt(
                bucket, object_key, is_zipped, "XLSX", table_name
            )

        case "csv":
            data_source = get_input_data_with_vsi(
                bucket,
                object_key,
                is_zipped,
                "CSV",
                ["X_POSSIBLE_NAMES=lon", "Y_POSSIBLE_NAMES=lat"],
            )

        case "geojson":
            data_source = get_input_data_with_vsi(
                bucket,
                object_key,
                is_zipped,
                "GeoJSON",
                ["FLATTEN_NESTED_ATTRIBUTES=YES"],
            )

        case "gdb":
            object_key_gdb = get_gdb_directory(bucket, object_key)
            data_source = get_input_data_with_vsi(
                bucket, object_key_gdb, is_zipped, "OpenFileGDB"
            )

        case "kml":
            data_source = get_input_data_with_vsi(
                bucket, object_key, is_zipped, "LIBKML"
            )

        case _:
            data_source = get_input_data_with_vsi(
                bucket, object_key, is_zipped, get_driver_short_name(format_file)
            )

    return data_source
