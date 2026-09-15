export async function up(knex) {
  await knex.raw(`
  CREATE UNLOGGED TABLE vector_tile_cache (
      key text PRIMARY KEY,
      value bytea,
      expired_at timestamp
  );
  CREATE INDEX idx_vector_tile_cache_key ON vector_tile_cache (key);

  INSERT INTO directus_collections(collection, "group", icon, color, hidden)
  VALUES ('vector_tile_cache', 'internal', 'tab_duplicate', '#E35169', TRUE);

  INSERT INTO directus_fields(collection, field)
  VALUES
      ('vector_tile_cache', 'key'),
      ('vector_tile_cache', 'value'),
      ('vector_tile_cache', 'expired_at');
  `);
}

export async function down(knex) {
  await knex.raw(`
    DELETE FROM directus_fields WHERE collection = 'vector_tile_cache';
    DELETE FROM directus_collections WHERE collection = 'vector_tile_cache';

    DROP INDEX IF EXISTS idx_vector_tile_cache_key;
    DROP TABLE IF EXISTS vector_tile_cache;
  `);
}
