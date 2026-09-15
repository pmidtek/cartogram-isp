from psycopg2.extras import execute_values


def insert_project_site_fc(cur, uploader, project_id, site_point_id):
    sql = """
        INSERT INTO project_site_points (
            project_id, site_point_id, user_created, date_created
        ) VALUES (%s, %s, %s, NOW() );
    """
    cur.execute(
        sql,
        [
            project_id,
            site_point_id,
            uploader,
        ],
    )
    return None


def insert_site_point_fc(
    cur_main,
    cur_seq,
    gdf,
    uploader,
    project_id,
    site_point_type_id=5,  # ftth site
    site_seq=0,
):
    """Insert site point dengan kode P<project_id>_<seq>.

    `site_seq` = sequence terakhir yang sudah terpakai (0 = mulai dari 1).
    Return (gdf, site_seq_terakhir); pemanggil wajib meneruskan nilai balik
    ini ke pemanggilan berikutnya supaya sequence tidak terputus/ulang.
    """
    sql_get_area = """
        SELECT ogc_fid AS area_city_id
        FROM area_cities
        WHERE ST_Covers(geom, ST_SetSRID(%s::geometry, 4326))
        LIMIT 1;
    """
    sql_insert_site = """
        INSERT INTO site_points (
            user_created, date_created,
            name, code, site_point_type_id,
            owner, area_city_id, geom)
        VALUES (
            %s, NOW(),
            %s, %s, %s,
            %s, %s, ST_SetSRID(%s::geometry, 4326)
        ) RETURNING id;
    """

    for index, row in gdf.iterrows():
        cur_seq.execute(sql_get_area, [row.geometry.wkb])
        area_result = cur_seq.fetchone()
        if not area_result or not all(area_result):
            raise ValueError(
                f"Tidak ditemukan area_cities untuk koordinat SITE-ODC baris {index+2}"
            )
        (area_city_id,) = area_result
        site_seq += 1
        code = f"P{project_id}_{site_seq}"
        name = code

        cur_main.execute(
            sql_insert_site,
            [
                uploader,
                name,
                code,
                site_point_type_id,
                None,
                area_city_id,
                row.geometry.wkb,
            ],
        )
        site_result = cur_main.fetchone()
        site_point_id = site_result[0]

        insert_project_site_fc(
            cur_main,
            uploader,
            project_id,
            site_point_id,
        )
        gdf.at[index, "site_point_id"] = site_point_id
        gdf.at[index, "site_code"] = code

    return gdf, site_seq


def insert_project_asset_fc(cur, uploader, project_id, asset_id):
    cur.execute(
        """
        INSERT INTO project_assets (project_id, asset_id, user_created, date_created)
        VALUES (%s, %s, %s, NOW() );;
        """,
        [
            project_id,
            asset_id,
            uploader,
        ],
    )
    return None


def insert_asset_fc_bulk(cur, uploader, project_id, asset_rows):
    sql = f"""
        WITH inserted_assets AS (
            INSERT INTO assets (
                site_point_id, name, code, asset_type_id, asset_group_id,
                user_created, date_created
            ) VALUES %s
            RETURNING id
        ) INSERT INTO project_assets (project_id, asset_id, user_created, date_created)
            SELECT {project_id}, id, '{uploader}', NOW() FROM inserted_assets;
    """
    execute_values(
        cur,
        sql,
        asset_rows,
        template="(%s, %s, %s, %s, %s, %s, NOW())",
        fetch=False,
        page_size=1000,
    )
    return None


def insert_route_fc_bulk(cur, uploader, project_id, route_rows):
    """Insert route bulk, return list (route_id, site_from, site_to, length_m).

    fetch=True wajib: execute_values menjalankan satu statement per page,
    jadi cur.fetchall() manual hanya mengembalikan hasil page TERAKHIR
    (dulu bikin route_map cuma berisi <=1000 baris terakhir). fetch=True
    mengakumulasi hasil semua page.
    """
    sql = f"""
        WITH inserted_routes AS (
            INSERT INTO routes (
                site_from, site_to, name, code, route_type_id, geom, length_m,
                user_created, date_created
            ) VALUES %s
            RETURNING id, site_from, site_to, length_m
        ), inserted_project_routes AS (
          INSERT INTO project_routes (project_id, route_id, user_created, date_created)
            SELECT {project_id}, id, '{uploader}', NOW()
            FROM inserted_routes
        ) SELECT id AS route_id, site_from, site_to, length_m
            FROM inserted_routes;
    """
    rows = execute_values(
        cur,
        sql,
        route_rows,
        template="(%s,%s,%s,%s,%s,ST_SetSRID(%s::geometry, 4326),%s,%s,NOW())",
        fetch=True,
        page_size=1000,
    )
    # list, bukan dict: pasangan (site_from, site_to) yang duplikat tidak
    # boleh saling menimpa karena semuanya dipakai untuk bangun RouteGraph.
    return [
        (route_id, site_from, site_to, length_m)
        for route_id, site_from, site_to, length_m in rows
    ]


