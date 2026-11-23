// 사용법: node patch-record.mjs <입력.hwp> <출력.hwp> <section|docinfo> <태그> <레코드 순번> <오프셋:16진수>...
// 지정한 스트림에서 태그가 같은 레코드 중 순번째(0부터) 레코드의 페이로드를 덮어쓴다.
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../../packages/hwp/package.json', import.meta.url))
const CFB = require('cfb'); const zlib = require('node:zlib')
const [src, dst, stream, tag, index, ...patches] = process.argv.slice(2)
const c = CFB.read(readFileSync(src), { type: 'buffer' })
const compressed = CFB.find(c, 'FileHeader').content[36] & 1
const path = stream === 'docinfo' ? '/DocInfo' : '/BodyText/Section0'
let data = new Uint8Array(CFB.find(c, path).content); if (compressed) data = new Uint8Array(zlib.inflateRawSync(data))
const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
let o = 0, n = 0, done = false
while (o + 4 <= data.length) { const h = v.getUint32(o, true); o += 4; let size = h >>> 20; if (size === 0xfff) { size = v.getUint32(o, true); o += 4 }
  if ((h & 0x3ff) === Number(tag) && n++ === Number(index)) {
    for (const p of patches) { const [off, hex] = p.split(':'); Buffer.from(hex, 'hex').copy(Buffer.from(data.buffer, data.byteOffset + o, size), Number(off)) }
    done = true
  }
  o += size }
if (!done) throw new Error('레코드를 찾지 못했다')
CFB.utils.cfb_add(c, path, Buffer.from(compressed ? zlib.deflateRawSync(data) : data))
writeFileSync(dst, CFB.write(c, { type: 'buffer' }))
