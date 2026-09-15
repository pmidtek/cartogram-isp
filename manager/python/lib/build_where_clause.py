def build_where_clause(input_table):
    conditions = []
    for entry in input_table:
        if "?" in entry:
            table_name, query = entry.split("?")
            key_value_pairs = query.split("&")
            for pair in key_value_pairs:
                if "=" in pair:
                    key, value = pair.split("=")
                    conditions.append(f"{table_name}.{key} = '{value}'")
        else:
            continue

    where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""
    return where_clause