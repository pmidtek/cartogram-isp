export async function up(knex) {
  await knex.raw(`
  INSERT INTO public.fill (paint_fill_color, paint_fill_opacity, "name")
  VALUES
  ('#FF5733', '0.8', 'fill-1'),
  ('#33FF57', '0.7', 'fill-2'),
  ('#3357FF', '0.6', 'fill-3'),
  ('#F333FF', '0.5', 'fill-4'),
  ('#33FFF3', '0.4', 'fill-5'),
  ('#F3FF33', '0.9', 'fill-6'),
  ('#FF3357', '0.85', 'fill-7'),
  ('#57FF33', '0.75', 'fill-8'),
  ('#337FFF', '0.65', 'fill-9'),
  ('#7F33FF', '0.55', 'fill-10');
  `);
}

export async function down(knex) {
  await knex.raw(`
  DELETE FROM public.fill
  WHERE "name" IN ('fill-1', 'fill-2', 'fill-3', 'fill-4', 'fill-5', 'fill-6', 'fill-7', 'fill-8', 'fill-9', 'fill-10');
  `);
}
