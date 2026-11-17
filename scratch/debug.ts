import { readdirSync, readFileSync } from "node:fs";
import { parseHwp } from "@js-hwp/hwp";

// const fileList = readdirSync("./fixtures/kogl_hwp");

// const hwps = fileList.map((el) => {
//   const buf = readFileSync("./fixtures/kogl_hwp/" + el);
//   return parseHwp(new Uint8Array(buf));
// });

// console.log(hwps.filter(el => el.borderFills))

// console.log(fileList);

const doc = parseHwp(new Uint8Array(readFileSync(process.argv[2]!)));
console.log();
