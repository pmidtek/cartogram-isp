export async function up(knex) {
  await knex.raw(`
  INSERT INTO public.circle ("name", paint_circle_color, paint_circle_opacity, paint_circle_radius, paint_circle_stroke_color, paint_circle_stroke_opacity)
  VALUES
    ('circle-1', '#E57373', '0.8', 10, '#B71C1C', '0.8'),
    ('circle-2', '#81C784', '0.7', 12, '#1B5E20', '0.7'),
    ('circle-3', '#64B5F6', '0.6', 14, '#0D47A1', '0.6'),
    ('circle-4', '#BA68C8', '0.5', 16, '#4A148C', '0.5'),
    ('circle-5', '#FFD54F', '0.4', 18, '#FF6F00', '0.4'),
    ('circle-6', '#4DB6AC', '0.9', 20, '#004D40', '0.9'),
    ('circle-7', '#90A4AE', '0.85', 22, '#37474F', '0.85'),
    ('circle-8', '#FF8A65', '0.75', 24, '#BF360C', '0.75'),
    ('circle-9', '#A1887F', '0.65', 26, '#3E2723', '0.65'),
    ('circle-10', '#7986CB', '0.55', 28, '#283593', '0.55');
      `);
}

export async function down(knex) {
  await knex.raw(`
  DELETE FROM public.circle
  WHERE "name" IN ('circle-1', 'circle-2', 'circle-3', 'circle-4', 'circle-5', 'circle-6', 'circle-7', 'circle-8', 'circle-9', 'circle-10');
      `);
}
