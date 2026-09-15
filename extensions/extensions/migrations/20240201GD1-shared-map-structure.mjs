export async function up(knex) {
  await knex.raw(`
      CREATE TABLE public.shared_map (
          id uuid NOT NULL,
          user_created uuid NULL,
          date_created timestamptz NULL,
          map_state json NULL,
          CONSTRAINT shared_map_pkey PRIMARY KEY (id),
          CONSTRAINT shared_map_user_created_foreign FOREIGN KEY (user_created) REFERENCES public.directus_users(id)
      );
      
      INSERT INTO directus_collections(collection,icon)
      VALUES ('shared_map','share');
  
      INSERT INTO directus_fields(collection,field,special,interface,options,display,display_options,readonly,hidden,width,required)
      VALUES
        ('shared_map','id','uuid','input',NULL,NULL,NULL,TRUE,TRUE,'full',FALSE),
        ('shared_map','user_created','user-created','select-dropdown-m2o','{"template":"{{avatar.$thumbnail}} {{first_name}} {{last_name}}"}','user',NULL,TRUE,TRUE,'half',FALSE),
        ('shared_map','date_created','date-created','datetime',NULL,'datetime','{"relative":true}',TRUE,TRUE,'half',FALSE),
        ('shared_map','map_state','cast-json','input-code','{"language":"JSON","lineWrapping":true}',NULL,NULL,FALSE,FALSE,'full',FALSE);
  
      INSERT INTO directus_relations(many_collection,many_field,one_collection,one_field,one_collection_field,one_allowed_collections,junction_field,sort_field,one_deselect_action)
      VALUES
        ('shared_map','user_created','directus_users',NULL,NULL,NULL,NULL,NULL,'nullify');
    `);
}

export async function down(knex) {
  await knex.raw(`
        DELETE FROM directus_relations WHERE many_collection = 'shared_map';
        DELETE FROM directus_fields WHERE collection = 'shared_map';
        DELETE FROM directus_collections WHERE collection = 'shared_map';
        DROP TABLE IF EXISTS shared_map;
      `);
}
