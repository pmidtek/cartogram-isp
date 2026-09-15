export async function up(knex) {
  await knex("categories")
    .insert([
      {
        category_id: "b872cc0d-0e52-4b7f-b102-3924e2bd8211",
        category_name: "Geoprocessing",
      },
      {
        category_id: "40ac1617-9404-4a8a-83db-ae8b6d4dd18a",
        category_name: "Clip",
        parent: "b872cc0d-0e52-4b7f-b102-3924e2bd8211",
      },
      {
        category_id: "f65539e0-8a97-4585-b71a-a53f26851bd8",
        category_name: "Dissolve",
        parent: "b872cc0d-0e52-4b7f-b102-3924e2bd8211",
      },
      {
        category_id: "0640361f-7aa9-48fa-9ee8-c712fc908295",
        category_name: "Intersect",
        parent: "b872cc0d-0e52-4b7f-b102-3924e2bd8211",
      },
      {
        category_id: "6bdf0899-dbe6-4eb8-93a0-37814c9a46da",
        category_name: "Merge",
        parent: "b872cc0d-0e52-4b7f-b102-3924e2bd8211",
      },
      {
        category_id: "60dc6c1f-0590-4056-9a15-66745d230cf2",
        category_name: "Spatial Join",
        parent: "b872cc0d-0e52-4b7f-b102-3924e2bd8211",
      },
      {
        category_id: "44fe4dcc-6171-43a1-8a56-f14bc67b7fdd",
        category_name: "Union",
        parent: "b872cc0d-0e52-4b7f-b102-3924e2bd8211",
      },
      {
        category_id: "0640361f-7aa9-48fa-9ee8-c712fc908206",
        category_name: "Difference",
        parent: "b872cc0d-0e52-4b7f-b102-3924e2bd8211",
      },
      {
        category_id: "6901ddb8-6ae1-4891-98e4-99f5efb8c3b8",
        category_name: "Table Join",
        parent: "b872cc0d-0e52-4b7f-b102-3924e2bd8211",
      },
    ])
    .onConflict("category_id")
    .ignore();
}

export async function down(knex) {
  await knex("categories")
    .whereIn("category_id", [
      "b872cc0d-0e52-4b7f-b102-3924e2bd8211",
      "40ac1617-9404-4a8a-83db-ae8b6d4dd18a",
      "f65539e0-8a97-4585-b71a-a53f26851bd8",
      "0640361f-7aa9-48fa-9ee8-c712fc908295",
      "6bdf0899-dbe6-4eb8-93a0-37814c9a46da",
      "60dc6c1f-0590-4056-9a15-66745d230cf2",
      "44fe4dcc-6171-43a1-8a56-f14bc67b7fdd",
      "0640361f-7aa9-48fa-9ee8-c712fc908206",
      "6901ddb8-6ae1-4891-98e4-99f5efb8c3b8",
    ])
    .del();
}
