import {
  BIM_DATA_FOLDER_ID,
  LAYER_DATA_FOLDER_ID,
  LAYER_ICONS_FOLDER_ID,
} from "./const/FOLDER_IDS.mjs";

export async function up(knex) {
  await knex.raw(`
  CREATE OR REPLACE FUNCTION handle_directus_files_layer_data_ready()
  RETURNS TRIGGER AS $$
  DECLARE
      folder_name varchar(255);
      v_uuid UUID;
      v_now TIMESTAMP WITH TIME ZONE;
      v_timestamp BIGINT;
      actor_name TEXT;
      terrain_rgb_enabled boolean;
      three_d_tiling_enabled boolean;
  BEGIN
      -- Get worker configuration
      SELECT terrain_rgb_worker, three_d_tiling_worker INTO terrain_rgb_enabled, three_d_tiling_enabled
      FROM directus_settings;

      IF NOT FOUND THEN
          terrain_rgb_enabled := FALSE;
          three_d_tiling_enabled := FALSE;
      END IF;

      -- Generate a random UUID
      v_uuid := gen_random_uuid();

      -- Get current timestamp
      v_now := NOW();

      -- Convert the current timestamp to milliseconds
      v_timestamp := EXTRACT(EPOCH FROM v_now) * 1000;

      -- Set worker or actor name
      IF NEW.format_file = 'tif' THEN
          IF NEW.is_terrain = TRUE AND terrain_rgb_enabled = FALSE THEN
              RAISE EXCEPTION 'Terrain RGB worker is not enabled';
          END IF;
          actor_name := 'tiling';
      ELSIF NEW.format_file = 'las/laz' THEN
          IF three_d_tiling_enabled = FALSE THEN
              RAISE EXCEPTION '3D tiling worker is not enabled';
          END IF;
          actor_name := 'three_d_tiling';
      ELSE
          actor_name := 'transform';
          IF NEW.table_name IS NULL THEN
              NEW.table_name := 'upload_' || REPLACE(gen_random_uuid()::text,'-','');
          END IF;
      END IF;

      -- Perform the insertion
      INSERT INTO geoprocessing_queue(
          message_id,
          queue_name,
          state,
          mtime,
          message,
          uploader,
          filename
      )
      VALUES (
          v_uuid,
          'default',
          'queued',
          v_now,
          jsonb_build_object(
              'args', jsonb_build_array(),
              'kwargs', jsonb_build_object(
                  'object_key', NEW.filename_disk,
                  'table_name', NEW.table_name,
                  'uploader', NEW.uploaded_by,
                  'format_file', NEW.format_file,
                  'is_zipped', NEW.is_zipped,
                  'raster_alias', NEW.raster_alias,
                  'minzoom', NEW.minzoom,
                  'maxzoom', NEW.maxzoom,
                  'is_terrain', NEW.is_terrain,
                  'three_d_alias', NEW.three_d_alias,
                  'has_color', NEW.has_color,
                  'additional_config', NEW.additional_config
              ),
              'options', jsonb_build_object(),
              'actor_name', actor_name,
              'message_id', v_uuid::text,
              'queue_name', 'default',
              'message_timestamp', v_timestamp::text
          ),
          NEW.uploaded_by,
          NEW.filename_download
      );

      RETURN NULL;
  END;
  $$ LANGUAGE plpgsql;

  CREATE OR REPLACE TRIGGER on_directus_files_layer_data_ready
  AFTER UPDATE ON directus_files
  FOR EACH ROW
  WHEN (NEW.folder = '${LAYER_DATA_FOLDER_ID}' AND NEW.is_ready IS TRUE)
  EXECUTE FUNCTION handle_directus_files_layer_data_ready();

  CREATE OR REPLACE FUNCTION handle_geoprocessing_queue_insert()
  RETURNS TRIGGER AS $$
  DECLARE
      notify_payload jsonb;
  BEGIN
      IF octet_length(NEW.message::text) >= 8000 THEN
          notify_payload := jsonb_build_object('message_id', NEW.message_id)::text;
      ELSE
          notify_payload := NEW.message::text;
      END IF;

      PERFORM pg_notify('dramatiq.' || NEW.queue_name || '.enqueue', notify_payload::text);
      RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  CREATE OR REPLACE TRIGGER on_geoprocessing_queue_insert
  AFTER INSERT ON geoprocessing_queue
  FOR EACH ROW
  EXECUTE FUNCTION handle_geoprocessing_queue_insert();

  CREATE OR REPLACE FUNCTION handle_geoprocessing_queue_result_update()
    RETURNS trigger
    LANGUAGE 'plpgsql'
  AS $BODY$
    BEGIN
      IF NEW.result \\? 'error' THEN
        NEW.status = 'error';
      ELSE
        NEW.status = 'success';
      END IF;
      RETURN NEW;
    END;
  $BODY$;

  CREATE OR REPLACE TRIGGER on_geoprocessing_queue_result_update
  BEFORE UPDATE OF result ON geoprocessing_queue
  FOR EACH ROW
  WHEN (NEW.result IS NOT NULL)
  EXECUTE FUNCTION handle_geoprocessing_queue_result_update();

  CREATE OR REPLACE FUNCTION handle_directus_files_layer_icons_upload()
    RETURNS trigger
    LANGUAGE 'plpgsql'
  AS $BODY$
    DECLARE
      queue_id uuid;
      processed_files jsonb;
    BEGIN
      -- Check if there's unprocessed job
      SELECT id, additional_info INTO queue_id, processed_files
      FROM other_processing_queue
      WHERE status = 'queued'
      AND task = 'generateSprites'
      ORDER BY date_created DESC
      LIMIT 1;

      IF queue_id IS NOT NULL THEN
        processed_files := jsonb_set(processed_files, ARRAY['add'], COALESCE(processed_files -> 'add', '[]'::jsonb) || jsonb_build_array(NEW.filename_download), TRUE);

        UPDATE other_processing_queue
        SET date_created = CURRENT_TIMESTAMP,
          additional_info = processed_files
        WHERE id = queue_id;
      ELSE
        queue_id := gen_random_uuid();
        processed_files := jsonb_build_object('add', ARRAY[NEW.filename_download]);

        INSERT INTO other_processing_queue(id, task, payload, additional_info)
        VALUES (queue_id, 'generateSprites', jsonb_build_object('queueId', queue_id), processed_files);
      END IF;

      -- Use same key and delay to throttle process when user uploads multiple icons 
      PERFORM graphile_worker.add_job('generateSprites', json_build_object('queueId', queue_id), run_at := CURRENT_TIMESTAMP + INTERVAL '10', job_key := 'generateSprites');
      RETURN NULL;
    END;
  $BODY$;

  CREATE OR REPLACE TRIGGER on_directus_files_layer_icons_upload
    AFTER UPDATE 
    ON directus_files
    FOR EACH ROW
    WHEN (NEW.folder = '${LAYER_ICONS_FOLDER_ID}' AND NEW.type = 'image/svg+xml')
    EXECUTE FUNCTION handle_directus_files_layer_icons_upload();

  CREATE OR REPLACE FUNCTION handle_directus_files_layer_icons_delete()
    RETURNS trigger
    LANGUAGE 'plpgsql'
  AS $BODY$
    DECLARE
      queue_id uuid;
      processed_files jsonb;
    BEGIN
      -- Check if there's unprocessed job
      SELECT id, additional_info INTO queue_id, processed_files
      FROM other_processing_queue
      WHERE status = 'queued'
      AND task = 'generateSprites'
      ORDER BY date_created DESC
      LIMIT 1;

      IF queue_id IS NOT NULL THEN
        processed_files := jsonb_set(processed_files, ARRAY['remove'], COALESCE(processed_files -> 'remove', '[]'::jsonb) || jsonb_build_array(OLD.filename_download), TRUE);

        UPDATE other_processing_queue
        SET date_created = CURRENT_TIMESTAMP,
          additional_info = processed_files
        WHERE id = queue_id;
      ELSE
        queue_id := gen_random_uuid();
        processed_files := jsonb_build_object('remove', ARRAY[OLD.filename_download]);

        INSERT INTO other_processing_queue(id, task, payload, additional_info)
        VALUES (queue_id, 'generateSprites', jsonb_build_object('queueId', queue_id), processed_files);
      END IF;

      -- Use same key and delay to throttle process when user deletes multiple icons 
      PERFORM graphile_worker.add_job('generateSprites', json_build_object('queueId', queue_id), run_at := CURRENT_TIMESTAMP + INTERVAL '10', job_key := 'generateSprites');
      RETURN NULL;
    END;
  $BODY$;

  CREATE OR REPLACE TRIGGER on_directus_files_layer_icons_delete
    AFTER DELETE
    ON directus_files
    FOR EACH ROW
    WHEN (OLD.folder = '${LAYER_ICONS_FOLDER_ID}' AND OLD.type = 'image/svg+xml')
    EXECUTE FUNCTION handle_directus_files_layer_icons_delete();

  CREATE OR REPLACE FUNCTION handle_directus_files_bim_data_ready()
    RETURNS trigger
    LANGUAGE 'plpgsql'
  AS $BODY$
    DECLARE
      worker_enabled boolean;
      queue_id uuid;
    BEGIN
      SELECT convert_to_xkt_worker INTO STRICT worker_enabled
      FROM directus_settings;

      IF worker_enabled = FALSE THEN
        RAISE EXCEPTION 'Convert to XKT worker is not enabled';
      END IF;

      queue_id := gen_random_uuid();

      INSERT INTO other_processing_queue(id, task, payload)
      VALUES (queue_id, 'convertToXkt', jsonb_build_object('objectKey', NEW.filename_disk, 'uploader', NEW.uploaded_by, 'queueId', queue_id));

      PERFORM graphile_worker.add_job('convertToXkt', json_build_object('objectKey', NEW.filename_disk, 'uploader', NEW.uploaded_by, 'queueId', queue_id));
      RETURN NULL;
    END;
  $BODY$;

  CREATE OR REPLACE TRIGGER on_directus_files_bim_data_ready
    AFTER UPDATE 
    ON directus_files
    FOR EACH ROW
    WHEN (NEW.folder = '${BIM_DATA_FOLDER_ID}' AND NEW.is_ready IS TRUE)
    EXECUTE FUNCTION handle_directus_files_bim_data_ready();
`);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS on_directus_files_bim_data_ready ON directus_files;
    DROP FUNCTION IF EXISTS handle_directus_files_bim_data_ready();

    DROP TRIGGER IF EXISTS on_directus_files_layer_icons_delete ON directus_files;
    DROP FUNCTION IF EXISTS handle_directus_files_layer_icons_delete();

    DROP TRIGGER IF EXISTS on_directus_files_layer_icons_upload ON directus_files;
    DROP FUNCTION IF EXISTS handle_directus_files_layer_icons_upload();

    DROP TRIGGER IF EXISTS on_geoprocessing_queue_insert ON geoprocessing_queue;
    DROP FUNCTION IF EXISTS handle_geoprocessing_queue_insert();

    DROP TRIGGER IF EXISTS on_directus_files_layer_data_ready ON directus_files;
    DROP FUNCTION IF EXISTS handle_directus_files_layer_data_ready();
  `);
}
