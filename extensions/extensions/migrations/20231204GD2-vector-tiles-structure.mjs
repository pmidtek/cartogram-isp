import {
  LAYER_PREVIEWS_FOLDER_ID,
  PUBLIC_FOLDER_ID,
} from "./const/FOLDER_IDS.mjs";

export async function up(knex) {
  await knex.raw(`
    INSERT INTO directus_folders(id,name,parent)
    VALUES ('${LAYER_PREVIEWS_FOLDER_ID}','Layer Previews','${PUBLIC_FOLDER_ID}');

    CREATE TABLE IF NOT EXISTS vector_tiles
    (
      layer_id uuid NOT NULL PRIMARY KEY,
      layer_name character varying(255) NOT NULL,
      user_created uuid REFERENCES directus_users (id),
      date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
      user_updated uuid REFERENCES directus_users (id),
      date_updated timestamp with time zone,
      geometry_type character varying(255) NOT NULL,
      bounds json NOT NULL,
      minzoom integer,
      maxzoom integer,
      layer_alias character varying(255),
      preview uuid REFERENCES directus_files (id)
        ON DELETE SET NULL,
      description text,
      category uuid REFERENCES categories (category_id)
        ON DELETE SET NULL,
      hover_popup_columns text,
      click_popup_columns text,
      image_columns text,
      feature_detail_template text,
      feature_detail_attachments json,
      listed boolean DEFAULT false NOT NULL,
      active boolean DEFAULT false NOT NULL,
      cache_duration integer DEFAULT 0 NOT NULL,
      permission_type character varying(255) DEFAULT 'admin' NOT NULL,
      fill_style integer REFERENCES fill (id)
        ON DELETE SET NULL,
      line_style integer REFERENCES line (id)
        ON DELETE SET NULL,
      circle_style integer REFERENCES circle (id)
        ON DELETE SET NULL,
      symbol_style integer REFERENCES symbol (id)
        ON DELETE SET NULL,
      fill_class_columns text,
      line_class_columns text,
      circle_class_columns text,
      symbol_class_columns text
    );

    INSERT INTO directus_collections(collection,icon,color,"group",collapse)
    VALUES ('vector_tiles','list_alt','#FFA439','layer_configuration',TRUE);

    CREATE TABLE IF NOT EXISTS vector_tiles_directus_roles
    (
      id serial NOT NULL PRIMARY KEY,
      vector_tiles_layer_id uuid REFERENCES vector_tiles (layer_id)
        ON DELETE CASCADE,
      directus_roles_id uuid REFERENCES directus_roles (id)
        ON DELETE CASCADE
    );

    INSERT INTO directus_collections(collection,"group",hidden)
    VALUES ('vector_tiles_directus_roles','vector_tiles',TRUE);

    INSERT INTO directus_fields(collection,field,special,interface,options,display,display_options,readonly,hidden,sort,width,translations,note,conditions,required,"group",validation,validation_message)
    VALUES
      ('vector_tiles','layer_id','uuid','input',NULL,NULL,NULL,TRUE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','layer_name',NULL,'input',NULL,NULL,NULL,TRUE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','user_created','user-created','select-dropdown-m2o','{"template":"{{avatar.$thumbnail}} {{first_name}} {{last_name}}"}','user',NULL,TRUE,FALSE,NULL,'half',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','date_created','date-created','datetime',NULL,'datetime','{"relative":true}',TRUE,FALSE,NULL,'half',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','user_updated','user-updated','select-dropdown-m2o','{"template":"{{avatar.$thumbnail}} {{first_name}} {{last_name}}"}','user',NULL,TRUE,FALSE,NULL,'half',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','date_updated','date-updated','datetime',NULL,'datetime','{"relative":true}',TRUE,FALSE,NULL,'half',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','geometry_type',NULL,'input',NULL,NULL,NULL,TRUE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','bounds',NULL,'map',NULL,NULL,NULL,TRUE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','minzoom',NULL,'input',NULL,NULL,NULL,FALSE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','maxzoom',NULL,'input',NULL,NULL,NULL,FALSE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','layer_alias',NULL,'input',NULL,NULL,NULL,FALSE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','preview','file','file-image','{"folder":"${LAYER_PREVIEWS_FOLDER_ID}"}',NULL,NULL,FALSE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','description',NULL,'input-multiline',NULL,NULL,NULL,false,false,NULL,'full',NULL,NULL,NULL,false,NULL,NULL,NULL),
      ('vector_tiles','category','m2o','select-dropdown-m2o','{"template":"{{category_name}}"}','related-values','{"template":"{{category_name}}"}',FALSE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','hover_popup_columns','cast-csv','select-multiple-checkbox','{"allowOther":true,"choices":[{"text":"ogc_fid","value":"ogc_fid"}]}',NULL,NULL,FALSE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','click_popup_columns','cast-csv','select-multiple-checkbox','{"allowOther":true,"choices":[{"text":"ogc_fid","value":"ogc_fid"}]}',NULL,NULL,FALSE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','image_columns','cast-csv','select-multiple-checkbox','{"allowOther":true,"choices":[{"text":"ogc_fid","value":"ogc_fid"}]}',NULL,NULL,FALSE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','feature_detail_template',NULL,'input-rich-text-md','{"folder":"${PUBLIC_FOLDER_ID}","placeholder":"Markdown template for feature detail. Use {{ column }} to show column data\\n\\nExample:\\n- Column A: {{ column_a }}\\n- Column B: {{ column_b }}"}',NULL,NULL,FALSE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','feature_detail_attachments','cast-json','list','{"fields":[{"field":"title","name":"title","type":"string","meta":{"field":"title","width":"half","type":"string","required":true,"interface":"input"}},{"field":"description","name":"description","type":"string","meta":{"field":"description","width":"half","type":"string","required":true,"interface":"input"}},{"field":"url_column","name":"url_column","type":"string","meta":{"field":"url_column","width":"half","type":"string","required":true,"note":"Column which will be used as attachment URL source","interface":"input"}},{"field":"icon","name":"icon","type":"string","meta":{"field":"icon","width":"half","type":"string","required":true,"interface":"select-dropdown","options":{"choices":[{"text":"Link","value":"link"},{"text":"Form","value":"form"}]}}}]}',NULL,NULL,FALSE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','listed','cast-boolean','boolean','{"label":"True"}',NULL,NULL,FALSE,FALSE,NULL,'half',NULL,NULL,NULL,TRUE,NULL,NULL,NULL),
      ('vector_tiles','active','cast-boolean','boolean','{"label":"True"}',NULL,NULL,FALSE,FALSE,NULL,'half',NULL,NULL,NULL,TRUE,NULL,NULL,NULL),
      ('vector_tiles','cache_duration',NULL,'slider','{"stepInterval":1,"alwaysShowValue":true}',NULL,NULL,FALSE,FALSE,NULL,'full',NULL,NULL,NULL,TRUE,NULL,NULL,NULL),
      ('vector_tiles','permission_type',NULL,'select-dropdown','{"choices":[{"text":"Admin Only","value":"admin"},{"text":"Selected Roles","value":"roles"},{"text":"Selected Roles + Public","value":"roles+public"}]}',NULL,NULL,FALSE,FALSE,NULL,'half',NULL,NULL,NULL,TRUE,NULL,NULL,NULL),
      ('vector_tiles','allowed_roles','m2m','list-m2m','{"enableCreate":false,"filter":{"_and":[{"admin_access":{"_eq":false}}]},"template":"{{directus_roles_id.name}}"}',NULL,NULL,FALSE,FALSE,NULL,'half',NULL,NULL,'[{"name":"Hide if permission type is admin","rule":{"_and":[{"permission_type":{"_eq":"admin"}}]},"hidden":true,"options":{"layout":"list","enableCreate":false,"enableSelect":true,"limit":15,"junctionFieldLocation":"bottom","allowDuplicates":false,"enableSearchFilter":false,"enableLink":false}},{"name":"Require when permission type is roles","rule":{"_and":[{"permission_type":{"_eq":"roles"}}]},"required":true,"options":{"layout":"list","enableCreate":false,"enableSelect":true,"limit":15,"junctionFieldLocation":"bottom","allowDuplicates":false,"enableSearchFilter":false,"enableLink":false}}]',FALSE,NULL,NULL,NULL),
      ('vector_tiles','fill_style','m2o','select-dropdown-m2o','{"template":"{{name}}"}','related-values','{"template":"{{name}}"}',FALSE,FALSE,NULL,'full',NULL,NULL,'[{"name":"No LINESTRING and POINT","rule":{"_or":[{"geometry_type":{"_contains":"LINESTRING"}},{"geometry_type":{"_contains":"POINT"}}]},"hidden":true}]',FALSE,NULL,NULL,NULL),
      ('vector_tiles','line_style','m2o','select-dropdown-m2o','{"template":"{{name}}"}','related-values','{"template":"{{name}}"}',FALSE,FALSE,NULL,'full',NULL,NULL,'[{"name":"No POINT","rule":{"geometry_type":{"_contains":"POINT"}},"hidden":true}]',FALSE,NULL,NULL,NULL),
      ('vector_tiles','circle_style','m2o','select-dropdown-m2o','{"template":"{{name}}"}','related-values','{"template":"{{name}}"}',FALSE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','symbol_style','m2o','select-dropdown-m2o','{"template":"{{name}}"}','related-values','{"template":"{{name}}"}',FALSE,FALSE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','fill_class_columns',NULL,'input',NULL,NULL,NULL,TRUE,TRUE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','line_class_columns',NULL,'input',NULL,NULL,NULL,TRUE,TRUE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','circle_class_columns',NULL,'input',NULL,NULL,NULL,TRUE,TRUE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles','symbol_class_columns',NULL,'input',NULL,NULL,NULL,TRUE,TRUE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles_directus_roles','id',NULL,NULL,NULL,NULL,NULL,FALSE,TRUE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles_directus_roles','vector_tiles_layer_id',NULL,NULL,NULL,NULL,NULL,FALSE,TRUE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL),
      ('vector_tiles_directus_roles','directus_roles_id',NULL,NULL,NULL,NULL,NULL,FALSE,TRUE,NULL,'full',NULL,NULL,NULL,FALSE,NULL,NULL,NULL);

    INSERT INTO directus_relations(many_collection,many_field,one_collection,one_field,one_collection_field,one_allowed_collections,junction_field,sort_field,one_deselect_action)
    VALUES
      ('vector_tiles','user_created','directus_users',NULL,NULL,NULL,NULL,NULL,'nullify'),
      ('vector_tiles','user_updated','directus_users',NULL,NULL,NULL,NULL,NULL,'nullify'),
      ('vector_tiles','preview','directus_files',NULL,NULL,NULL,NULL,NULL,'nullify'),
      ('vector_tiles','category','categories',NULL,NULL,NULL,NULL,NULL,'nullify'),
      ('vector_tiles','fill_style','fill',NULL,NULL,NULL,NULL,NULL,'nullify'),
      ('vector_tiles','line_style','line',NULL,NULL,NULL,NULL,NULL,'nullify'),
      ('vector_tiles','circle_style','circle',NULL,NULL,NULL,NULL,NULL,'nullify'),
      ('vector_tiles','symbol_style','symbol',NULL,NULL,NULL,NULL,NULL,'nullify'),
      ('vector_tiles_directus_roles','directus_roles_id','directus_roles',NULL,NULL,NULL,'vector_tiles_layer_id',NULL,'nullify'),
      ('vector_tiles_directus_roles','vector_tiles_layer_id','vector_tiles','allowed_roles',NULL,NULL,'directus_roles_id',NULL,'delete');
  `);
}

export async function down(knex) {
  await knex.raw(`
    DELETE FROM directus_relations WHERE many_collection IN ('vector_tiles','vector_tiles_directus_roles');

    DELETE FROM directus_fields WHERE collection IN ('vector_tiles','vector_tiles_directus_roles');

    DELETE FROM directus_collections WHERE collection IN ('vector_tiles','vector_tiles_directus_roles');

    DROP TABLE IF EXISTS vector_tiles_directus_roles;

    DROP TABLE IF EXISTS vector_tiles;

    DELETE FROM directus_folders WHERE id = '${LAYER_PREVIEWS_FOLDER_ID}';
  `);
}
