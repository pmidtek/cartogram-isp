export async function up(knex) {
  await knex.raw(`
  CREATE TABLE public.circle (
    id serial4 NOT NULL,
    "name" varchar(255) NULL,
    paint_circle_blur int4 NULL DEFAULT 0,
    paint_circle_color text NULL DEFAULT '#000000'::character varying,
    paint_circle_opacity text NULL DEFAULT '1'::character varying,
    paint_circle_pitch_alignment varchar(255) NULL DEFAULT 'viewport'::character varying,
    paint_circle_pitch_scale varchar(255) NULL DEFAULT 'map'::character varying,
    paint_circle_radius int4 NULL DEFAULT 5,
    layout_circle_sort_key int4 NULL,
    layout_visibility varchar(255) NULL DEFAULT 'visible'::character varying,
    paint_circle_stroke_color varchar(255) NULL DEFAULT '#000000'::character varying,
    paint_circle_stroke_opacity text NULL DEFAULT '1'::character varying,
    paint_circle_stroke_width int4 NULL DEFAULT 0,
    paint_circle_translate varchar(255) NULL,
    paint_circle_translate_anchor varchar(255) NULL DEFAULT 'map'::character varying,
    CONSTRAINT circle_pkey PRIMARY KEY (id)
  );

  INSERT INTO directus_collections(collection, icon, color, "group")
  VALUES ('circle', 'scatter_plot', '#2ECDA7', 'layer_styling');

  INSERT INTO directus_fields (
    collection, field, special, interface, options, readonly, hidden, sort, translations, required
  ) VALUES
    ('circle', 'name', NULL, 'input', NULL, false, false, 2, NULL, true),

    ('circle', 'paint_circle_translate', NULL, 'input', '{"placeholder":"[0,0]"}', false, false, 13, '[{"language":"en-US","translation":"Translate"}]', false),

    ('circle', 'paint_circle_radius', NULL, 'slider', '{"stepInterval":1,"alwaysShowValue":true}', false, false, 9, '[{"language":"en-US","translation":"Radius"}]', false),

    ('circle', 'paint_circle_stroke_opacity', NULL, 'slider', '{"minValue":0,"maxValue":1,"stepInterval":0.1}', false, false, 11, '[{"language":"en-US","translation":"Stroke Opacity"}]', false),

    ('circle', 'paint_circle_translate_anchor', NULL, 'select-dropdown', '{"choices":[{"text":"map","value":"map"},{"text":"viewport","value":"viewport"}]}', false, false, 14, '[{"language":"en-US","translation":"Translate Anchor"}]', false),

    ('circle', 'paint_circle_opacity', NULL, 'slider', '{"minValue":0,"maxValue":1,"stepInterval":0.1,"alwaysShowValue":true}', false, false, 6, '[{"language":"en-US","translation":"Opacity"}]', false),

    ('circle', 'paint_circle_pitch_alignment', NULL, 'select-dropdown', '{"choices":[{"text":"viewport","value":"viewport"},{"text":"map","value":"map"}]}', false, false, 7, '[{"language":"en-US","translation":"Pitch Alignment"}]', false),

    ('circle', 'paint_circle_stroke_color', NULL, 'select-color', NULL, false, false, 10, '[{"language":"en-US","translation":"Stroke Color"}]', false),

    ('circle', 'paint_circle_stroke_width', NULL, 'slider', '{"stepInterval":1,"alwaysShowValue":true}', false, false, 12, '[{"language":"en-US","translation":"Stroke Width"}]', false),

    ('circle', 'paint_circle_blur', NULL, 'slider', '{"alwaysShowValue":true}', false, false, 4, '[{"language":"en-US","translation":"Blur"}]', false),

    ('circle', 'layout_visibility', NULL, 'select-dropdown', '{"choices":[{"text":"visible","value":"visible"},{"text":"none","value":"none"}]}', false, false, 17, '[{"language":"en-US","translation":"Visibility"}]', false),

    ('circle', 'divider-4srpwr', 'alias,no-data', 'presentation-divider', '{"title":"Layout","inlineTitle":true}', false, false, 15, NULL, false),

    ('circle', 'layout_circle_sort_key', NULL, 'slider', '{"stepInterval":1,"alwaysShowValue":true}', false, false, 16, '[{"language":"en-US","translation":"Sort Key"}]', false),

    ('circle', 'id', NULL, 'input', NULL, true, true, 1, NULL, false),

    ('circle', 'paint_circle_pitch_scale', NULL, 'select-dropdown', '{"choices":[{"text":"map","value":"map"},{"text":"viewport","value":"viewport"}]}', false, false, 8, '[{"language":"en-US","translation":"Pitch Scale"}]', false),

    ('circle', 'paint_circle_color', NULL, 'select-color', NULL, false, false, 5, '[{"language":"en-US","translation":"Color"}]', false),

    ('circle', 'divider-mkyy4i', 'alias,no-data', 'presentation-divider', '{"title":"Paint","inlineTitle":true}', false, false, 3, NULL, false);

  `);
}

export async function down(knex) {
  await knex.raw(`
    DELETE FROM directus_fields WHERE collection = 'circle';
    DELETE FROM directus_collections WHERE collection = 'circle';

    DROP TABLE IF EXISTS public.circle;
  `);
}
