import { readdirSync, readFileSync } from "node:fs";
import { parseHwp } from "@js-hwp/hwp";

const fileList = readdirSync("./");
console.log(fileList);

// const doc = parseHwp(new Uint8Array(readFileSync(process.argv[2]!)));
// console.log(doc);
