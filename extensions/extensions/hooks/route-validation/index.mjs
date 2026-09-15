import { InvalidPayloadError } from "@directus/errors";
export default ({ filter }, { database, services, getSchema, logger }) => {
  filter("routes.items.create", async (payload) => {
    const { site_from, site_to, route_type_id } = payload;
    if (!site_from || !site_to || !route_type_id) {
      return payload;
    }
    const sql = `
        SELECT EXISTS (
            SELECT 1 FROM routes
            WHERE ((site_from = ? AND site_to = ? ) OR (site_from = ? AND site_to = ?))
            AND route_type_id = ?
        ) exists`;

    const { rows } = await database.raw(sql, [
      site_from,
      site_to,
      site_to,
      site_from,
      route_type_id,
    ]);
    if (rows[0].exists) {
      throw new InvalidPayloadError({
        reason: "Route already exists between these sites",
      });
    }
    return payload;
  });
};
