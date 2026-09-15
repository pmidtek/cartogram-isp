export async function up(knex) {
  await knex("map")
    .insert({
      lang: "eng",
      information: `## Geodashboard

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Aliquam sed magna nisi. Curabitur in metus turpis. Quisque pretium, quam tincidunt semper convallis, risus quam mattis risus, in tincidunt mauris diam non ipsum. Nulla eu diam odio. Mauris fringilla maximus arcu, id porttitor libero. Praesent a eros sit amet lorem venenatis sodales. Maecenas eget magna at lorem consequat congue. Sed elementum ornare semper. Aenean pellentesque pretium orci, eget bibendum nunc egestas ac. In volutpat sit amet enim vitae cursus. Maecenas malesuada risus aliquet tellus rutrum, quis tincidunt elit viverra.

# Lorem ipsum

Pellentesque dapibus cursus tempus. Curabitur nisl quam, placerat ut lorem ut, consectetur porta libero. Quisque rhoncus fringilla ligula vitae egestas. Etiam condimentum nisi sed risus iaculis, eu vehicula ante sollicitudin. Aliquam commodo lacus sagittis, fringilla urna sit amet, vehicula mi. Suspendisse sit amet libero diam. In scelerisque efficitur viverra.`,
      title: "Geodashboard",
      subtitle: "Welcome to Geodashboard!",
      initial_map_view: JSON.stringify({
        type: "Polygon",
        coordinates: [
          [
            [93, 7],
            [93, -12],
            [143, -12],
            [143, 7],
            [93, 7],
          ],
        ],
      }),
    })
    .onConflict("lang")
    .ignore();
}

export async function down(knex) {
  await knex("map").where("lang", "eng").del();
}
