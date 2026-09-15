from typing import Any

from psycopg2 import sql


def parse_filter_operators(
    tbl: str, col: str, op: str, val: str | int | float | bool | list
):
    match op:
        case "_eq":
            return sql.SQL("{} = {}").format(sql.Identifier(tbl, col), sql.Literal(val))
        case "_neq":
            return sql.SQL("{} <> {}").format(
                sql.Identifier(tbl, col), sql.Literal(val)
            )
        case "_icontains":
            return sql.SQL("{} ILIKE {}").format(
                sql.Identifier(tbl, col),
                sql.Literal("%" + str(val).replace("%", "\\%") + "%"),
            )
        case "_ncontains":
            return sql.SQL("{} NOT LIKE {}").format(
                sql.Identifier(tbl, col),
                sql.Literal("%" + str(val).replace("%", "\\%") + "%"),
            )
        case "_istarts_with":
            return sql.SQL("{} ILIKE {}").format(
                sql.Identifier(tbl, col),
                sql.Literal(str(val).replace("%", "\\%") + "%"),
            )
        case "_nistarts_with":
            return sql.SQL("{} NOT ILIKE {}").format(
                sql.Identifier(tbl, col),
                sql.Literal(str(val).replace("%", "\\%") + "%"),
            )
        case "_iends_with":
            return sql.SQL("{} ILIKE {}").format(
                sql.Identifier(tbl, col),
                sql.Literal("%" + str(val).replace("%", "\\%")),
            )
        case "_niends_with":
            return sql.SQL("{} ILIKE {}").format(
                sql.Identifier(tbl, col),
                sql.Literal("%" + str(val).replace("%", "\\%")),
            )
        case "_in":
            if isinstance(val, list):
                return sql.SQL("{} IN ({})").format(
                    sql.Identifier(tbl, col),
                    sql.SQL(",").join(sql.Literal(x) for x in val),
                )
            else:
                raise Exception(f"Expected array for {op} operator")
        case "_nin":
            if isinstance(val, list):
                return sql.SQL("{} NOT IN ({})").format(
                    sql.Identifier(tbl, col),
                    sql.SQL(",").join(sql.Literal(x) for x in val),
                )
            else:
                raise Exception(f"Expected array for {op} operator")
        case "_null":
            return sql.SQL("{} IS NULL").format(sql.Identifier(tbl, col))
        case "_nnull":
            return sql.SQL("{} IS NOT NULL").format(sql.Identifier(tbl, col))
        case "_empty":
            return sql.SQL("{} IN (NULL, '')").format(sql.Identifier(tbl, col))
        case "_nempty":
            return sql.SQL("{} NOT IN (NULL, '')").format(sql.Identifier(tbl, col))
        case "_lt":
            return sql.SQL("{} < {}").format(sql.Identifier(tbl, col), sql.Literal(val))
        case "_lte":
            return sql.SQL("{} <= {}").format(
                sql.Identifier(tbl, col), sql.Literal(val)
            )
        case "_gt":
            return sql.SQL("{} > {}").format(sql.Identifier(tbl, col), sql.Literal(val))
        case "_gte":
            return sql.SQL("{} >= {}").format(
                sql.Identifier(tbl, col), sql.Literal(val)
            )
        case _:
            raise Exception(f"Unexpected operator {op} in filter")


def parse_filter_obj(
    table_name: str,
    filter_obj: dict[str, dict[str, str | int | float | bool | list]] | Any,
):
    if isinstance(filter_obj, dict):
        if len(filter_obj.items()):
            k1, v1 = next(iter(filter_obj.items()))
            if k1.startswith("_"):
                if k1 in ["_and", "_or"]:
                    if not isinstance(v1, list):
                        raise Exception(f"Expected array for {k1} value")
                    return sql.SQL("({})").format(
                        sql.SQL(" OR " if k1 == "_or" else " AND ").join(
                            parse_filter(table_name, v1)
                        )
                    )
                raise Exception(f"Unexpected key {k1} in filter")
            else:
                if not isinstance(v1, dict):
                    raise Exception(f"Expected object for {k1} value")
                k2, v2 = next(iter(v1.items()))
                return parse_filter_operators(table_name, k1, k2, v2)
        else:
            raise Exception("Unexpected empty object in filter")
    else:
        raise Exception("Filter must be object")


def parse_filter(
    table_name: str,
    filter_list: list[dict[str, Any]],
):
    return [parse_filter_obj(table_name, filter_obj) for filter_obj in filter_list]
