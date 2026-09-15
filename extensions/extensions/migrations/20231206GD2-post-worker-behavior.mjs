export async function up(knex) {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION handle_vector_tiles_insert()
    RETURNS TRIGGER AS $$
    DECLARE
        col_name TEXT;
    BEGIN
        -- Register to directus_collections
        INSERT INTO directus_collections(collection, "group")
        VALUES (NEW.layer_name, 'layer_data');

        -- Register to directus_fields
        -- This loop will fetch all column names for the table (NEW.layer_name) and insert them into directus_fields
        FOR col_name IN (
            SELECT information_schema.columns.column_name
            FROM information_schema.columns
            WHERE table_name = NEW.layer_name AND table_schema = 'public' -- Assuming the table is in the 'public' schema
        )
        LOOP
            INSERT INTO directus_fields(collection, field)
            VALUES (NEW.layer_name, col_name);
        END LOOP;

        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;


    CREATE OR REPLACE TRIGGER on_vector_tiles_insert
    AFTER INSERT ON vector_tiles
    FOR EACH ROW
    EXECUTE FUNCTION handle_vector_tiles_insert();
`);
}

export async function down(knex) {
  await knex.raw(`
      DROP TRIGGER IF EXISTS on_vector_tiles_insert ON vector_tiles;
      DROP FUNCTION IF EXISTS handle_vector_tiles_insert();
    `);
}
