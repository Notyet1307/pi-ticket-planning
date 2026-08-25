import fs from "node:fs";
import path from "node:path";

import { generateBuildMetadata } from "../installation/build-metadata.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
if (!args.has("--out") || process.argv.length % 2 !== 0) throw new Error("usage: --out FILE [--source-commit SHA] [--build-time ISO]");
const output = path.resolve(args.get("--out"));
const metadata = generateBuildMetadata({ sourceCommit: args.get("--source-commit"), buildTime: args.get("--build-time") });
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o644 });
process.stdout.write(`${output}\n`);
