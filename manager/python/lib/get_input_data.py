import os

from osgeo import ogr, gdal

from utils import minio_client, generate_local_temp_dir_path, generate_vrt_path


def get_input_data_with_vsi(
    bucket: str,
    object_key: str,
    is_zipped: bool,
    driver_short_name: str,
    open_opts: list[str] = [],
):
    storage_root = (
        os.environ.get("STORAGE_S3_ROOT", "") + "/"
        if os.environ.get("STORAGE_S3_ROOT")
        else ""
    )
    src_path = (
        f"/vsizip//vsis3/{bucket}/{storage_root}{object_key}"
        if is_zipped
        else f"/vsis3/{bucket}/{storage_root}{object_key}"
    )
    data_source: gdal.Dataset = gdal.OpenEx(
        src_path,
        gdal.GA_ReadOnly | gdal.OF_VECTOR,
        [driver_short_name],
        open_opts,
    )
    return data_source


def get_input_data_without_vsi_with_vrt(
    bucket: str,
    object_key: str,
    is_zipped: bool,
    driver_short_name: str,
    table_name: str,
):
    if is_zipped:
        raise Exception("Zipped file for this format is not supported yet")

    storage_root = (
        os.environ.get("STORAGE_S3_ROOT", "") + "/"
        if os.environ.get("STORAGE_S3_ROOT")
        else ""
    )
    temp_dir_path = generate_local_temp_dir_path(object_key)
    temp_file_path = os.path.join(temp_dir_path, object_key)

    # download data to temp directory
    minio_client.fget_object(bucket, storage_root + object_key, temp_file_path)

    # get layer name
    data_source: gdal.Dataset = gdal.OpenEx(
        temp_file_path,
        gdal.GA_ReadOnly | gdal.OF_VECTOR,
        [driver_short_name],
    )
    in_layer: ogr.Layer = data_source.GetLayerByIndex(0)
    in_layer_defn: ogr.FeatureDefn = in_layer.GetLayerDefn()
    layer_name: str = in_layer_defn.GetName()

    # close layer and dataset by making it out of scope
    del in_layer_defn
    del in_layer
    del data_source

    # create in memory VRT
    vrt_path = generate_vrt_path(object_key)
    gdal.FileFromMemBuffer(
        vrt_path,
        f"""<OGRVRTDataSource>
    <OGRVRTLayer name="{table_name}">
        <SrcDataSource>{temp_file_path}</SrcDataSource>
        <SrcLayer>{layer_name}</SrcLayer>
        <GeometryType>wkbPoint</GeometryType>
        <LayerSRS>WGS84</LayerSRS>
        <GeometryField encoding="PointFromColumns" x="lon" y="lat"/>
    </OGRVRTLayer>
</OGRVRTDataSource>\n""",
    )

    # open vrt
    data_source: gdal.Dataset = gdal.OpenEx(vrt_path, gdal.GA_ReadOnly, ["OGR_VRT"])
    return data_source


def get_input_data_with_vsi_with_vrt(
    bucket: str,
    object_key: str,
    is_zipped: bool,
    driver_short_name: str,
    table_name: str,
):
    # get layer name
    data_source: gdal.Dataset = get_input_data_with_vsi(
        bucket,
        object_key,
        is_zipped,
        driver_short_name,
    )
    in_layer: ogr.Layer = data_source.GetLayerByIndex(0)
    in_layer_defn: ogr.FeatureDefn = in_layer.GetLayerDefn()
    layer_name: str = in_layer_defn.GetName()

    # close layer and dataset by making it out of scope
    del in_layer_defn
    del in_layer
    del data_source

    # create in memory VRT
    storage_root = (
        os.environ.get("STORAGE_S3_ROOT", "") + "/"
        if os.environ.get("STORAGE_S3_ROOT")
        else ""
    )
    vrt_path = generate_vrt_path(object_key)
    src_path = (
        f"/vsizip//vsis3/{bucket}/{storage_root}{object_key}"
        if is_zipped
        else f"/vsis3/{bucket}/{storage_root}{object_key}"
    )
    gdal.FileFromMemBuffer(
        vrt_path,
        f"""<OGRVRTDataSource>
    <OGRVRTLayer name="{table_name}">
        <SrcDataSource>{src_path}</SrcDataSource>
        <SrcLayer>{layer_name}</SrcLayer>
        <GeometryType>wkbPoint</GeometryType>
        <LayerSRS>WGS84</LayerSRS>
        <GeometryField encoding="PointFromColumns" x="lon" y="lat"/>
    </OGRVRTLayer>
</OGRVRTDataSource>\n""",
    )

    # open vrt
    data_source: gdal.Dataset = gdal.OpenEx(vrt_path, gdal.GA_ReadOnly, ["OGR_VRT"])
    return data_source
