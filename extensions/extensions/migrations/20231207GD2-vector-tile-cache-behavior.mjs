export async function up(knex) {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION handle_vector_tiles_class_columns_update()
      RETURNS trigger
      LANGUAGE 'plpgsql'
    AS $BODY$
      BEGIN
        DELETE FROM vector_tile_cache WHERE key LIKE format('mvt_%s_%%', NEW.layer_name);
        RETURN NULL;
      END;
    $BODY$;

    CREATE OR REPLACE TRIGGER on_vector_tiles_class_columns_update
    AFTER UPDATE OF fill_class_columns, line_class_columns, circle_class_columns, symbol_class_columns
    ON vector_tiles
    FOR EACH ROW
    WHEN (NEW.cache_duration > 0)
    EXECUTE FUNCTION handle_vector_tiles_class_columns_update();
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS on_vector_tiles_class_columns_update ON vector_tiles;
    DROP FUNCTION IF EXISTS handle_vector_tiles_class_columns_update();
  `);
}
