import json
import os
import re

from urllib import request
from utils import logger


def import_file_to_directus(
    url_file: str, folder: str = "d62759d2-2090-4fec-8f87-3cf71434f385"
):
    try:
        if not url_file:
            return None

        url_file = str(url_file).strip()
        if "drive.google.com" in url_file:
            url_file = normalize_drive_url(url_file)

        base_url = os.environ.get("DIRECTUS_PUBLIC_URL", "http://directus:8055")
        admin_token = os.environ.get("ADMIN_TOKEN", "")

        endpoint = f"{base_url}/files/import?access_token={admin_token}"

        payload = {
            "url": url_file,
            "data": {"folder": folder},
        }

        data = json.dumps(payload).encode("utf-8")

        req = request.Request(
            endpoint,
            data=data,
            method="POST",
            headers={"Content-Type": "application/json"},
        )

        with request.urlopen(req, timeout=120) as resp:
            body = resp.read().decode("utf-8")
            res = json.loads(body)

        file_id = res.get("data", {}).get("id")
        logger.info(f"Import file to Directus success")
        return file_id if file_id else None

    except Exception as e:
        logger.warning(f"Import file to Directus failed: {e}")
        return None


def normalize_drive_url(url: str):
    if not url:
        return None

    url = url.strip()

    # format: /file/d/<id>/view
    m = re.search(r"/file/d/([a-zA-Z0-9_-]+)", url)
    if m:
        file_id = m.group(1)
        return f"https://drive.google.com/uc?export=download&id={file_id}"

    # format: open?id=<id>
    m = re.search(r"[?&]id=([a-zA-Z0-9_-]+)", url)
    if m:
        file_id = m.group(1)
        return f"https://drive.google.com/uc?export=download&id={file_id}"

    return url
