import logging
import os
import pdb
import sys

import tasks
from utils import logger

# If run as simple python script
# Ex : python main.py Kesesuaian_KDB_RTR.zip kesesuaian_5


def main():
    # tasks.quick_market_insight(
    #     mode="default",
    #     user="837f5d39-4cf8-4b32-8852-6d0e02819bb2",
    #     geoprocessing_uuid="39fba9c0-05cb-448e-8b86-4b2428b0a36d",
    #     radius=300,
    #     area_city_ids=[37],
    #     file_id=None,
    #     priority=None,
    #     sector_count=3,
    #     analysis_name="BDG 50",
    # )

    # tasks.quick_market_insight(
    #     mode="upload",
    #     user="837f5d39-4cf8-4b32-8852-6d0e02819bb2",
    #     geoprocessing_uuid="642a0e81-4f63-4a80-a20d-e37de7704605",
    #     radius=500,
    #     area_city_ids=None,
    #     # file_id="de7dd165-496b-4c14-8d1e-cbe4c00eb2d8.csv",
    #     # file_id="2bc4110e-fa55-4a60-aefb-5cb9306d9fbd.csv",
    #     file_id="f8fac99e-61ec-4d76-866d-7bfc72b1f9a1.csv",
    #     priority=None,
    #     sector_count=3,
    #     analysis_name="Data Upload DB",
    # )

    # tasks.quick_market_insight_merge(
    #     user="837f5d39-4cf8-4b32-8852-6d0e02819bb2",
    #     geoprocessing_uuid="677b61a7-3658-47a2-91bb-724925d128d1",
    #     qmi_id=[44, 45, 46],
    #     analysis_name="Merge Bdg Cmh Upload",
    # )
    # tasks.route_insight(
    #     qmi_id=44,
    #     # qmi_id=64,
    #     user="837f5d39-4cf8-4b32-8852-6d0e02819bb2",
    #     geoprocessing_uuid="677b61a7-3658-47a2-91bb-724925d128d1",
    #     # analysis_name="RI 001 Cimahi",
    #     analysis_name="dev-bdg",
    # )
    # tasks.poi_quick_insight(
    #     user="837f5d39-4cf8-4b32-8852-6d0e02819bb2",
    #     geoprocessing_uuid="677b61a7-3658-47a2-91bb-724925d128d1",
    #     file_id="d55f4286-40f6-4f44-9f80-832275bad2d6.geojson",
    #     categories=["hospital", "school"],
    #     analysis_name="pqi_dev_001",
    # )
    # tasks.poi_route_insight(
    #     poi_insight_result_id=4,
    #     # qmi_id=64,
    #     user="837f5d39-4cf8-4b32-8852-6d0e02819bb2",
    #     geoprocessing_uuid="677b61a7-3658-47a2-91bb-724925d128d1",
    #     # analysis_name="RI 001 Cimahi",
    #     analysis_name="pri_dev002",
    # )
    tasks.generate_network(
        project_id=216,
        uploader="837f5d39-4cf8-4b32-8852-6d0e02819bb2",
        message_id="a7df5d93-3652-4143-a109-943a20c8559d",
        # dev_mode=False,
        olt_mode="input",
        coordinates=[[107.61429863, -6.94008652]],
    )
    # tasks.import_site_point(
    #     object_key="d2d9afbc-858c-4b0c-9f61-2a4829012073.xlsx",
    #     uploader="837f5d39-4cf8-4b32-8852-6d0e02819bb2",
    #     message_id="d162e79d-436b-41d6-b8e0-d7cadf6a747a",
    # )
    # tasks.export_asset(
    #     uploader="837f5d39-4cf8-4b32-8852-6d0e02819bb2",
    #     message_id="089b14cf-f5dd-4177-be48-b0175fc77efb",
    # )

    # tasks.quick_potential_insight(
    #     mode="default",
    #     user="837f5d39-4cf8-4b32-8852-6d0e02819bb2",
    #     geoprocessing_uuid="3b2dbfd6-d965-4798-8ea3-ba2107a16f2e",
    #     radius=300,
    #     area_city_ids=[41],
    #     # area_city_ids=[37],
    #     file_id=None,
    #     analysis_name="QPI_Test02",
    # )
    # tasks.antenna_direction(
    #     mode="upload",
    #     user="837f5d39-4cf8-4b32-8852-6d0e02819bb2",
    #     geoprocessing_uuid="3b2dbfd6-d965-4798-8ea3-ba2107a16f2e",
    #     radius=300,
    #     area_city_ids=[],
    #     file_id="9c6b1f20-b03b-40f9-a8b9-4a2aabc866a3.csv",
    #     analysis_name="AD_Test001",
    # )
    # tasks.antenna_direction(
    #     mode="default",
    #     user="837f5d39-4cf8-4b32-8852-6d0e02819bb2",
    #     geoprocessing_uuid="3b2dbfd6-d965-4798-8ea3-ba2107a16f2e",
    #     radius=300,
    #     area_city_ids=[41],
    #     # area_city_ids=[37],
    #     file_id=None,
    #     analysis_name="AD_Test001Cimahi",
    # )


# If run as dramatiq manager (dramatiq --verbose -p 1 -t 1 main)
if "__main__" == __name__:
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(levelname)1.1s: %(message)s",
    )

    try:
        exit(main())
    except (pdb.bdb.BdbQuit, KeyboardInterrupt):
        logger.info("Interrupted.")
    except Exception:
        logger.exception("Unhandled error:")
        if sys.stdout.isatty():
            logger.debug("Dropping in debugger.")
            pdb.post_mortem(sys.exc_info()[2])

    exit(os.EX_SOFTWARE)
