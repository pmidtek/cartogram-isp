import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";
import json from "@rollup/plugin-json";

const walk = (dirPath, pathArr = []) => {
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      pathArr = walk(dirPath + "/" + file, pathArr);
    } else {
      pathArr.push(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          dirPath,
          "/",
          file
        )
      );
    }
  }
  return pathArr;
};

export default [
  {
    input: [
      ...walk("extensions/endpoints"),
      ...walk("extensions/hooks"),
      ...walk("extensions/migrations"),
    ],
    plugins: [
      nodeResolve({ preferBuiltins: true }),
      commonjs(),
      json(),
      terser(),
    ],
    output: {
      dir: "./dist",
      format: "esm",
      exports: "named",
      preserveModules: true,
      preserveModulesRoot: "extensions",
      entryFileNames: "[name].mjs",
    },
  },
];
