import {
  PUBLIC_FOLDER_ID,
  LAYER_DATA_FOLDER_ID,
  LAYER_PREVIEWS_FOLDER_ID,
} from "./const/FOLDER_IDS.mjs";

export async function up(knex) {
  await knex.raw(`
    INSERT INTO directus_permissions(collection,action,permissions,validation,fields)
    VALUES
      ('directus_settings','read','{}','{}','project_name,project_descriptor,public_favicon,basemaps,help_center_url,project_logo_horizontal,public_background'),
      ('directus_files','read','{"_or":[{"folder":{"_eq":"${PUBLIC_FOLDER_ID}"}},{"folder":{"parent":{"_eq":"${PUBLIC_FOLDER_ID}"}}}]}','{}','*'),
      ('vector_tiles','read','{"_and":[{"permission_type":{"_eq":"roles+public"}},{"listed":{"_eq":true}},{"listed":{"_eq":true}}]}','{}','layer_id,layer_name,geometry_type,bounds,minzoom,maxzoom,layer_alias,preview,description,category,hover_popup_columns,click_popup_columns,image_columns,active,fill_style,line_style,circle_style,symbol_style'),
      ('symbol','read','{}','{}','*'),
      ('raster_tiles','read','{"_and":[{"permission_type":{"_eq":"roles+public"}},{"listed":{"_eq":true}}]}','{}','layer_id,bounds,minzoom,maxzoom,terrain_rgb,layer_alias,preview,description,category,active,visible'),
      ('raster_overlays','read','{"_and":[{"permission_type":{"_eq":"roles+public"}},{"listed":{"_eq":true}}]}','{}','layer_id,bounds,image,legend_image,layer_alias,category,active,visible'),
      ('line','read','{}','{}','*'),
      ('fill','read','{}','{}','*'),
      ('external_tiles','read','{"_and":[{"permission_type":{"_eq":"roles+public"}},{"listed":{"_eq":true}}]}','{}','layer_id,tile_type,is_tilejson,tilejson_url,tile_url,layer_style_url,bounds,minzoom,maxzoom,tile_size,layer_alias,category,active,visible'),
      ('circle','read','{}','{}','*'),
      ('categories','read','{}','{}','*'),
      ('three_d_tiles','read','{"_and":[{"permission_type":{"_eq":"roles+public"}},{"listed":{"_eq":true}}]}','{}','layer_id,layer_alias,preview,description,category,active,visible,opacity,point_size,point_color'),
      ('block_hero_slides','read','{}','{}','*'),
      ('block_hero_slides_contents','read','{}','{}','*'),
      ('block_hero_slides_block_hero_slides_contents','read','{}','{}','*'),
      ('home','read','{}','{}','*'),
      ('home_blocks','read','{}','{}','*'),
      ('block_hero_single','read','{}','{}','*'),
      ('block_info_single','read','{}','{}','*'),
      ('block_info_slides','read','{}','{}','*'),
      ('block_info_slides_contents','read','{}','{}','*'),
      ('block_info_slides_block_info_slides_contents','read','{}','{}','*'),
      ('block_info_accordion','read','{}','{}','*'),
      ('block_info_accordion_contents','read','{}','{}','*'),
      ('block_info_accordion_block_info_accordion_contents','read','{}','{}','*'),
      ('block_media_video','read','{}','{}','*'),
      ('block_media_icons','read','{}','{}','*'),
      ('block_media_icons_contents','read','{}','{}','*'),
      ('block_media_icons_block_media_icons_contents','read','{}','{}','*'),
      ('block_cta','read','{}','{}','*'),
      ('block_footer','read','{}','{}','*'),
      ('map','read','{}','{}','lang,information,information_attachments,title,subtitle,initial_map_view'),
      ('shared_map','read','{}','{}','*');

    CREATE OR REPLACE FUNCTION handle_non_admin_non_app_directus_roles_insert()
      RETURNS trigger
      LANGUAGE 'plpgsql'
    AS $BODY$
      BEGIN
        INSERT INTO directus_permissions(role,collection,action,permissions,validation,fields)
        VALUES
          (NEW.id,'directus_settings','read','{}','{}','project_name,project_descriptor,public_favicon,project_logo_horizontal,basemaps,initial_map_view,help_center_url,public_background'),
          (NEW.id,'directus_files','read','{"_or":[{"folder":{"_eq":"${PUBLIC_FOLDER_ID}"}},{"folder":{"parent":{"_eq":"${PUBLIC_FOLDER_ID}"}}}]}','{}','*'),
          (NEW.id,'vector_tiles','read','{"_and":[{"permission_type":{"_in":["roles","roles+public"]}},{"allowed_roles":{"directus_roles_id":{"_eq":"$CURRENT_ROLE"}}},{"listed":{"_eq":true}}]}','{}','layer_id,layer_name,geometry_type,bounds,minzoom,maxzoom,layer_alias,preview,description,category,hover_popup_columns,click_popup_columns,image_columns,active,fill_style,line_style,circle_style,symbol_style'),
          (NEW.id,'symbol','read','{}','{}','*'),
          (NEW.id,'raster_tiles','read','{"_and":[{"permission_type":{"_in":["roles","roles+public"]}},{"allowed_roles":{"directus_roles_id":{"_eq":"$CURRENT_ROLE"}}},{"listed":{"_eq":true}}]}','{}','layer_id,bounds,minzoom,maxzoom,terrain_rgb,layer_alias,preview,description,category,active,visible'),
          (NEW.id,'raster_overlays','read','{"_and":[{"permission_type":{"_in":["roles","roles+public"]}},{"allowed_roles":{"directus_roles_id":{"_eq":"$CURRENT_ROLE"}}},{"listed":{"_eq":true}}]}','{}','layer_id,bounds,image,legend_image,layer_alias,category,active,visible'),
          (NEW.id,'line','read','{}','{}','*'),
          (NEW.id,'fill','read','{}','{}','*'),
          (NEW.id,'external_tiles','read','{"_and":[{"permission_type":{"_in":["roles","roles+public"]}},{"allowed_roles":{"directus_roles_id":{"_eq":"$CURRENT_ROLE"}}},{"listed":{"_eq":true}}]}','{}','layer_id,tile_type,is_tilejson,tilejson_url,tile_url,layer_style_url,bounds,minzoom,maxzoom,tile_size,layer_alias,category,active,visible'),
          (NEW.id,'circle','read','{}','{}','*'),
          (NEW.id,'categories','read','{}','{}','*'),
          (NEW.id,'three_d_tiles','read','{"_and":[{"permission_type":{"_in":["roles","roles+public"]}},{"allowed_roles":{"directus_roles_id":{"_eq":"$CURRENT_ROLE"}}},{"listed":{"_eq":true}}]}','{}','layer_id,layer_alias,preview,description,category,active,visible,opacity,point_size,point_color'),
          (NEW.id,'shared_map','create','{}','{}','*'),
          (NEW.id,'directus_files','create','{}','{"_and":[{"folder":{"_in":["${LAYER_DATA_FOLDER_ID}","${LAYER_PREVIEWS_FOLDER_ID}"]}}]}','*'),
          (NEW.id,'geoprocessing_queue','read','{"_and":[{"uploader":{"_eq":"$CURRENT_USER"}}]}','{}','result,state,filename,status,mtime,result_ttl');
        RETURN NULL;
      END;
    $BODY$;

    CREATE OR REPLACE TRIGGER on_non_admin_non_app_directus_roles_insert
    AFTER INSERT ON directus_roles
    FOR EACH ROW
    WHEN (NEW.admin_access = FALSE AND NEW.app_access = FALSE)
    EXECUTE FUNCTION handle_non_admin_non_app_directus_roles_insert();
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS on_non_admin_non_app_directus_roles_insert ON directus_roles;
    DROP FUNCTION IF EXISTS handle_non_admin_non_app_directus_roles_insert();

    DELETE FROM directus_permissions WHERE collection IN ('directus_settings','directus_files','vector_tiles','symbol','raster_tiles','raster_overlays','line','fill','external_tiles','circle','categories','three_d_tiles','block_hero_slides','block_hero_slides_contents','block_hero_slides_block_hero_slides_contents','home','home_blocks','block_hero_single','block_info_single','block_info_slides','block_info_slides_contents','block_info_slides_block_info_slides_contents','block_info_accordion','block_info_accordion_contents','block_info_accordion_block_info_accordion_contents','block_media_video','block_media_icons','block_media_icons_contents','block_media_icons_block_media_icons_contents','block_cta','block_footer','map','shared_map') AND role IS NULL AND action = 'read';
  `);
}
