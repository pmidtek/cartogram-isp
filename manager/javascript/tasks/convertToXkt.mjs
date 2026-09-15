import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import configs from "@xeokit/xeokit-convert/convert2xkt.conf.js";
import { convert2xkt } from "@xeokit/xeokit-convert/dist/convert2xkt.cjs.js";
import WebIFC from "web-ifc";

import minioClient from "../utils/minioClient.mjs";

export default async function ({ objectKey, uploader, queueId }, helpers) {
  const { withPgClient, logger } = helpers;
  logger.info(`Received convertToXkt task with queue ID: ${queueId}`);

  const bucketName = process.env.STORAGE_S3_BUCKET;
  const storageRoot = process.env.STORAGE_S3_ROOT
    ? process.env.STORAGE_S3_ROOT + "/"
    : "";
  const tempDir = path.join(os.tmpdir(), `geodashboard_xkt_${objectKey}`);
  const tempInputPath = path.join(tempDir, objectKey);
  const tempOutputPath = tempInputPath + ".xkt";

  try {
    await withPgClient((pgClient) =>
      pgClient.query(
        "UPDATE other_processing_queue SET date_updated = CURRENT_TIMESTAMP, status = 'consumed' WHERE id = $1",
        [queueId]
      )
    );

    logger.info("Downloading file");
    await minioClient.fGetObject(
      bucketName,
      storageRoot + objectKey,
      tempInputPath
    );

    await convert2xkt({
      WebIFC,
      configs,
      source: tempInputPath,
      output: tempOutputPath,
      log: (msg) => {
        console.log(msg);
      },
    });

    const xktObjectKey = `xkt/${queueId}.xkt`;
    logger.info(`Uploading XKT as ${xktObjectKey}`);
    await minioClient.fPutObject(
      bucketName,
      storageRoot + xktObjectKey,
      tempOutputPath
    );

    logger.info("Registering XKT to table");
    await withPgClient((pgClient) =>
      pgClient.query("INSERT INTO xkt(id, user_created) VALUES ($1, $2)", [
        queueId,
        uploader,
      ])
    );

    await withPgClient((pgClient) =>
      pgClient.query(
        "UPDATE other_processing_queue SET date_updated = CURRENT_TIMESTAMP, status = 'done', results = $1 WHERE id = $2",
        [{ xktObjectKey }, queueId]
      )
    );
  } catch (error) {
    await withPgClient((pgClient) =>
      pgClient.query(
        "UPDATE other_processing_queue SET date_updated = CURRENT_TIMESTAMP, status = 'done', results = $1 WHERE id = $2",
        [{ error, stack: error.stack }, queueId]
      )
    );
    logger.error(error);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
