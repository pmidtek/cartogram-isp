import io
import zipfile
import xml.etree.ElementTree as ET

import pandas as pd


def _local_name(tag):
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _text(el):
    if el is None or el.text is None:
        return None
    value = el.text.strip()
    return value or None


def _find_child(el, name):
    for child in el:
        if _local_name(child.tag) == name:
            return child
    return None


def _find_descendant(el, name):
    for child in el.iter():
        if child is not el and _local_name(child.tag) == name:
            return child
    return None


def extract_kml_bytes(file_bytes):
    """Return raw KML bytes, unwrapping the archive when the input is a KMZ."""
    if not file_bytes[:4] == b"PK\x03\x04":
        return file_bytes

    with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".kml")]
        if not names:
            raise ValueError("KMZ tidak berisi file .kml")
        # doc.kml is the conventional entry point, otherwise take the shallowest
        names.sort(key=lambda n: (n.lower() != "doc.kml", n.count("/"), n.lower()))
        return zf.read(names[0])


def _parse_coordinates(placemark):
    """Return (longitude, latitude) of the first Point in a Placemark."""
    point = _find_descendant(placemark, "Point")
    if point is None:
        return None

    coordinates = _text(_find_child(point, "coordinates"))
    if not coordinates:
        return None

    # KML coordinates are "lon,lat[,alt]" tuples separated by whitespace
    first_tuple = coordinates.split()[0]
    parts = first_tuple.split(",")
    if len(parts) < 2:
        return None

    try:
        return float(parts[0]), float(parts[1])
    except ValueError:
        return None


def _parse_extended_data(placemark):
    """Flatten <ExtendedData> into a dict of attribute name -> value."""
    attributes = {}
    extended_data = _find_descendant(placemark, "ExtendedData")
    if extended_data is None:
        return attributes

    for el in extended_data.iter():
        name = _local_name(el.tag)
        key = el.get("name")
        if not key:
            continue
        if name == "Data":
            attributes[key] = _text(_find_child(el, "value"))
        elif name == "SimpleData":
            attributes[key] = _text(el)

    return attributes


def parse_kml_points(file_bytes):
    """Parse KML/KMZ point placemarks into a DataFrame.

    Every <Placemark> becomes a row with `name`, `description`, `latitude` and
    `longitude` columns plus one column per <ExtendedData> attribute, so the
    result can be consumed exactly like a spreadsheet import.
    """
    try:
        root = ET.fromstring(extract_kml_bytes(file_bytes))
    except ET.ParseError as err:
        raise ValueError(f"File KML tidak valid: {err}")

    rows = []
    for placemark in root.iter():
        if _local_name(placemark.tag) != "Placemark":
            continue

        row = _parse_extended_data(placemark)

        name = _text(_find_child(placemark, "name"))
        if name is not None or "name" not in row:
            row["name"] = name

        description = _text(_find_child(placemark, "description"))
        if description is not None or "description" not in row:
            row["description"] = description

        coordinates = _parse_coordinates(placemark)
        row["longitude"], row["latitude"] = coordinates if coordinates else (None, None)

        rows.append(row)

    if not rows:
        raise ValueError("File KML/KMZ tidak memiliki Placemark.")

    return pd.DataFrame(rows)
