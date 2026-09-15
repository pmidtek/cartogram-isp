worker/task manager here


===

OLD

===

# Geodashboard Worker Migration

Untuk proyek yang belum berjalan, nanti disediakan branch pada geodashboard yang menggunakan worker versi baru, dan databse backup untuk inisiasi awal

Untuk proyek yang telah berjalan, langkah-langkahnya adalah sebagai berikut:

### Preparation Steps

1. Login ke panel Directus pada proyek turunan Geodashboard

2. Buat folder “Spatial” pada directus files

3. Buat folder “Raster” di dalam folder “Spatial” pada directus files

4. Pada Setting → Directus Data Model, buat folder “Spatial_Data” untuk mengelompokkan hasil output worker ke dalam grup/folder tersebut

5. Modifikasi “Directus files” collection (paling enak dikasih sql, tinggal jalanin)

(update) SQL Query:

```SQL
WITH first_row AS (
  INSERT INTO directus_folders (id, name, parent)
  VALUES (gen_random_uuid(), 'Spatial', null)
  RETURNING id
)
INSERT INTO directus_folders (id, name, parent)
SELECT gen_random_uuid(), 'Raster', id FROM first_row;

INSERT INTO directus_collections(collection, icon, color)
VALUES ('Spatial_Data', 'layers', '#6644FF');

ALTER TABLE directus_files
ADD COLUMN format_file character varying(255) DEFAULT 'shapefile'::character varying,
ADD COLUMN table_name character varying(255),
ADD COLUMN is_zipped boolean DEFAULT true,
ADD COLUMN raster_alias character varying(255),
ADD COLUMN min_zoom integer,
ADD COLUMN max_zoom integer,
ADD COLUMN is_ready boolean;

INSERT INTO directus_fields(collection, field, special, interface, options, sort, width)
VALUES
    ('directus_files', 'format_file', null, 'select-dropdown', '{"choices":[{"text":"shapefile","value":"shapefile"},{"text":"kml","value":"kml"},{"text":"xls","value":"xls"},{"text":"xlsx","value":"xlsx"},{"text":"csv","value":"csv"},{"text":"geojson","value":"geojson"},{"text":"gdb","value":"gdb"},{"text":"tif","value":"tif"}]}', 1, 'full'),
    ('directus_files', 'divider-sjndgf', 'alias,no-data', 'presentation-divider', '{"title":"Vector Transform Configuration","inlineTitle":true}', 2, 'full'),
    ('directus_files', 'table_name', null, 'input', null, 3, 'full'),
    ('directus_files', 'is_zipped', 'cast-boolean', 'boolean', '{"label":"Yes"}', 4, 'full'),
    ('directus_files', 'divider-xhf5pw', 'alias,no-data', 'presentation-divider', '{"inlineTitle":true,"title":"Raster Tiling Configuration"}', 5, 'full'),
    ('directus_files', 'raster_alias', null, 'input', null, 6, 'full'),
    ('directus_files', 'min_zoom', null, 'input', '{"min":1,"max":20}', 7, 'half'),
    ('directus_files', 'max_zoom', null, 'input', '{"min":1,"max":20}', 8, 'half'),
    ('directus_files', 'divider-3gqc1y', 'alias,no-data', 'presentation-divider', '{"title":"Trigger After Configuration","inlineTitle":true}', 9, 'full'),
    ('directus_files', 'is_ready', 'cast-boolean', 'boolean', '{"label":"Yes"}', 10, 'full');
```

# Main Steps

1. Copy folder “tasks” pada proyek turunan Geodashboard di dalam main path proyek

2. Jalankan seluruh PLPGSQL script yang ada pada folder “tasks/script/\*”

   Bisa menggunakan SQL-management apps atau CLI. Jika dengan menggunakan CLI, misalnya:

   `psql 'connstring' -f scripts/create_queue_table.plpgsql`

3. Remove Old Worker

   Comment or remove Directus → extension → build.js, hal-hal yang berhubungan dengan:

   - appBundle

   - appRollupOutOpts

   - appRollupOpts

   - "src/endpoints/spatial-data-process-status/index.js"

   - "src/hooks/spatial-data-task-queue/index.js”

4. Add New Worker

5. Ganti service “rabbitmq“ dan “worker” pada docker-compose.yml dengan code sebagai berikut:

```yml
worker:
  build:
    context: tasks
  environment:
    - DATABASE_URL
    - AWS_ACCESS_KEY_ID=${S3_ACCESS_KEY}
    - AWS_SECRET_ACCESS_KEY=${S3_SECRET_KEY}
    - ADMIN_TOKEN
    - S3_ENDPOINT
    - S3_BUCKET_NAME
  restart: unless-stopped
```

6. Siap Deploy!

# For Worker Development Purpose

psql 'connstring' -f scripts/create_queue.plpgsql
psql 'connstring' -f scripts/insert_queue.plpgsql
etc...

run "poetry shell" if you want activate local env
use "exit" to close, or "deactivate"
run "`poetry show -v`" to view virtualenv directory

To run workers:

     poetry run dramatiq --verbose -p 2 -t 2 main

T3 Micro has 2 vCPU ~ 2 processes
T3 Micro has 1GB RAM ~ 2-4 threads is considered safe

To produce messages for testing purpose:

     poetry run python main.py

You can remove "poetry run" if you are already in poetry shell or local env

### Current Dev Mode schema:

1. Add data to queue
   1. Upload data
   2. Add variable if needed (eg. kml file type)
   3. Modify variable, finally modify “is_ready” = True to trigger insert_one_queue
2. Running worker
   1. Deactivate production worker
   2. Go to tasks directory
   3. Run poetry install
   4. run "poetry shell"
   5. Change intepreter path to poetry virtualenv directory (run “poetry show -v” to view virtualenv directory)
   6. Run `dramatiq --verbose -p 2 -t 1 main`
   7. Edit file variable from `directus file -> spatial`
   8. After a queue inserted to the queue table, it will trigger the worker



====

To add geoprocessing task you just need to write your task actor on tasks folder and then import it on tasks init file.