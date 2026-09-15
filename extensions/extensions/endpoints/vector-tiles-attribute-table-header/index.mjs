import {
  ServiceUnavailableError,
  ForbiddenError,
  RouteNotFoundError,
} from "@directus/errors";

export default (router, { database, logger, services }) => {
  const { ItemsService, FieldsService } = services;
  router.get("/:layerName", async (req, res, next) => {
    const { accountability } = req;
    if (!req.accountability.user) {
      return next(new ForbiddenError());
    }
    const { layerName } = req.params;
    const fieldsService = new FieldsService({
      knex: database,
      schema: req.schema,
    });

    const permissions = accountability.permissions.filter(
      (el) => el.collection === layerName && el.action === "read"
    );
    if (!accountability.admin && !permissions.length) {
      return next(new ForbiddenError({ path: "/table-header" + req.path }));
    }

    const allowedFields = accountability.admin ? ["*"] : permissions[0].fields;
    if (!allowedFields.length) {
      return next(new ForbiddenError({ path: "/table-header" + req.path }));
    }

    let fields = [];
    try {
      fields = await fieldsService.readAll(layerName);
      fields = fields.filter(
        (el) =>
          !["ogc_fid", "geom"].includes(el.field) &&
          (allowedFields[0] === "*" ? true : allowedFields.includes(el.field))
      );
      fields = fields.map((el) => {
        return { field: el.field, type: el.type };
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "vector-tiles-attribute-table-header",
          reason: "Failed to fetch fields",
        })
      );
    }

    return res.json({ data: fields });
  });
};
