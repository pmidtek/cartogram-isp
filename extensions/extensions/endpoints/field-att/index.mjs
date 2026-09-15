import {
  InvalidPayloadError,
  ServiceUnavailableError,
} from '@directus/errors';

export default (router, { logger, database }) => {
  router.get('/:collection', async (req, res, next) => {
    const { collection } = req.params;
    let actualCollection = collection;

    try {
      // 1. Check if collection exists in directus_collections
      const collectionExists = await database('directus_collections')
        .where('collection', actualCollection)
        .first();

      if (collectionExists) {
        const fields = await database('directus_fields')
          .where('collection', actualCollection)
          .select('field')
          .orderBy('field', 'asc');

        logger.info("fields: " + JSON.stringify(fields));

        if (fields.length > 0) {
          const columnNames = fields.map((field) => field.field);
          logger.info("columnNames: " + JSON.stringify(columnNames));
          return res.json(columnNames);
        }

        // 1a. Fallback: Try information_schema
        const columns = await getColumnsFromInformationSchema(database, actualCollection);
        logger.info("columns result: " + JSON.stringify(columns));

        if (columns.length > 0) {
          return res.json(columns);
        }

        // 1b. Final Fallback: Fetch one record and get keys
        const sampleRecord = await database(actualCollection).first();
        if (sampleRecord) {
          const columnNames = Object.keys(sampleRecord);
          logger.info("columnNames via sample record: " + JSON.stringify(columnNames));
          return res.json(columnNames);
        }
      }

      // 2. Check if this is a record in the 'cities' table
      const citiesMatch = await database('cities')
        .where('id', collection)
        .first();

      if (citiesMatch) {
        actualCollection = 'cities';

        const fields = await database('directus_fields')
          .where('collection', actualCollection)
          .select('field')
          .orderBy('field', 'asc');

        if (fields.length > 0) {
          const columnNames = fields.map((field) => field.field);
          return res.json(columnNames);
        }

        const columns = await getColumnsFromInformationSchema(database, actualCollection);
        if (columns.length > 0) {
          return res.json(columns);
        }

        return next(
          new InvalidPayloadError(`'${actualCollection}' collection found for '${collection}', but no fields exist.`)
        );
      }

      // 3. Fallback: Check if table exists in DB directly
      const tableExists = await database
        .select('table_name')
        .from('information_schema.tables')
        .where({
          table_schema: database.client.config.connection.database,
          table_name: collection,
        })
        .first();

      if (tableExists) {
        actualCollection = collection;

        const columns = await getColumnsFromInformationSchema(database, actualCollection);
        if (columns.length > 0) {
          return res.json(columns);
        } else {
          return next(
            new InvalidPayloadError(`Table '${actualCollection}' found but has no columns.`)
          );
        }
      }

      // 4. Nothing matched
      return next(
        new InvalidPayloadError(`Collection or table '${collection}' not found.`)
      );
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError('Failed to retrieve collection fields.')
      );
    }
  });
};

async function getColumnsFromInformationSchema(database, tableName) {
  const rows = await database
    .select('column_name')
    .from('information_schema.columns')
    .where({
      table_schema: database.client.config.connection.database,
      table_name: tableName,
    })
    .orderBy('ordinal_position', 'asc');

  return rows.map((row) => row.column_name);
}
