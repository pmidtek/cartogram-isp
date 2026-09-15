const colPat = `'"get",\\s*"([^"]+)"'`;

export async function up(knex) {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION handle_vector_tiles_permission_type_update()
      RETURNS trigger
      LANGUAGE 'plpgsql'
    AS $BODY$
      BEGIN
        IF NEW.permission_type = 'admin' THEN
          DELETE FROM directus_permissions
          WHERE collection = OLD.layer_name;
          DELETE FROM vector_tiles_directus_roles
          WHERE vector_tiles_layer_id = OLD.layer_id;
        ELSIF NEW.permission_type = 'roles' THEN
          DELETE FROM directus_permissions
          WHERE collection = OLD.layer_name
          AND role IS NULL;
        ELSIF NEW.permission_type = 'roles+public' THEN
          INSERT INTO directus_permissions(collection, role, action, fields)
          VALUES(OLD.layer_name, NULL, 'read', '*');
        END IF;
        RETURN NULL;
      END;
    $BODY$;

    CREATE OR REPLACE TRIGGER on_vector_tiles_permission_type_update
    AFTER UPDATE OF permission_type
    ON vector_tiles
    FOR EACH ROW
    EXECUTE FUNCTION handle_vector_tiles_permission_type_update();

    CREATE OR REPLACE FUNCTION handle_vector_tiles_directus_roles_insert()
      RETURNS trigger
      LANGUAGE 'plpgsql'
    AS $BODY$
      BEGIN
        INSERT INTO directus_permissions(collection, role, action, fields)
        SELECT layer_name, NEW.directus_roles_id, 'read', '*'
        FROM vector_tiles
        WHERE layer_id = NEW.vector_tiles_layer_id;
        RETURN NULL;
      END;
    $BODY$;

    CREATE OR REPLACE TRIGGER on_vector_tiles_directus_roles_insert
    AFTER INSERT
    ON vector_tiles_directus_roles
    FOR EACH ROW
    EXECUTE FUNCTION handle_vector_tiles_directus_roles_insert();

    CREATE OR REPLACE FUNCTION handle_vector_tiles_directus_roles_delete()
      RETURNS trigger
      LANGUAGE 'plpgsql'
    AS $BODY$
      BEGIN
        DELETE FROM directus_permissions
        WHERE collection IN (
          SELECT layer_name
          FROM vector_tiles
          WHERE layer_id = OLD.vector_tiles_layer_id
        )
        AND role = OLD.directus_roles_id;
        RETURN NULL;
      END;
    $BODY$;

    CREATE OR REPLACE TRIGGER on_vector_tiles_directus_roles_delete
    AFTER DELETE
    ON vector_tiles_directus_roles
    FOR EACH ROW
    EXECUTE FUNCTION handle_vector_tiles_directus_roles_delete();

    CREATE OR REPLACE FUNCTION handle_vector_tiles_delete()
      RETURNS trigger
      LANGUAGE 'plpgsql'
    AS $BODY$
      BEGIN
        -- following steps in directus CollectionsService
        EXECUTE format('DROP TABLE IF EXISTS %I', OLD.layer_name);
        EXECUTE format('UPDATE directus_collections SET "group" = NULL WHERE "group" = %L', OLD.layer_name);
        EXECUTE format('DELETE FROM directus_collections WHERE collection = %L', OLD.layer_name);
        EXECUTE format('DELETE FROM directus_fields WHERE collection = %L', OLD.layer_name);
        EXECUTE format('DELETE FROM directus_presets WHERE collection = %L', OLD.layer_name);
        EXECUTE format('UPDATE directus_revisions SET parent = NULL WHERE parent IN (SELECT id FROM directus_revisions WHERE collection = %L)', OLD.layer_name);
        EXECUTE format('DELETE FROM directus_revisions WHERE collection = %L', OLD.layer_name);
        EXECUTE format('DELETE FROM directus_activity WHERE collection = %L', OLD.layer_name);
        EXECUTE format('DELETE FROM directus_permissions WHERE collection = %L', OLD.layer_name);

        -- there should be delete directus_fields related to this collection and delete directus_relations
        -- but we assume user didn't alter the layer columns, thus we won't do those deletions

        RETURN NULL;
      END;
    $BODY$;

    CREATE OR REPLACE TRIGGER on_vector_tiles_delete
    AFTER DELETE
    ON vector_tiles
    FOR EACH ROW
    EXECUTE FUNCTION handle_vector_tiles_delete();

    CREATE OR REPLACE FUNCTION handle_directus_collections_delete()
      RETURNS trigger
      LANGUAGE 'plpgsql'
    AS $BODY$
      BEGIN
        DELETE FROM vector_tiles
        WHERE layer_name = OLD.collection;
        RETURN NULL;
      END;
    $BODY$;

    CREATE OR REPLACE TRIGGER on_directus_collections_delete
    AFTER DELETE
    ON directus_collections
    FOR EACH ROW
    EXECUTE FUNCTION handle_directus_collections_delete();

    CREATE OR REPLACE FUNCTION handle_vector_tiles_fill_style_update()
      RETURNS trigger
      LANGUAGE 'plpgsql'
    AS $BODY$
      DECLARE
        class_columns text[];
      BEGIN
        IF NEW.fill_style IS NOT NULL THEN
          SELECT ARRAY[SUBSTRING(paint_fill_color FROM ${colPat}),SUBSTRING(paint_fill_opacity FROM ${colPat}),SUBSTRING(paint_fill_outline_color FROM ${colPat})] INTO class_columns
          FROM fill
          WHERE id = NEW.fill_style;

          SELECT ARRAY(SELECT DISTINCT col FROM unnest(class_columns) a(col)) INTO class_columns;
          
          NEW.fill_class_columns := NULLIF(array_to_string(class_columns,','),'');
          RETURN NEW;
        END IF;

        NEW.fill_class_columns := NULL;
        RETURN NEW;
      END;
    $BODY$;

    CREATE OR REPLACE TRIGGER on_vector_tiles_fill_style_update
    BEFORE UPDATE OF fill_style
    ON vector_tiles
    FOR EACH ROW
    EXECUTE FUNCTION handle_vector_tiles_fill_style_update();

    CREATE OR REPLACE FUNCTION handle_vector_tiles_line_style_update()
      RETURNS trigger
      LANGUAGE 'plpgsql'
    AS $BODY$
      DECLARE
        class_columns text[];
      BEGIN
        IF NEW.line_style IS NOT NULL THEN
          SELECT ARRAY[SUBSTRING(paint_line_color FROM ${colPat}),SUBSTRING(paint_line_opacity FROM ${colPat})] INTO class_columns
          FROM line
          WHERE id = NEW.line_style;

          SELECT ARRAY(SELECT DISTINCT col FROM unnest(class_columns) a(col)) INTO class_columns;
          
          NEW.line_class_columns := NULLIF(array_to_string(class_columns,','),'');
          RETURN NEW;
        END IF;

        NEW.line_class_columns := NULL;
        RETURN NEW;
      END;
    $BODY$;

    CREATE OR REPLACE TRIGGER on_vector_tiles_line_style_update
    BEFORE UPDATE OF line_style
    ON vector_tiles
    FOR EACH ROW
    EXECUTE FUNCTION handle_vector_tiles_line_style_update();

    CREATE OR REPLACE FUNCTION handle_vector_tiles_circle_style_update()
      RETURNS trigger
      LANGUAGE 'plpgsql'
    AS $BODY$
      DECLARE
        class_columns text[];
      BEGIN
        IF NEW.circle_style IS NOT NULL THEN
          SELECT ARRAY[SUBSTRING(paint_circle_color FROM ${colPat}),SUBSTRING(paint_circle_opacity FROM ${colPat}),SUBSTRING(paint_circle_stroke_color FROM ${colPat}),SUBSTRING(paint_circle_stroke_opacity FROM ${colPat})] INTO class_columns
          FROM circle
          WHERE id = NEW.circle_style;

          SELECT ARRAY(SELECT DISTINCT col FROM unnest(class_columns) a(col)) INTO class_columns;
          
          NEW.circle_class_columns := NULLIF(array_to_string(class_columns,','),'');
          RETURN NEW;
        END IF;

        NEW.circle_class_columns := NULL;
        RETURN NEW;
      END;
    $BODY$;

    CREATE OR REPLACE TRIGGER on_vector_tiles_circle_style_update
    BEFORE UPDATE OF circle_style
    ON vector_tiles
    FOR EACH ROW
    EXECUTE FUNCTION handle_vector_tiles_circle_style_update();

    CREATE OR REPLACE FUNCTION handle_vector_tiles_symbol_style_update()
      RETURNS trigger
      LANGUAGE 'plpgsql'
    AS $BODY$
      DECLARE
        class_columns text[];
      BEGIN
        IF NEW.symbol_style IS NOT NULL THEN
          SELECT ARRAY[SUBSTRING(paint_icon_color FROM ${colPat}),SUBSTRING(paint_icon_halo_color FROM ${colPat}),SUBSTRING(paint_text_color FROM ${colPat}),SUBSTRING(paint_text_halo_color FROM ${colPat}),SUBSTRING(paint_icon_opacity FROM ${colPat}),SUBSTRING(paint_text_opacity FROM ${colPat}),SUBSTRING(layout_text_field FROM ${colPat})] INTO class_columns
          FROM symbol
          WHERE id = NEW.symbol_style;

          SELECT ARRAY(SELECT DISTINCT col FROM unnest(class_columns) a(col)) INTO class_columns;
          
          NEW.symbol_class_columns := NULLIF(array_to_string(class_columns,','),'');
          RETURN NEW;
        END IF;

        NEW.symbol_class_columns := NULL;
        RETURN NEW;
      END;
    $BODY$;

    CREATE OR REPLACE TRIGGER on_vector_tiles_symbol_style_update
    BEFORE UPDATE OF symbol_style
    ON vector_tiles
    FOR EACH ROW
    EXECUTE FUNCTION handle_vector_tiles_symbol_style_update();
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS on_vector_tiles_symbol_style_update ON vector_tiles;
    DROP FUNCTION IF EXISTS handle_vector_tiles_symbol_style_update();

    DROP TRIGGER IF EXISTS on_vector_tiles_circle_style_update ON vector_tiles;
    DROP FUNCTION IF EXISTS handle_vector_tiles_circle_style_update();

    DROP TRIGGER IF EXISTS on_vector_tiles_line_style_update ON vector_tiles;
    DROP FUNCTION IF EXISTS handle_vector_tiles_line_style_update();

    DROP TRIGGER IF EXISTS on_vector_tiles_fill_style_update ON vector_tiles;
    DROP FUNCTION IF EXISTS handle_vector_tiles_fill_style_update();

    DROP TRIGGER IF EXISTS on_directus_collections_delete ON directus_collections;
    DROP FUNCTION IF EXISTS handle_directus_collections_delete();

    DROP TRIGGER IF EXISTS on_vector_tiles_delete ON vector_tiles;
    DROP FUNCTION IF EXISTS handle_vector_tiles_delete();

    DROP TRIGGER IF EXISTS on_vector_tiles_directus_roles_delete ON vector_tiles_directus_roles;
    DROP FUNCTION IF EXISTS handle_vector_tiles_directus_roles_delete();

    DROP TRIGGER IF EXISTS on_vector_tiles_directus_roles_insert ON vector_tiles_directus_roles;
    DROP FUNCTION IF EXISTS handle_vector_tiles_directus_roles_insert();

    DROP TRIGGER IF EXISTS on_vector_tiles_permission_type_update ON vector_tiles;
    DROP FUNCTION IF EXISTS handle_vector_tiles_permission_type_update();
  `);
}