def insert_cable_fc(cur, uploader, cable_data, route_ids, project_id):
    site_from = cable_data.get("site_from")
    site_to = cable_data.get("site_to")
    code = cable_data.get("code")
    name = cable_data.get("name")
    cable_type_id = cable_data.get("cable_type_id")
    cable_group_id = cable_data.get("cable_group_id")
    length_m = cable_data.get("length_m")

    # insert cable
    cur.execute(
        """
        INSERT INTO cables (site_from, site_to, code, name, cable_type_id, cable_group_id, cable_net_length_m, user_created, date_created)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
        RETURNING id
        """,
        (
            site_from,
            site_to,
            code,
            name,
            cable_type_id,
            cable_group_id,
            length_m,
            uploader,
        ),
    )
    cable_id = cur.fetchone()[0]

    # insert cable_routes
    cur.executemany(
        """
        INSERT INTO cable_routes (cable_id, route_id)
        VALUES (%s, %s)
        """,
        [(cable_id, int(rid)) for rid in route_ids],
    )

    insert_project_cable_fc(cur, uploader, project_id, cable_id)

    return cable_id


def insert_cable_fc_bulk(
    cur,
    uploader,
    project_id,
    cable_rows,
):
    cable_values = [
        (
            row["site_from"],
            row["site_to"],
            row["code"],
            row["name"],
            row["cable_type_id"],
            row["cable_group_id"],
            row["length_m"],
            uploader,
        )
        for row in cable_rows
    ]
    sql = """
        INSERT INTO cables (
            site_from, site_to, code, name,
            cable_type_id, cable_group_id, cable_net_length_m,
            user_created, date_created
        )
        VALUES %s
        RETURNING id
    """

    inserted = execute_values(
        cur,
        sql,
        cable_values,
        template="(%s,%s,%s,%s,%s,%s,%s,%s,NOW())",
        fetch=True,
        page_size=1000,
    )

    cable_ids = [row[0] for row in inserted]

    # cable_routes
    cable_route_values = []
    for cable_id, row in zip(cable_ids, cable_rows):
        for route_id in row["route_ids"]:
            cable_route_values.append((cable_id, int(route_id)))

    execute_values(
        cur,
        """ INSERT INTO cable_routes (cable_id, route_id) VALUES %s """,
        cable_route_values,
        page_size=5000,
    )

    # project_cables
    project_cable_values = [(project_id, cable_id, uploader) for cable_id in cable_ids]

    execute_values(
        cur,
        """ INSERT INTO project_cables (project_id, cable_id, user_created, date_created) VALUES %s """,
        project_cable_values,
        template="(%s,%s,%s,NOW())",
        page_size=5000,
    )

    return cable_ids


def insert_project_cable_fc(cur, uploader, project_id, cable_id):
    sql = """
        INSERT INTO project_cables (
            project_id, cable_id, user_created, date_created
        ) VALUES (%s, %s, %s, NOW() );
    """
    cur.execute(
        sql,
        [
            project_id,
            cable_id,
            uploader,
        ],
    )
    return None

    ## Insert Asset
    # def insert_asset_fc(
    #     cur, uploader, site_point_id, name, code, asset_type_id
    # ):
    #     cur.execute(
    #         """
    #         INSERT INTO assets(site_point_id, name, code, asset_type_id, user_created, date_created)
    #         VALUES %s, %s, %s, %s, %s, NOW()
    #         RETURNING id
    #         """,
    #         [site_point_id, name, code, asset_type_id, uploader],
    #     )
    #     asset_result = cur_main.fetchone()
    #     asset_id = asset_result[0]

    #     insert_project_asset_fc(cur, uploader, project_id, asset_id)
    #     return None
