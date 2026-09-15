export async function up(knex) {
  await knex.raw(`
  CREATE TABLE public.line (
    id serial4 NOT NULL,
    "name" varchar(255) NULL,
    paint_line_blur int4 NULL DEFAULT 0,
    layout_line_cap varchar(255) NULL DEFAULT 'butt'::character varying,
    paint_line_color text NULL DEFAULT '#000000'::character varying,
    paint_line_dasharray varchar(255) NULL,
    paint_line_gap_width int4 NULL DEFAULT 0,
    paint_line_gradient varchar(255) NULL,
    layout_line_join varchar(255) NULL DEFAULT 'miter'::character varying,
    layout_line_miter_limit int4 NULL DEFAULT 2,
    paint_line_offset int4 NULL DEFAULT 0,
    paint_line_pattern varchar(255) NULL,
    layout_line_round_limit float4 NULL DEFAULT '1.05'::real,
    layout_line_sort_key int4 NULL,
    paint_line_translate varchar(255) NULL,
    paint_line_translate_anchor varchar(255) NULL DEFAULT 'map'::character varying,
    paint_line_width int4 NULL DEFAULT 1,
    layout_visibility varchar(255) NULL DEFAULT 'visible'::character varying,
    paint_line_opacity text NULL DEFAULT '1'::character varying,
    CONSTRAINT line_pkey PRIMARY KEY (id)
  );

  INSERT INTO directus_collections(collection, icon, color, "group")
  VALUES ('line', 'polyline', '#2ECDA7', 'layer_styling');

  INSERT INTO directus_fields (
    collection, field, special, interface, options, readonly, hidden, sort, translations, required
  ) VALUES
    ('line', 'paint_line_dasharray', NULL, 'input', '{"placeholder":"[5,1]"}', false, false, 6, '[{"language":"en-US","translation":"Dash Array"}]', false),

    ('line', 'layout_line_cap', NULL, 'select-radio', '{"choices":[{"text":"butt","value":"butt"},{"text":"round","value":"round"},{"text":"square","value":"square"}]}', false, false, 16, '[{"language":"en-US","translation":"Cap"}]', false),

    ('line', 'paint_line_blur', NULL, 'slider', '{"alwaysShowValue":true}', false, false, 4, '[{"language":"en-US","translation":"Blur"}]', false),

    ('line', 'layout_line_join', NULL, 'select-radio', '{"choices":[{"text":"miter","value":"miter"},{"text":"bevel","value":"bevel"},{"text":"round","value":"round"}]}', false, false, 17, '[{"language":"en-US","translation":"Join"}]', false),

    ('line', 'layout_line_miter_limit', NULL, 'slider', '{"alwaysShowValue":true}', false, false, 18, '[{"language":"en-US","translation":"Miter Limit"}]', false),

    ('line', 'layout_line_round_limit', NULL, 'slider', '{"alwaysShowValue":true,"stepInterval":0.05}', false, false, 19, '[{"language":"en-US","translation":"Round Limit"}]', false),

    ('line', 'layout_line_sort_key', NULL, 'slider', '{"alwaysShowValue":true}', false, false, 20, '[{"language":"en-US","translation":"Sort Key"}]', false),

    ('line', 'paint_line_color', NULL, 'select-color', NULL, false, false, 5, '[{"language":"en-US","translation":"Color"}]', false),

    ('line', 'paint_line_gap_width', NULL, 'slider', '{"alwaysShowValue":true}', false, false, 7, '[{"language":"en-US","translation":"Gap Width"}]', false),

    ('line', 'paint_line_translate', NULL, 'input', '{"placeholder":"[0,0]"}', false, false, 12, '[{"language":"en-US","translation":"Translate"}]', false),

    ('line', 'name', NULL, 'input', NULL, false, false, 2, NULL, false),

    ('line', 'divider-qy5wlb', 'alias,no-data', 'presentation-divider', '{"title":"Layout","inlineTitle":true}', false, false, 15, NULL, false),

    ('line', 'paint_line_pattern', NULL, 'input', '{"placeholder":"Image name or resolved image"}', false, false, 11, '[{"language":"en-US","translation":"Pattern"}]', false),

    ('line', 'paint_line_gradient', NULL, 'select-color', '{"opacity":true}', false, false, 8, '[{"language":"en-US","translation":"Gradient"}]', false),

    ('line', 'id', NULL, 'input', NULL, true, true, 1, NULL, false),

    ('line', 'divider-xq31kq', 'alias,no-data', 'presentation-divider', '{"title":"Paint","inlineTitle":true}', false, false, 3, NULL, false),

    ('line', 'paint_line_offset', NULL, 'slider', '{"alwaysShowValue":true}', false, false, 9, '[{"language":"en-US","translation":"Offset"}]', false),

    ('line', 'paint_line_opacity', NULL, 'slider', '{"minValue":0,"maxValue":1,"stepInterval":0.1,"alwaysShowValue":true}', false, false, 10, '[{"language":"en-US","translation":"Opacity"}]', false),

    ('line', 'paint_line_translate_anchor', NULL, 'select-radio', '{"choices":[{"text":"map","value":"map"},{"text":"viewport","value":"viewport"}]}', false, false, 13, '[{"language":"en-US","translation":"Translate Anchor"}]', false),

    ('line', 'paint_line_width', NULL, 'slider', '{"alwaysShowValue":true}', false, false, 14, '[{"language":"en-US","translation":"Width"}]', false),

    ('line', 'layout_visibility', NULL, 'select-radio', '{"choices":[{"text":"visible","value":"visible"},{"text":"none","value":"none"}]}', false, false, 21, '[{"language":"en-US","translation":"Visibility"}]', false);
  `);
}

export async function down(knex) {
  await knex.raw(`
    DELETE FROM directus_fields WHERE collection = 'line';
    DELETE FROM directus_collections WHERE collection = 'line';

    DROP TABLE IF EXISTS public.line;
  `);
}
