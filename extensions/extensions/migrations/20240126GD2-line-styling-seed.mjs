export async function up(knex) {
  await knex.raw(`
  INSERT INTO public.line ("name", paint_line_color, paint_line_opacity)
  VALUES
    ('line-1', '#FF5733', '0.8'),
    ('line-2', '#33FF57', '0.7'),
    ('line-3', '#3357FF', '0.6'),
    ('line-4', '#F333FF', '0.5'),
    ('line-5', '#33FFF3', '0.4'),
    ('line-6', '#F3FF33', '0.9'),
    ('line-7', '#FF3357', '0.85'),
    ('line-8', '#57FF33', '0.75'),
    ('line-9', '#337FFF', '0.65'),
    ('line-10', '#7F33FF', '0.55');
    `);
}

export async function down(knex) {
  await knex.raw(`
  DELETE FROM public.line
  WHERE "name" IN ('line-1', 'line-2', 'line-3', 'line-4', 'line-5', 'line-6', 'line-7', 'line-8', 'line-9', 'line-10');
    `);
}
