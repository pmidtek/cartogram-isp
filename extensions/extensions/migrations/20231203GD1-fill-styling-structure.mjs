export async function up(knex) {
  await knex.raw(`
  INSERT INTO directus_collections(collection,icon,color)
  VALUES ('layer_styling','color_lens','#2ECDA7');

  CREATE TABLE public.fill (
    id serial4 NOT NULL,
    paint_fill_antialias bool NULL DEFAULT true,
    paint_fill_color text NULL DEFAULT '#6D4C1E'::character varying,
    paint_fill_opacity text NULL DEFAULT '1'::character varying,
    paint_fill_outline_color text NULL,
    paint_fill_pattern varchar(255) NULL,
    layout_fill_sort_key int4 NULL,
    paint_fill_translate varchar(255) NULL DEFAULT NULL::character varying,
    paint_fill_translate_anchor varchar(255) NOT NULL DEFAULT 'map'::character varying,
    "name" varchar(255) NULL,
    layout_visibility varchar(255) NULL DEFAULT 'visible'::character varying,
    CONSTRAINT fill_pkey PRIMARY KEY (id)
  );

  INSERT INTO directus_collections(collection, icon, color, "group")
  VALUES ('fill', 'egg_alt', '#2ECDA7', 'layer_styling');

  INSERT INTO directus_fields (
    collection, field, special, interface, options, readonly, hidden, sort, translations, required
  ) VALUES
    ('fill', 'paint_fill_outline_color', NULL, 'select-color', '{"opacity":true}', false, false, 7, '[{"language":"en-US","translation":"Outline Color"}]', false),

    ('fill', 'paint_fill_opacity', NULL, 'slider', '{"minValue":0,"maxValue":1,"stepInterval":0.1,"alwaysShowValue":true}', false, false, 6, '[{"language":"en-US","translation":"Opacity"}]', false),

    ('fill', 'paint_fill_pattern', NULL, 'input', '{"placeholder":"Simple icon name or resolved image expression"}', false, false, 8, '[{"language":"en-US","translation":"Pattern"}]', false),

    ('fill', 'paint_fill_translate', NULL, 'input', '{"placeholder":"[0,0]"}', false, false, 9, '[{"language":"en-US","translation":"Translate"}]', false),

    ('fill', 'paint_fill_translate_anchor', NULL, 'select-radio', '{"choices":[{"text":"map","value":"map"},{"text":"viewport","value":"viewport"}]}', false, false, 10, '[{"language":"en-US","translation":"Translate Anchor"}]', false),

    ('fill', 'divider-1e40tn', 'alias,no-data', 'presentation-divider', '{"title":"Layout","inlineTitle":true}', false, false, 11, NULL, false),

    ('fill', 'layout_fill_sort_key', NULL, 'input', '{"min":null,"max":null}', false, false, 12, '[{"language":"en-US","translation":"Sort Key"}]', false),

    ('fill', 'id', NULL, 'input', NULL, true, true, 1, NULL, false),

    ('fill', 'name', NULL, 'input', NULL, false, false, 2, NULL, true),

    ('fill', 'divider-oew2wq', 'alias,no-data', 'presentation-divider', '{"title":"Paint","inlineTitle":true}', false, false, 3, NULL, false),

    ('fill', 'paint_fill_antialias', 'cast-boolean', 'boolean', NULL, false, false, 4, '[{"language":"en-US","translation":"Antialias"}]', false),

    ('fill', 'paint_fill_color', NULL, 'select-color', NULL, false, false, 5, '[{"language":"en-US","translation":"Color"}]', false),

    ('fill', 'layout_visibility', NULL, 'select-radio', '{"choices":[{"text":"visible","value":"visible"},{"text":"none","value":"none"}]}', false, false, NULL, NULL, false);
  `);
}

export async function down(knex) {
  await knex.raw(`
    DELETE FROM directus_fields WHERE collection = 'fill';
    DELETE FROM directus_collections WHERE collection = 'fill';

    DROP TABLE IF EXISTS public.fill;
    DELETE FROM directus_collections WHERE collection = 'layer_styling';
  `);
}
