import { ServiceUnavailableError, RouteNotFoundError } from "@directus/errors";

export default (router, { database, logger, services }) => {
  const { ItemsService } = services;
  router.get("/:layerName/:layerId", async (req, res, next) => {
    const { accountability } = req;
    const { layerName, layerId } = req.params;
    const { kab_name } = req.query;

    const layerItemsService = new ItemsService(layerName, {
      accountability,
      schema: req.schema,
      knex: database,
    });
    const vectorTilesService = new ItemsService("vector_tiles", {
      schema: req.schema,
      knex: database,
    });

    let markdown = "";
    let attachments = [];
    let gallery = [];
    let kabName = kab_name ? `?kab_name=${kab_name}` : "";
    let layerNameFilter = layerName + kabName;
    try {
      const layerConfig = await vectorTilesService.readByQuery({
        filter: {
          layer_name: {
            _eq: layerNameFilter,
          },
        },
        fields: [
          "feature_detail_template",
          "feature_detail_attachments",
          "image_columns",
        ],
        limit: 1,
      });
      logger.info(layerConfig);
      if (layerConfig.length) {
        markdown = layerConfig[0].feature_detail_template;
        attachments = layerConfig[0].feature_detail_attachments || [];
        gallery = layerConfig[0].image_columns || [];
      } else {
        return next(
          new RouteNotFoundError({ path: "/feature-detail" + req.path })
        );
      }
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "feature-detail",
          reason: "Failed to fetch feature detail markdown",
        })
      );
    }

    if (markdown || attachments.length || gallery.length) {
      try {
        const featureData = await layerItemsService.readOne(layerId);
        if (markdown) {
          markdown = markdown.replace(
            /{{\s{1}(\w+)\s{1}}}/g,
            (match, propName) => {
              if (featureData.hasOwnProperty(propName)) {
                return featureData[propName];
              } else {
                return match;
              }
            }
          );
        }
        attachments = attachments.map((attachment) => ({
          ...attachment,
          url: featureData[attachment.url_column] ?? "#",
        }));
        gallery = gallery.map((column) => featureData[column] ?? "");
      } catch (error) {
        if (error.code === "FORBIDDEN") {
          return next(error);
        } else {
          logger.error(error);
          return next(
            new ServiceUnavailableError({
              service: "feature-detail",
              reason: "Failed to fetch feature detail",
            })
          );
        }
      }
    }
    return res.json({ markdown, attachments, gallery });
  });
};
