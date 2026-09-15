export async function up(knex) {
  await knex.raw(`
    INSERT INTO directus_collections(collection,icon,color)
    VALUES ('layer_configuration','settings_suggest','#FFA439');

    CREATE TABLE IF NOT EXISTS categories
    (
      category_id uuid NOT NULL PRIMARY KEY,
      user_created uuid REFERENCES directus_users (id),
      date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
      user_updated uuid REFERENCES directus_users (id),
      date_updated timestamp with time zone,
      category_name character varying(255) NOT NULL,
      description text,
      contributor character varying(255),
      parent uuid REFERENCES categories (category_id)
        ON DELETE SET NULL
    );

    INSERT INTO directus_collections(collection,icon,color,"group")
    VALUES ('categories','category','#FFA439','layer_configuration');

    INSERT INTO directus_fields(collection,field,special,interface,options,display,display_options,readonly,hidden,width,required)
    VALUES
      ('categories','category_id','uuid','input',NULL,NULL,NULL,TRUE,TRUE,'full',FALSE),
      ('categories','user_created','user-created','select-dropdown-m2o','{"template":"{{avatar.$thumbnail}} {{first_name}} {{last_name}}"}','user',NULL,TRUE,TRUE,'half',FALSE),
      ('categories','date_created','date-created','datetime',NULL,'datetime','{"relative":true}',TRUE,TRUE,'half',FALSE),
      ('categories','user_updated','user-updated','select-dropdown-m2o','{"template":"{{avatar.$thumbnail}} {{first_name}} {{last_name}}"}','user',NULL,TRUE,TRUE,'half',FALSE),
      ('categories','date_updated','date-updated','datetime',NULL,'datetime','{"relative":true}',TRUE,TRUE,'half',FALSE),
      ('categories','category_name',NULL,'input',NULL,NULL,NULL,FALSE,FALSE,'full',TRUE),
      ('categories','description',NULL,'input',NULL,NULL,NULL,FALSE,FALSE,'full',FALSE),
      ('categories','contributor',NULL,'input',NULL,NULL,NULL,FALSE,FALSE,'full',FALSE),
      ('categories','parent','m2o','select-dropdown-m2o','{"template":"{{category_name}}"}','related-values','{"template":"{{category_name}}"}',FALSE,FALSE,'full',FALSE),
      ('categories','subcategories','o2m','list-o2m-tree-view','{"displayTemplate":"{{category_name}}"}','related-values','{"template":"{{category_name}}"}',FALSE,FALSE,'full',FALSE);

    INSERT INTO directus_relations(many_collection,many_field,one_collection,one_field,one_collection_field,one_allowed_collections,junction_field,sort_field,one_deselect_action)
    VALUES
      ('categories','user_created','directus_users',NULL,NULL,NULL,NULL,NULL,'nullify'),
      ('categories','user_updated','directus_users',NULL,NULL,NULL,NULL,NULL,'nullify'),
      ('categories','parent','categories','subcategories',NULL,NULL,NULL,NULL,'nullify');
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS categories;

    DELETE FROM directus_collections WHERE collection = 'categories';

    DELETE FROM directus_fields WHERE collection = 'categories';

    DELETE FROM directus_relations WHERE many_collection = 'categories';

    DELETE FROM directus_collections WHERE collection = 'layer_configuration';
  `);
}
