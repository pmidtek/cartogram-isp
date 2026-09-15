import {
  InvalidPayloadError,
  ServiceUnavailableError,
  ForbiddenError,
} from "@directus/errors";

export default (router, { database, logger, services }) => {
  const { ItemsService } = services;
  router.get("/", async (req, res, next) => {
    try {
      const { accountability } = req;
      const { is_generated = true } = req.query;
      const projectService = new ItemsService("project_map", {
        accountability,
        schema: req.schema,
        knex: database,
      });
      const projects = await projectService.readByQuery({
        fields: ["id", "name", "area_city_id.area_province_id"],
        filter: {
          is_generated: { _eq: is_generated },
        },
        limit: -1,
        sort: ["name"],
      });
      const provinceService = new ItemsService("area_provinces", {
        accountability,
        schema: req.schema,
        knex: database,
      });
      const provinces = await provinceService.readByQuery({
        fields: ["ogc_fid", "province"],
        limit: -1,
        sort: ["province"],
      });
      const results = provinces.map((province) => {
        const provinceProjects = projects.filter(
          (project) =>
            project?.area_city_id?.area_province_id === province.ogc_fid
        );

        return {
          province_ogc_fid: province.ogc_fid,
          province_name: province.province,
          projects: provinceProjects.map((project) => ({
            project_id: project.id,
            project_name: project.name,
          })),
        };
      });
      return res.json({
        data: results,
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "project-map",
          reason: "Failed get project-map",
        })
      );
    }
  });
  router.get("/info/:project_id", async (req, res, next) => {
    const { accountability } = req;
    if (!accountability.user) {
      return next(new ForbiddenError());
    }
    const { project_id } = req.params;
    try {
      const assets = await database("assets as a")
        .innerJoin("project_assets as pa", "a.id", "pa.asset_id")
        .innerJoin("asset_types as at2", "a.asset_type_id", "at2.id")
        .where("pa.project_id", Number(project_id))
        .select("at2.name as asset_type_name", "a.asset_type_id", "at2.icon")
        .select(database.raw("COUNT(at2.id)::int as count"))
        .groupBy("at2.name", "a.asset_type_id", "at2.icon")
        .orderBy("at2.name");

      const routes = await database("routes as r")
        .innerJoin("project_routes as pr", "r.id", "pr.route_id")
        .innerJoin("route_types as rt", "r.route_type_id", "rt.id")
        .where("pr.project_id", Number(project_id))
        .select("rt.name as route_type_name", "r.route_type_id", "rt.color")
        .select(database.raw("COUNT(rt.id)::int as count"))
        .groupBy("rt.name", "r.route_type_id", "rt.color")
        .orderBy("rt.name");

      const cables = await database("cables as c")
        .innerJoin("project_cables as pc", "c.id", "pc.cable_id")
        .innerJoin("cable_types as ct", "c.cable_type_id", "ct.id")
        .where("pc.project_id", Number(project_id))
        .select("ct.name as cable_type_name", "c.cable_type_id", "ct.color")
        .select(database.raw("COUNT(ct.id)::int as count"))
        .groupBy("ct.name", "c.cable_type_id", "ct.color")
        .orderBy("ct.name");

      const { length_m } = await database("cables as c")
        .innerJoin("project_cables as pc", "c.id", "pc.cable_id")
        .where("pc.project_id", Number(project_id))
        .select(
          database.raw(
            "COALESCE(SUM(c.cable_net_length_m),0)::double precision AS length_m"
          )
        )
        .first();

      const cable_group = await database("cables as c")
        .select("ct.name as cable_type_name", "c.cable_group_id")
        .select(
          database.raw("COUNT(ct.id)::int AS count"),
          database.raw(
            "COALESCE(SUM(c.cable_net_length_m),0)::double precision AS length_m"
          )
        )
        .sum({ length_m: "c.cable_net_length_m" })
        .innerJoin("project_cables as pc", "c.id", "pc.cable_id")
        .innerJoin("cable_types as ct", "c.cable_type_id", "ct.id")
        .where("pc.project_id", Number(project_id))
        .groupBy("ct.name", "c.cable_group_id")
        .orderBy("c.cable_group_id");

      const summary = {
        total_olt: 0,
        total_ont: 0,
        total_rumah: 0,
        total_odp: 0,
        total_odc: 0,
        total_pole: 0,
        total_jc: 0,
      };

      for (const row of assets) {
        const name = row.asset_type_name || "";
        const count = Number(row.count || 0);

        if (name === "ONT") {
          summary.total_ont += count;
          summary.total_rumah += count;
        }
        if (name === "Home") summary.total_rumah += count;
        if (name === "ODP") summary.total_odp += count;
        if (name === "ODC") summary.total_odc += count;
        if (name === "POLE") summary.total_pole += count;
        if (name === "Joint Closure") summary.total_jc += count;
        if (name === "OLT") summary.total_olt += count;
      }

      let cable_spec;
      if (summary.total_odc <= 24) cable_spec = "24 core";
      else if (summary.total_odc <= 48) cable_spec = "48 core";
      else if (summary.total_odc <= 96) cable_spec = "96 core";
      else if (summary.total_odc <= 144) cable_spec = "144 core";
      else cable_spec = "288 core";

      summary.cable_spec = cable_spec;
      summary.cable_length_m = length_m;
      summary.cable_group = cable_group;

      const { rows: assetGroups } = await database.raw(
        `WITH base AS (
          SELECT
              a.id,
              CONCAT(at2.name,'(',a.asset_group_id,')') AS asset_type_name,
              COALESCE(a.asset_group_id::varchar, a.asset_type_id::varchar) AS asset_type_id,
              COALESCE(ag.icon::text, at2.icon::text) AS icon
          FROM assets a
          INNER JOIN project_assets pa ON a.id = pa.asset_id
          INNER JOIN asset_types at2 ON a.asset_type_id = at2.id
          LEFT JOIN asset_groups ag ON a.asset_group_id = ag.id
          WHERE pa.project_id = ?
        ) SELECT asset_type_name, asset_type_id, icon, COUNT(id)::int AS count
          FROM base
          GROUP BY asset_type_name, asset_type_id, icon
          ORDER BY asset_type_name;`,
        [Number(project_id)]
      );
      const { rows: cableGroups } = await database.raw(
        `WITH base AS (
          SELECT
              c.id,
              CONCAT(ct.name,'(',c.cable_group_id,')') AS cable_type_name,
              c.cable_group_id AS cable_type_id,
              cg.color
          FROM cables c
          INNER JOIN project_cables pc ON c.id = pc.cable_id
          INNER JOIN cable_types ct ON c.cable_type_id = ct.id
          LEFT JOIN cable_groups cg ON c.cable_group_id = cg.id
          WHERE pc.project_id = ?
        ) SELECT cable_type_name, cable_type_id, color, COUNT(id)::int AS count
          FROM base
          GROUP BY cable_type_name, cable_type_id, color
          ORDER BY cable_type_name;`,
        [Number(project_id)]
      );
      return res.json({
        data: {
          summary: summary,
          layer: { assets: assetGroups, routes: routes, cables: cableGroups },
        },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "project-map",
          reason: "Failed get project-map",
        })
      );
    }
  });
};
