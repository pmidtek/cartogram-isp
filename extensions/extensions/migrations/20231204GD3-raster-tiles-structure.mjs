import { LAYER_PREVIEWS_FOLDER_ID } from "./const/FOLDER_IDS.mjs";

export async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS raster_tiles (
      layer_id uuid NOT NULL PRIMARY KEY,
      user_created uuid REFERENCES directus_users (id),
      date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
      user_updated uuid REFERENCES directus_users (id),
      date_updated timestamp with time zone,
      bounds json NOT NULL,
      minzoom integer NOT NULL,
      maxzoom integer NOT NULL,
      terrain_rgb boolean NOT NULL,
      layer_alias character varying(255) NOT NULL,
      preview uuid REFERENCES directus_files (id)
        ON DELETE SET NULL,
      description text,
      category uuid REFERENCES categories (category_id)
        ON DELETE SET NULL,
      listed boolean DEFAULT false NOT NULL,
      active boolean DEFAULT false NOT NULL,
      permission_type character varying(255) DEFAULT 'admin',
      visible boolean DEFAULT true NOT NULL
    );

    INSERT INTO directus_collections(collection,icon,color,"group",collapse)
    VALUES ('raster_tiles','image_aspect_ratio','#FFA439','layer_configuration',TRUE);

    CREATE TABLE IF NOT EXISTS raster_tiles_directus_roles
    (
      id serial NOT NULL PRIMARY KEY,
      raster_tiles_layer_id uuid REFERENCES raster_tiles (layer_id)
        ON DELETE CASCADE,
      directus_roles_id uuid REFERENCES directus_roles (id)
        ON DELETE CASCADE
    );

    INSERT INTO directus_collections(collection,"group",hidden)
    VALUES ('raster_tiles_directus_roles','raster_tiles',TRUE);

    INSERT INTO directus_fields(collection,field,special,interface,options,display,display_options,readonly,hidden,sort,width,translations,note,conditions,required,"group",validation,validation_message)
    VALUES
      ('raster_tiles','layer_id','uuid','input',NULL,NULL,NULL,TRUE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('raster_tiles','user_created','user-created','select-dropdown-m2o','{"template":"{{avatar.$thumbnail}} {{first_name}} {{last_name}}"}','user',NULL,TRUE,FALSE,NULL,'half',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('raster_tiles','date_created','date-created','datetime',NULL,'datetime','{"relative":true}',TRUE,FALSE,NULL,'half',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('raster_tiles','user_updated','user-updated','select-dropdown-m2o','{"template":"{{avatar.$thumbnail}} {{first_name}} {{last_name}}"}','user',NULL,TRUE,FALSE,NULL,'half',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('raster_tiles','date_updated','date-updated','datetime',NULL,'datetime','{"relative":true}',TRUE,FALSE,NULL,'half',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('raster_tiles','bounds',NULL,'map',NULL,NULL,NULL,TRUE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('raster_tiles','minzoom',NULL,'input',NULL,NULL,NULL,TRUE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('raster_tiles','maxzoom',NULL,'input',NULL,NULL,NULL,TRUE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('raster_tiles','terrain_rgb','cast-boolean','boolean','{"label":"True"}',NULL,NULL,TRUE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('raster_tiles','layer_alias',NULL,'input',NULL,NULL,NULL,FALSE,FALSE,NULL,'full',NULL,NULL,NULL,TRUE,NULL,NULL,NULL),
      ('raster_tiles','preview','file','file-image','{"folder":"${LAYER_PREVIEWS_FOLDER_ID}"}',NULL,NULL,FALSE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('raster_tiles','description',NULL,'input-multiline',NULL,NULL,NULL,false,false,NULL,'full',NULL,NULL,NULL,false,NULL,NULL,NULL),
      ('raster_tiles','category','m2o','select-dropdown-m2o','{"template":"{{category_name}}"}','related-values','{"template":"{{category_name}}"}',FALSE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('raster_tiles','listed','cast-boolean','boolean','{"label":"True"}',NULL,NULL,FALSE,FALSE,NULL,'half',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('raster_tiles','active','cast-boolean','boolean','{"label":"True"}',NULL,NULL,FALSE,FALSE,NULL,'half',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('raster_tiles','permission_type',NULL,'select-dropdown','{"choices":[{"text":"Admin Only","value":"admin"},{"text":"Selected Roles","value":"roles"},{"text":"Selected Roles + Public","value":"roles+public"}]}',NULL,NULL,FALSE,FALSE,NULL,'half',NULL,NULL,NULL,TRUE,NULL,NULL,NULL),
      ('raster_tiles','allowed_roles','m2m','list-m2m','{"enableCreate":false,"filter":{"_and":[{"admin_access":{"_eq":false}}]},"template":"{{directus_roles_id.name}}"}',NULL,NULL,FALSE,FALSE,NULL,'half',NULL,NULL,'[{"name":"Hide if permission type is admin","rule":{"_and":[{"permission_type":{"_eq":"admin"}}]},"hidden":true,"options":{"layout":"list","enableCreate":false,"enableSelect":true,"limit":15,"junctionFieldLocation":"bottom","allowDuplicates":false,"enableSearchFilter":false,"enableLink":false}},{"name":"Require when permission type is roles","rule":{"_and":[{"permission_type":{"_eq":"roles"}}]},"required":true,"options":{"layout":"list","enableCreate":false,"enableSelect":true,"limit":15,"junctionFieldLocation":"bottom","allowDuplicates":false,"enableSearchFilter":false,"enableLink":false}}]',FALSE,NULL,NULL,NULL),
      ('raster_tiles','visible','cast-boolean','boolean','{"label":"True"}',NULL,NULL,FALSE,FALSE,NULL,'full',NULL,NULL,NULL,TRUE,NULL,NULL,NULL),
      ('raster_tiles_directus_roles','id',NULL,NULL,NULL,NULL,NULL,FALSE,TRUE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('raster_tiles_directus_roles','raster_tiles_layer_id',NULL,NULL,NULL,NULL,NULL,FALSE,TRUE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('raster_tiles_directus_roles','directus_roles_id',NULL,NULL,NULL,NULL,NULL,FALSE,TRUE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL);

    INSERT INTO directus_relations(many_collection,many_field,one_collection,one_field,one_collection_field,one_allowed_collections,junction_field,sort_field,one_deselect_action)
    VALUES
      ('raster_tiles','user_created','directus_users',NULL,NULL,NULL,NULL,NULL,'nullify'),
      ('raster_tiles','user_updated','directus_users',NULL,NULL,NULL,NULL,NULL,'nullify'),
      ('raster_tiles','category','categories',NULL,NULL,NULL,NULL,NULL,'nullify'),
      ('raster_tiles','preview','directus_files',NULL,NULL,NULL,NULL,NULL,'nullify'),
      ('raster_tiles_directus_roles','directus_roles_id','directus_roles',NULL,NULL,NULL,'raster_tiles_layer_id',NULL,'nullify'),
      ('raster_tiles_directus_roles','raster_tiles_layer_id','raster_tiles','allowed_roles',NULL,NULL,'directus_roles_id',NULL,'delete');
  `);
}

export async function down(knex) {
  await knex.raw(`
    DELETE FROM directus_relations WHERE many_collection IN ('raster_tiles','raster_tiles_directus_roles');

    DELETE FROM directus_fields WHERE collection IN ('raster_tiles','raster_tiles_directus_roles');

    DELETE FROM directus_collections WHERE collection IN ('raster_tiles','raster_tiles_directus_roles');

    DROP TABLE IF EXISTS raster_tiles_directus_roles;

    DROP TABLE IF EXISTS raster_tiles;
  `);
}
