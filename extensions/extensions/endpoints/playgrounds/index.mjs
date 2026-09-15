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
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const playgroundsService = new ItemsService("playgrounds", {
        accountability,
        schema: req.schema,
        knex: database,
      });
      let playgrounds = await playgroundsService.readByQuery({
        filter: { user_created: { _eq: accountability.user } },
        fields: ["*"],
        limit: 1,
      });
      if (playgrounds.length < 1) {
        const usersService = new ItemsService("directus_users", {
          accountability,
          schema: req.schema,
          knex: database,
        });
        const userMe = await usersService.readOne(accountability.user, {
          fields: [
            "id",
            "role.admin_access",
            "role.role_type",
            "area_provinces.area_provinces_ogc_fid.province_id",
            "area_cities.area_cities_ogc_fid.city_id",
          ],
        });
        const admin_access = userMe.role.admin_access;
        const role_type = userMe.role.role_type;

        const province_ids =
          userMe.area_provinces?.map(
            (p) => p.area_provinces_ogc_fid?.province_id
          ) || [];
        const city_ids =
          userMe.area_cities?.map((c) => c.area_cities_ogc_fid?.city_id) || [];
        if (!admin_access && role_type == "province") {
          await playgroundsService.createOne({
            provinces: province_ids.map((id) => ({ key: id })),
          });
        } else if (!admin_access && role_type == "city") {
          await playgroundsService.createOne({
            provinces: province_ids.map((id) => ({ key: id })),
            cities: city_ids.map((id) => ({ key: id })),
          });
        }
        playgrounds = await playgroundsService.readByQuery({
          filter: { user_created: { _eq: accountability.user } },
          fields: ["*"],
          limit: 1,
        });
      }
      return res.json({
        data: playgrounds.length ? playgrounds[0] : {},
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "playgrounds",
          reason: "Failed get playgrounds",
        })
      );
    }
  });
  router.put("/", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const { provinces, cities } = req.body;
      if (!provinces) {
        return next(
          new InvalidPayloadError({
            reason: "provinces in body required",
          })
        );
      }
      const playgroundsService = new ItemsService("playgrounds", {
        accountability,
        schema: req.schema,
        knex: database,
      });
      const playgrounds = await playgroundsService.readByQuery({
        filter: { user_created: { _eq: accountability.user } },
        fields: ["*"],
        limit: 1,
      });
      let resultId;
      if (playgrounds.length) {
        resultId = await playgroundsService.updateOne(playgrounds[0].id, {
          provinces: provinces,
          cities: cities ? cities : [],
        });
      } else {
        resultId = await playgroundsService.createOne({
          provinces: provinces,
          cities: cities ? cities : [],
        });
      }
      const result = await playgroundsService.readByQuery({
        filter: { user_created: { _eq: accountability.user } },
        fields: ["*"],
        limit: 1,
      });
      return res.json({
        data: result.length ? result[0] : {},
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "playgrounds",
          reason: "Failed get playgrounds",
        })
      );
    }
  });
};
