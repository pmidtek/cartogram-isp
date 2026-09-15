import { quickAddJob } from "graphile-worker";
import dotenv from "dotenv";
import fs from "node:fs";
import XKT from "@xeokit/xeokit-convert/dist/xeokit-convert.cjs.js";

import configs from "@xeokit/xeokit-convert/convert2xkt.conf.js";
import { convert2xkt } from "@xeokit/xeokit-convert/dist/convert2xkt.cjs.js";
import WebIFC from "web-ifc";

// import { parseLASIntoXKTModel } from "@xeokit/xeokit-convert/src/parsers/parseLASIntoXKTModel.js";
// import { XKTModel } from "@xeokit/xeokit-convert/src/XKTModel/XKTModel.js";
// import { writeXKTModelToArrayBuffer } from "@xeokit/xeokit-convert/src/XKTModel/writeXKTModelToArrayBuffer.js";

dotenv.config();

async function enqueueGenerateSprites() {
  await quickAddJob(
    { connectionString: process.env.DB_CONNECTION_STRING },
    "generateSprites",
    { queueId: crypto.randomUUID() }
  );
}

async function convertLAS() {
  const { parseLASIntoXKTModel, writeXKTModelToArrayBuffer, XKTModel } = XKT;

  const tempInputPath = "/Users/mac/Downloads/Las_Segmen20_FIX.las";
  const tempOutputPath = "./Las_Segmen20_FIX.xkt";

  await convert2xkt({
    WebIFC,
    configs,
    source: tempInputPath,
    output: tempOutputPath,
    log: (msg) => {
      console.log(msg);
    },
  });
  return;

  const data = fs.readFileSync(tempInputPath);

  const xktModel = new XKTModel();

  console.info("Converting LAS/LAZ to XKT");
  await parseLASIntoXKTModel({
    data,
    xktModel,
    log: (msg) => console.info(msg),
  });
  console.info("parsing successful");
  xktModel.finalize();

  const arrayBuffer = writeXKTModelToArrayBuffer(
    xktModel,
    "{}",
    {},
    { zip: false }
  );

  fs.writeFileSync(tempOutputPath, Buffer.from(arrayBuffer));
}

const test = async () => {
  // enqueueGenerateSprites();
  convertLAS();
};
test();
