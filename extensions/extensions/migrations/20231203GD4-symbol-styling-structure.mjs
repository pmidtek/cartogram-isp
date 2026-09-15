import {
  PUBLIC_FOLDER_ID,
  LAYER_ICONS_FOLDER_ID,
} from "./const/FOLDER_IDS.mjs";

export async function up(knex) {
  await knex.raw(`
  INSERT INTO directus_folders(id,name)
  VALUES ('${PUBLIC_FOLDER_ID}','Public');

  INSERT INTO directus_folders(id,name,parent)
  VALUES ('${LAYER_ICONS_FOLDER_ID}','Layer Icons','${PUBLIC_FOLDER_ID}');

  CREATE TABLE public.symbol (
    id serial4 NOT NULL,
    "name" varchar(255) NULL,
    layout_icon_allow_overlap bool NULL DEFAULT false,
    layout_icon_anchor varchar(255) NULL DEFAULT 'center',
    paint_icon_color text NULL DEFAULT '#000000',
    paint_icon_halo_blur float4 NULL DEFAULT 0,
    paint_icon_halo_color varchar(255) NULL DEFAULT 'rgba(0, 0, 0, 0)',
    paint_icon_halo_width float4 NULL DEFAULT 0,
    layout_icon_ignore_placement bool NULL DEFAULT false,
    layout_icon_image uuid NULL REFERENCES directus_files (id) ON DELETE SET NULL,
    layout_icon_keep_upright bool NULL DEFAULT false,
    layout_icon_offset varchar(255) NULL DEFAULT '[0,0]',
    paint_icon_opacity text NULL DEFAULT '1'::character varying,
    layout_icon_optional bool NULL DEFAULT false,
    layout_icon_overlap varchar(255) NULL,
    layout_icon_padding varchar(255) NULL DEFAULT '[2]',
    layout_icon_pitch_alignment varchar(255) NULL DEFAULT 'auto',
    layout_icon_rotate float4 NULL DEFAULT 0,
    layout_icon_rotation_alignment varchar(255) NULL DEFAULT 'auto',
    layout_icon_size float4 NULL DEFAULT 1,
    layout_icon_text_fit varchar(255) NULL DEFAULT 'none',
    layout_icon_text_fit_padding varchar(255) NULL DEFAULT '[0,0,0,0]',
    paint_icon_translate varchar(255) NULL DEFAULT '[0,0]',
    paint_icon_translate_anchor varchar(255) NULL DEFAULT 'map',
    layout_symbol_avoid_edges bool NULL DEFAULT false,
    layout_symbol_placement varchar(255) NULL DEFAULT 'point',
    layout_symbol_sort_key float4 NULL,
    layout_symbol_spacing float4 NULL DEFAULT 250,
    layout_symbol_z_order varchar(255) NULL DEFAULT 'auto',
    layout_text_allow_overlap bool NULL DEFAULT false,
    layout_text_anchor varchar(255) NULL DEFAULT 'center',
    paint_text_color text NULL DEFAULT '#000000',
    layout_text_field text NULL,
    layout_text_font varchar(255) NULL DEFAULT '["Open Sans Regular","Arial Unicode MS Regular"]',
    paint_text_halo_blur float4 NULL DEFAULT 0,
    paint_text_halo_color varchar(255) NULL DEFAULT 'rgba(0, 0, 0, 0)',
    paint_text_halo_width float4 NULL DEFAULT 0,
    layout_text_ignore_placement bool NULL DEFAULT false,
    layout_text_justify varchar(255) NULL DEFAULT 'center',
    layout_text_keep_upright bool NULL DEFAULT true,
    layout_text_letter_spacing float4 NULL DEFAULT 0,
    layout_text_line_height float4 NULL DEFAULT 1.2,
    layout_text_max_angle float4 NULL DEFAULT 45,
    layout_text_max_width float4 NULL DEFAULT 10,
    layout_text_offset varchar(255) NULL DEFAULT '[0,0]',
    paint_text_opacity text NULL DEFAULT '1'::character varying,
    layout_text_optional bool NULL DEFAULT false,
    layout_text_overlap varchar(255) NULL,
    layout_text_padding float4 NULL DEFAULT 2,
    layout_text_pitch_alignment varchar(255) NULL DEFAULT 'auto',
    layout_text_radial_offset float4 NULL DEFAULT 0,
    layout_text_rotate float4 NULL DEFAULT 0,
    layout_text_rotation_alignment varchar(255) NULL DEFAULT 'auto',
    layout_text_size float4 NULL DEFAULT 16,
    layout_text_transform varchar(255) NULL DEFAULT 'none',
    paint_text_translate varchar(255) NULL DEFAULT '[0,0]',
    paint_text_translate_anchor varchar(255) NULL DEFAULT 'map',
    layout_text_variable_anchor varchar(255) NULL,
    layout_text_variable_anchor_offset varchar(255) NULL,
    layout_text_writing_mode varchar(255) NULL,
    layout_visibility varchar(255) NULL DEFAULT 'visible',
    CONSTRAINT symbol_pkey PRIMARY KEY (id)
  );

  INSERT INTO directus_collections(collection, icon, color, "group")
  VALUES ('symbol', 'emoji_symbols', '#2ECDA7', 'layer_styling');

  INSERT INTO directus_fields (collection, field, special, interface, options, readonly, hidden, sort, translations, required) VALUES
    ('symbol', 'name', NULL, 'input', NULL, false, false, 1, NULL, true),

    ('symbol', 'layout_icon_allow_overlap', NULL, 'boolean', NULL, false, false, 2, '[{"language":"en-US","translation":"Icon Allow Overlap"}]', false),

    ('symbol', 'layout_icon_anchor', NULL, 'select-dropdown', '{"choices":[{"text":"center","value":"center"},{"text":"left","value":"left"},{"text":"right","value":"right"},{"text":"top","value":"top"},{"text":"bottom","value":"bottom"},{"text":"top-left","value":"top-left"},{"text":"top-right","value":"top-right"},{"text":"bottom-left","value":"bottom-left"},{"text":"bottom-right","value":"bottom-right"}]}', false, false, 3, '[{"language":"en-US","translation":"Icon Anchor"}]', false),

    ('symbol', 'paint_icon_color', NULL, 'select-color', NULL, false, false, 4, '[{"language":"en-US","translation":"Icon Color"}]', false),

    ('symbol', 'paint_icon_halo_blur', NULL, 'slider', '{"minValue":0,"maxValue":10,"stepInterval":0.1,"alwaysShowValue":true}', false, false, 5, '[{"language":"en-US","translation":"Icon Halo Blur"}]', false),

    ('symbol', 'paint_icon_halo_color', NULL, 'select-color', NULL, false, false, 6, '[{"language":"en-US","translation":"Icon Halo Color"}]', false),

    ('symbol', 'paint_icon_halo_width', NULL, 'slider', '{"minValue":0,"maxValue":10,"stepInterval":0.1,"alwaysShowValue":true}', false, false, 7, '[{"language":"en-US","translation":"Icon Halo Width"}]', false),

    ('symbol', 'layout_icon_ignore_placement', NULL, 'boolean', NULL, false, false, 8, '[{"language":"en-US","translation":"Icon Ignore Placement"}]', false),

    ('symbol', 'layout_icon_image', 'file', 'file-image', '{"folder":"${LAYER_ICONS_FOLDER_ID}"}', false, false, 9, '[{"language":"en-US","translation":"Icon Image"}]', false),

    ('symbol', 'layout_icon_keep_upright', NULL, 'boolean', NULL, false, false, 10, '[{"language":"en-US","translation":"Icon Keep Upright"}]', false),

    ('symbol', 'layout_icon_offset', NULL, 'input', '{"placeholder":"[0,0]"}', false, false, 11, '[{"language":"en-US","translation":"Icon Offset"}]', false),

    ('symbol', 'paint_icon_opacity', NULL, 'slider', '{"minValue":0,"maxValue":1,"stepInterval":0.1,"alwaysShowValue":true}', false, false, 12, '[{"language":"en-US","translation":"Icon Opacity"}]', false),

    ('symbol', 'layout_icon_optional', NULL, 'boolean', NULL, false, false, 13, '[{"language":"en-US","translation":"Icon Optional"}]', false),

    ('symbol', 'layout_icon_overlap', NULL, 'select-dropdown', '{"choices":[{"text":"never","value":"never"},{"text":"always","value":"always"},{"text":"cooperative","value":"cooperative"}]}', false, false, 14, '[{"language":"en-US","translation":"Icon Overlap"}]', false),

    ('symbol', 'layout_icon_padding', NULL, 'input', '{"placeholder":"[2]"}', false, false, 15, '[{"language":"en-US","translation":"Icon Padding"}]', false),

    ('symbol', 'layout_icon_pitch_alignment', NULL, 'select-dropdown', '{"choices":[{"text":"map","value":"map"},{"text":"viewport","value":"viewport"},{"text":"auto","value":"auto"}]}', false, false, 16, '[{"language":"en-US","translation":"Icon Pitch Alignment"}]', false),

    ('symbol', 'layout_icon_rotate', NULL, 'slider', '{"minValue":0,"maxValue":360,"stepInterval":1,"alwaysShowValue":true}', false, false, 17, '[{"language":"en-US","translation":"Icon Rotate"}]', false),

    ('symbol', 'layout_icon_rotation_alignment', NULL, 'select-dropdown', '{"choices":[{"text":"map","value":"map"},{"text":"viewport","value":"viewport"},{"text":"auto","value":"auto"}]}', false, false, 18, '[{"language":"en-US","translation":"Icon Rotation Alignment"}]', false),

    ('symbol', 'layout_icon_size', NULL, 'slider', '{"minValue":0,"maxValue":3,"stepInterval":0.1,"alwaysShowValue":true}', false, false, 19, '[{"language":"en-US","translation":"Icon Size"}]', false),

    ('symbol', 'layout_icon_text_fit', NULL, 'select-dropdown', '{"choices":[{"text":"none","value":"none"},{"text":"width","value":"width"},{"text":"height","value":"height"},{"text":"both","value":"both"}]}', false, false, 20, '[{"language":"en-US","translation":"Icon Text Fit"}]', false),

    ('symbol', 'layout_icon_text_fit_padding', NULL, 'input', '{"placeholder":"[0,0,0,0]"}', false, false, 21, '[{"language":"en-US","translation":"Icon Text Fit Padding"}]', false),

    ('symbol', 'paint_icon_translate', NULL, 'input', '{"placeholder":"[0,0]"}', false, false, 22, '[{"language":"en-US","translation":"Icon Translate"}]', false),

    ('symbol', 'paint_icon_translate_anchor', NULL, 'select-dropdown', '{"choices":[{"text":"map","value":"map"},{"text":"viewport","value":"viewport"}]}', false, false, 23, '[{"language":"en-US","translation":"Icon Translate Anchor"}]', false),

    ('symbol', 'layout_symbol_avoid_edges', NULL, 'boolean', NULL, false, false, 24, '[{"language":"en-US","translation":"Symbol Avoid Edges"}]', false),

    ('symbol', 'layout_symbol_placement', NULL, 'select-dropdown', '{"choices":[{"text":"point","value":"point"},{"text":"line","value":"line"},{"text":"line-center","value":"line-center"}]}', false, false, 25, '[{"language":"en-US","translation":"Symbol Placement"}]', false),

    ('symbol', 'layout_symbol_sort_key', NULL, 'input', NULL, false, false, 26, '[{"language":"en-US","translation":"Symbol Sort Key"}]', false),

    ('symbol', 'layout_symbol_spacing', NULL, 'slider', '{"minValue":0,"maxValue":500,"stepInterval":10,"alwaysShowValue":true}', false, false, 27, '[{"language":"en-US","translation":"Symbol Spacing"}]', false),

    ('symbol', 'layout_symbol_z_order', NULL, 'select-dropdown', '{"choices":[{"text":"auto","value":"auto"},{"text":"viewport-y","value":"viewport-y"},{"text":"source","value":"source"}]}', false, false, 28, '[{"language":"en-US","translation":"Symbol Z Order"}]', false),

    ('symbol', 'layout_text_allow_overlap', NULL, 'boolean', NULL, false, false, 29, '[{"language":"en-US","translation":"Text Allow Overlap"}]', false),

    ('symbol', 'layout_text_anchor', NULL, 'select-dropdown', '{"choices":[{"text":"center","value":"center"},{"text":"left","value":"left"},{"text":"right","value":"right"},{"text":"top","value":"top"},{"text":"bottom","value":"bottom"},{"text":"top-left","value":"top-left"},{"text":"top-right","value":"top-right"},{"text":"bottom-left","value":"bottom-left"},{"text":"bottom-right","value":"bottom-right"}]}', false, false, 30, '[{"language":"en-US","translation":"Text Anchor"}]', false),

    ('symbol', 'paint_text_color', NULL, 'select-color', NULL, false, false, 31, '[{"language":"en-US","translation":"Text Color"}]', false),

    ('symbol', 'layout_text_field', NULL, 'input', '{"placeholder":"Text field content"}', false, false, 32, '[{"language":"en-US","translation":"Text Field"}]', false),

    ('symbol', 'layout_text_font', NULL, 'input', '{"placeholder":"Font name"}', false, false, 33, '[{"language":"en-US","translation":"Text Font"}]', false),

    ('symbol', 'paint_text_halo_blur', NULL, 'slider', '{"minValue":0,"maxValue":10,"stepInterval":0.1,"alwaysShowValue":true}', false, false, 34, '[{"language":"en-US","translation":"Text Halo Blur"}]', false),

    ('symbol', 'paint_text_halo_color', NULL, 'select-color', NULL, false, false, 35, '[{"language":"en-US","translation":"Text Halo Color"}]', false),

    ('symbol', 'paint_text_halo_width', NULL, 'slider', '{"minValue":0,"maxValue":10,"stepInterval":0.1,"alwaysShowValue":true}', false, false, 36, '[{"language":"en-US","translation":"Text Halo Width"}]', false),

    ('symbol', 'layout_text_ignore_placement', NULL, 'boolean', NULL, false, false, 37, '[{"language":"en-US","translation":"Text Ignore Placement"}]', false),

    ('symbol', 'layout_text_justify', NULL, 'select-dropdown', '{"choices":[{"text":"auto","value":"auto"},{"text":"left","value":"left"},{"text":"center","value":"center"},{"text":"right","value":"right"}]}', false, false, 38, '[{"language":"en-US","translation":"Text Justify"}]', false),

    ('symbol', 'layout_text_keep_upright', NULL, 'boolean', NULL, false, false, 39, '[{"language":"en-US","translation":"Text Keep Upright"}]', false),

    ('symbol', 'layout_text_letter_spacing', NULL, 'slider', '{"minValue":0,"maxValue":1,"stepInterval":0.01,"alwaysShowValue":true}', false, false, 40, '[{"language":"en-US","translation":"Text Letter Spacing"}]', false),

    ('symbol', 'layout_text_line_height', NULL, 'slider', '{"minValue":0,"maxValue":2,"stepInterval":0.1,"alwaysShowValue":true}', false, false, 41, '[{"language":"en-US","translation":"Text Line Height"}]', false),

    ('symbol', 'layout_text_max_angle', NULL, 'slider', '{"minValue":0,"maxValue":90,"stepInterval":1,"alwaysShowValue":true}', false, false, 42, '[{"language":"en-US","translation":"Text Max Angle"}]', false),

    ('symbol', 'layout_text_max_width', NULL, 'slider', '{"minValue":0,"maxValue":100,"stepInterval":1,"alwaysShowValue":true}', false, false, 43, '[{"language":"en-US","translation":"Text Max Width"}]', false),

    ('symbol', 'layout_text_offset', NULL, 'input', '{"placeholder":"[0,0]"}', false, false, 44, '[{"language":"en-US","translation":"Text Offset"}]', false),

    ('symbol', 'paint_text_opacity', NULL, 'slider', '{"minValue":0,"maxValue":1,"stepInterval":0.1,"alwaysShowValue":true}', false, false, 45, '[{"language":"en-US","translation":"Text Opacity"}]', false),

    ('symbol', 'layout_text_optional', NULL, 'boolean', NULL, false, false, 46, '[{"language":"en-US","translation":"Text Optional"}]', false),

    ('symbol', 'layout_text_overlap', NULL, 'select-dropdown', '{"choices":[{"text":"never","value":"never"},{"text":"always","value":"always"},{"text":"cooperative","value":"cooperative"}]}', false, false, 47, '[{"language":"en-US","translation":"Text Overlap"}]', false),

    ('symbol', 'layout_text_padding', NULL, 'slider', '{"minValue":0,"maxValue":100,"stepInterval":1,"alwaysShowValue":true}', false, false, 48, '[{"language":"en-US","translation":"Text Padding"}]', false),

    ('symbol', 'layout_text_pitch_alignment', NULL, 'select-dropdown', '{"choices":[{"text":"map","value":"map"},{"text":"viewport","value":"viewport"},{"text":"auto","value":"auto"}]}', false, false, 49, '[{"language":"en-US","translation":"Text Pitch Alignment"}]', false),

    ('symbol', 'layout_text_radial_offset', NULL, 'slider', '{"minValue":-10,"maxValue":10,"stepInterval":0.1,"alwaysShowValue":true}', false, false, 50, '[{"language":"en-US","translation":"Text Radial Offset"}]', false),

    ('symbol', 'layout_text_rotate', NULL, 'slider', '{"minValue":0,"maxValue":360,"stepInterval":1,"alwaysShowValue":true}', false, false, 51, '[{"language":"en-US","translation":"Text Rotate"}]', false),

    ('symbol', 'layout_text_rotation_alignment', NULL, 'select-dropdown', '{"choices":[{"text":"map","value":"map"},{"text":"viewport","value":"viewport"},{"text":"viewport-glyph","value":"viewport-glyph"},{"text":"auto","value":"auto"}]}', false, false, 52, '[{"language":"en-US","translation":"Text Rotation Alignment"}]', false),

    ('symbol', 'layout_text_size', NULL, 'slider', '{"minValue":0,"maxValue":100,"stepInterval":1,"alwaysShowValue":true}', false, false, 53, '[{"language":"en-US","translation":"Text Size"}]', false),

    ('symbol', 'layout_text_transform', NULL, 'select-dropdown', '{"choices":[{"text":"none","value":"none"},{"text":"uppercase","value":"uppercase"},{"text":"lowercase","value":"lowercase"}]}', false, false, 54, '[{"language":"en-US","translation":"Text Transform"}]', false),

    ('symbol', 'paint_text_translate', NULL, 'input', '{"placeholder":"[0,0]"}', false, false, 55, '[{"language":"en-US","translation":"Text Translate"}]', false),

    ('symbol', 'paint_text_translate_anchor', NULL, 'select-dropdown', '{"choices":[{"text":"map","value":"map"},{"text":"viewport","value":"viewport"}]}', false, false, 56, '[{"language":"en-US","translation":"Text Translate Anchor"}]', false),

    ('symbol', 'layout_text_variable_anchor', NULL, 'input', '{"placeholder":"Anchor options"}', false, false, 57, '[{"language":"en-US","translation":"Text Variable Anchor"}]', false),

    ('symbol', 'layout_text_variable_anchor_offset', NULL, 'input', '{"placeholder":"[anchor, offset]"}', false, false, 58, '[{"language":"en-US","translation":"Text Variable Anchor Offset"}]', false),

    ('symbol', 'layout_text_writing_mode', NULL, 'select-dropdown', '{"choices":[{"text":"horizontal","value":"horizontal"},{"text":"vertical","value":"vertical"}]}', false, false, 59, '[{"language":"en-US","translation":"Text Writing Mode"}]', false),

    ('symbol', 'layout_visibility', NULL, 'select-dropdown', '{"choices":[{"text":"visible","value":"visible"},{"text":"none","value":"none"}]}', false, false, 60, '[{"language":"en-US","translation":"Visibility"}]', false),
    
    ('symbol', 'id', NULL, 'input', NULL, true, true, 1, NULL, false);

  INSERT INTO directus_relations(many_collection,many_field,one_collection,one_field,one_collection_field,one_allowed_collections,junction_field,sort_field,one_deselect_action)
  VALUES
    ('symbol','layout_icon_image','directus_files',NULL,NULL,NULL,NULL,NULL,'nullify');
  `);
}

export async function down(knex) {
  await knex.raw(`
    DELETE FROM directus_relations WHERE many_collection = 'symbol';

    DELETE FROM directus_fields WHERE collection = 'symbol';
    DELETE FROM directus_collections WHERE collection = 'symbol';

    DROP TABLE IF EXISTS public.symbol;

    DELETE FROM directus_folders WHERE id = '${LAYER_ICONS_FOLDER_ID}';
    DELETE FROM directus_folders WHERE id = '${PUBLIC_FOLDER_ID}';
  `);
}
