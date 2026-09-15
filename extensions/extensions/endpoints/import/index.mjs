import {
  InvalidPayloadError,
  ServiceUnavailableError,
  ForbiddenError,
} from "@directus/errors";
import minioClient from "../../utils/minioClient.mjs";
import {
  storageRoot,
  storageLocation,
  storageBucket,
} from "../../utils/storageInfo.mjs";
import clearCache from "../../utils/clearCache.mjs";
import formidable from "formidable";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { LAYER_DATA_FOLDER_ID } from "../../migrations/const/FOLDER_IDS.mjs";

const vectorAllowedDataType = [
  "shapefile",
  "kml",
  "xls",
  "xlsx",
  "csv",
  "geojson",
  "dxf",
  "dwg",
  "gpkg",
  "gdb",
];
const taskAllowedDataType = [
  "import_site_point",
  "register_asset",
  "update_asset",
];
const taskAllowedExtension = {
  import_site_point: [".xlsx", ".kml", ".kmz"],
  register_asset: [".xlsx"],
  update_asset: [".xlsx"],
};
const extensionMimetype = {
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".kml": "application/vnd.google-earth.kml+xml",
  ".kmz": "application/vnd.google-earth.kmz",
};
export default (router, { env, database, logger }) => {
  router.post("/vector-tiles/append", (req, res, next) => {
    const { accountability } = req;

    if (
      !accountability.admin &&
      !accountability.permissions.some(
        (el) => el.collection === "directus_files" && el.action === "create"
      )
    ) {
      return next(new ForbiddenError());
    }

    const form = formidable({
      multiples: false,
      uploadDir: "./uploads",
      keepExtensions: true,
      maxFileSize: parseInt(
        env.FILES_MAX_UPLOAD_SIZE || `${10000 * 1024 * 1024}`
      ),
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        logger.error(err);
        return next(
          new ServiceUnavailableError({
            service: "import/vector-tiles/append",
            reason: "Failed to process file",
          })
        );
      }
      try {
        const file = files.file?.[0] || null;
        const type = fields.type?.[0] || null;
        const layer_name = fields.layer_name?.[0] || null;

        if (!file) {
          fs.unlinkSync(file.filepath);
          return next(
            new InvalidPayloadError({ reason: "file on body required" })
          );
        }
        if (!type) {
          fs.unlinkSync(file.filepath);
          return next(
            new InvalidPayloadError({ reason: "type on body required" })
          );
        }
        if (!vectorAllowedDataType.includes(type)) {
          fs.unlinkSync(file.filepath);
          return next(new InvalidPayloadError({ reason: "type not allowed" }));
        }
        if (!layer_name) {
          fs.unlinkSync(file.filepath);
          return next(
            new InvalidPayloadError({ reason: "layer_name on body required" })
          );
        }

        const { rows: tableNameExisting } = await database.raw(
          `SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = ?;`,
          [layer_name]
        );
        if (tableNameExisting.length == 0) {
          fs.unlinkSync(file.filepath);
          return next(
            new InvalidPayloadError({ reason: "layer_name not exist" })
          );
        }

        const fileStream = fs.createReadStream(file.filepath);
        const fileId = randomUUID();
        const fileNameMinio =
          storageRoot + `${fileId}-${file.originalFilename}`;
        const fileNameDisk = `${fileId}-${file.originalFilename}`;
        const fileSize = file.size;
        const fileMimetype = file.mimetype;
        const bucketName = storageBucket;

        await minioClient.putObject(
          bucketName,
          fileNameMinio,
          fileStream,
          fileSize,
          {
            "Content-Type": fileMimetype,
          }
        );
        await database.raw(
          `INSERT INTO public.directus_files (id, "storage", filename_disk, filename_download, title, "type", folder, uploaded_by, uploaded_on, filesize)
            VALUES (?, ?, ?, ?, ?, ?, '${LAYER_DATA_FOLDER_ID}', ?, CURRENT_TIMESTAMP, ?);`,
          [
            fileId,
            storageLocation,
            fileNameDisk,
            file.originalFilename,
            file.originalFilename,
            fileMimetype,
            accountability.user,
            fileSize,
          ]
        );
        fs.unlinkSync(file.filepath);

        const message_id = randomUUID();
        const now = new Date();
        let is_zipped = false;
        if (type === "shapefile") is_zipped = true;
        await database
          .insert({
            message_id: message_id,
            queue_name: "default",
            state: "queued",
            mtime: now.toISOString(),
            message: JSON.stringify({
              args: [],
              kwargs: {
                object_key: fileNameDisk,
                uploader: accountability.user,
                format_file: type,
                is_zipped: is_zipped,
                table_name: layer_name,
                additional_config: null,
              },
              options: {},
              actor_name: "transform_append",
              message_id: message_id,
              queue_name: "default",
              message_timestamp: now.getTime().toString(),
            }),
            uploader: accountability.user,
          })
          .into("geoprocessing_queue");

        await clearCache(logger, env);
        return res.send({
          data: {
            message: "File uploaded successfully",
            filename: fileNameDisk,
            bucket: bucketName,
            message_id: message_id,
          },
        });
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "import/vector-tiles/append",
            reason: "Failed to import vector-tiles",
          })
        );
      }
    });
  });
  router.post("/data", (req, res, next) => {
    const { accountability } = req;
    if (
      !accountability.admin &&
      !accountability.permissions.some(
        (el) => el.collection === "directus_files" && el.action === "create"
      )
    ) {
      return next(new ForbiddenError());
    }

    const form = formidable({
      multiples: false,
      uploadDir: "./uploads",
      keepExtensions: true,
      maxFileSize: parseInt(
        env.FILES_MAX_UPLOAD_SIZE || `${10000 * 1024 * 1024}`
      ),
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        logger.error(err);
        return next(
          new ServiceUnavailableError({
            service: "import/data",
            reason: "Failed to process file",
          })
        );
      }
      const file = files.file?.[0] || null;
      const task = fields.task?.[0] || null;
      const sitePointTypeId = fields.site_point_type_id?.[0] || null;
      if (!file || !task) {
        return next(
          new InvalidPayloadError({ reason: "file & task on body required" })
        );
      }
      if (!taskAllowedDataType.includes(task)) {
        return next(new InvalidPayloadError({ reason: "task not allowed" }));
      }
      const fileId = randomUUID();
      const ext = path.extname(file.originalFilename);
      const extLower = ext.toLowerCase();
      const fileNameDisk = `${fileId}${ext}`;
      const fileNameMinio = `${storageRoot}${fileNameDisk}`;
      const bucketName = storageBucket;
      try {
        const allowedExt = taskAllowedExtension[task];
        if (!allowedExt.includes(extLower)) {
          return next(
            new InvalidPayloadError({
              reason: `Required ${allowedExt.join(" / ")} type`,
            })
          );
        }
        // formidable reports application/octet-stream for kml/kmz on most
        // clients, so derive the mimetype from the extension when we know it
        const mimetype =
          extensionMimetype[extLower] ||
          file.mimetype ||
          "application/octet-stream";

        if (sitePointTypeId && task === "import_site_point") {
          const sitePointType = /^\d+$/.test(sitePointTypeId)
            ? await database("site_point_types")
                .where({ id: Number(sitePointTypeId) })
                .first("id")
            : null;
          if (!sitePointType) {
            return next(
              new InvalidPayloadError({
                reason: "site_point_type_id not exist",
              })
            );
          }
        }

        await minioClient.fPutObject(bucketName, fileNameMinio, file.filepath, {
          "Content-Type": mimetype,
          "Content-Disposition": `attachment; filename="${file.originalFilename}"`,
        });
        await database("directus_files").insert({
          id: fileId,
          storage: storageLocation,
          filename_disk: fileNameDisk,
          filename_download: file.originalFilename,
          title: file.originalFilename,
          type: mimetype,
          folder: LAYER_DATA_FOLDER_ID,
          uploaded_by: accountability.user,
          uploaded_on: database.fn.now(),
          filesize: file.size,
        });

        const message_id = randomUUID();
        const now = new Date();

        await database
          .insert({
            message_id: message_id,
            queue_name: "default",
            task_name: task,
            state: "queued",
            mtime: now.toISOString(),
            message: JSON.stringify({
              args: [],
              kwargs: {
                object_key: fileNameDisk,
                uploader: accountability.user,
                message_id: message_id,
                ...(task === "import_site_point" && sitePointTypeId
                  ? { site_point_type_id: Number(sitePointTypeId) }
                  : {}),
              },
              options: {},
              actor_name: task,
              message_id: message_id,
              queue_name: "default",
              message_timestamp: now.getTime().toString(),
            }),
            uploader: accountability.user,
          })
          .into("geoprocessing_queue");

        await clearCache(logger, env);
        return res.send({
          data: {
            message: "File uploaded successfully",
            filename: fileNameDisk,
            message_id: message_id,
          },
        });
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "import/data",
            reason: "Failed to import data",
          })
        );
      } finally {
        if (fs.existsSync(file.filepath)) {
          await fs.promises.unlink(file.filepath);
        }
      }
    });
  });
};
