import { readFileSync, writeFileSync } from "node:fs";
import { parseHwp, serializeHwp } from "@js-hwp/hwp";
writeFileSync(process.argv[3]!, serializeHwp(parseHwp(new Uint8Array(readFileSync(process.argv[2]!)))));
