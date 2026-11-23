import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/juyeongnoh/js-hwp/packages/hwp/package.json')
const CFB = require('cfb'); const zlib = require('node:zlib')
const [src, dst, value] = process.argv.slice(2)
const c = CFB.read(readFileSync(src), { type: 'buffer' })
const compressed = CFB.find(c, 'FileHeader').content[36] & 1
const entry = CFB.find(c, '/BodyText/Section0')
let data = new Uint8Array(entry.content); if (compressed) data = new Uint8Array(zlib.inflateRawSync(data))
const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
let o = 0, n = 0
while (o + 4 <= data.length) { const h = v.getUint32(o, true); o += 4; let size = h >>> 20; if (size === 0xfff) { size = v.getUint32(o, true); o += 4 }
  if ((h & 0x3ff) === 76) { data[o + 196 + 12] = Number(value); n++ } o += size }
const out = compressed ? zlib.deflateRawSync(data) : data
CFB.utils.cfb_add(c, '/BodyText/Section0', Buffer.from(out))
writeFileSync(dst, CFB.write(c, { type: 'buffer' }))
console.log('patched', n)
