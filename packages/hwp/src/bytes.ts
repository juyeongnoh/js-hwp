/**
 * HWP 원시 타입을 위한 리틀 엔디언 바이트 리더와 라이터.
 *
 * 이 코드의 모양을 결정하는 포맷 규칙 둘:
 *
 * - 리더는 자기가 아는 필드보다 *긴* 레코드를 견뎌야 한다. 나중 버전의 한글이
 *   기존 레코드에 필드를 덧붙이기 때문이다. 그래서 {@link ByteReader.remaining}과
 *   파서 곳곳의 `hasMore` 가드가 있다.
 *
 * - 리더는 마찬가지로 *짧은* 레코드도 견뎌야 한다. 오래된 파일은 그 필드가
 *   생기기 전 것이기 때문이다. 그래서 모든 `readOptional*` 헬퍼가 있다.
 */

export class HwpFormatError extends Error {
  override name = "HwpFormatError";
}

export class ByteReader {
  readonly #view: DataView;
  readonly #bytes: Uint8Array;
  #offset = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get offset(): number {
    return this.#offset;
  }

  set offset(value: number) {
    if (value < 0 || value > this.#bytes.length) {
      throw new HwpFormatError(
        `Seek out of range: ${value} (length ${this.#bytes.length})`,
      );
    }
    this.#offset = value;
  }

  get length(): number {
    return this.#bytes.length;
  }

  get remaining(): number {
    return this.#bytes.length - this.#offset;
  }

  hasMore(bytes = 1): boolean {
    return this.remaining >= bytes;
  }

  #need(bytes: number): void {
    if (this.remaining < bytes) {
      throw new HwpFormatError(
        `Unexpected end of record: need ${bytes} bytes at offset ${this.#offset}, have ${this.remaining}`,
      );
    }
  }

  uint8(): number {
    this.#need(1);
    return this.#view.getUint8(this.#offset++);
  }

  int8(): number {
    this.#need(1);
    return this.#view.getInt8(this.#offset++);
  }

  uint16(): number {
    this.#need(2);
    const value = this.#view.getUint16(this.#offset, true);
    this.#offset += 2;
    return value;
  }

  int16(): number {
    this.#need(2);
    const value = this.#view.getInt16(this.#offset, true);
    this.#offset += 2;
    return value;
  }

  uint32(): number {
    this.#need(4);
    const value = this.#view.getUint32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  int32(): number {
    this.#need(4);
    const value = this.#view.getInt32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  /** HWPUNIT: 부호 없는 1/7200인치 길이. */
  hwpUnit(): number {
    return this.uint32();
  }

  /** SHWPUNIT: 부호 있는 1/7200인치 길이. */
  sHwpUnit(): number {
    return this.int32();
  }

  /** HWPUNIT16: 16비트에 들어가는 부호 있는 1/7200인치 길이. */
  hwpUnit16(): number {
    return this.int16();
  }

  /**
   * COLORREF. `0x00BBGGRR`로 저장된다. 모델은 `0xRRGGBB`를 쓰므로 빨강과
   * 파랑 바이트를 여기서만, 다른 데서는 안 바꾼다.
   */
  color(): number {
    const raw = this.uint32();
    return (
      (((raw & 0xff) << 16) | (raw & 0xff00) | ((raw >>> 16) & 0xff)) >>> 0
    );
  }

  /** 원시 COLORREF. 왕복을 위해 최상위 바이트를 보존한다. */
  rawColor(): number {
    return this.uint32();
  }

  /** UTF-16 코드 단위 개수를 담은 WORD, 그다음 코드 단위 자체. */
  string(): string {
    const length = this.uint16();
    return this.wchars(length);
  }

  /** 길이 접두부 없이 UTF-16 코드 단위 `count`개. */
  wchars(count: number): string {
    this.#need(count * 2);
    let out = "";
    // 덩어리로 만든다. 거대한 스프레드를 쓴 String.fromCharCode는 스택을 터뜨린다.
    const CHUNK = 4096;
    const codes: number[] = [];
    for (let i = 0; i < count; i++) {
      codes.push(this.#view.getUint16(this.#offset + i * 2, true));
      if (codes.length === CHUNK) {
        out += String.fromCharCode(...codes);
        codes.length = 0;
      }
    }
    if (codes.length > 0) out += String.fromCharCode(...codes);
    this.#offset += count * 2;
    return out;
  }

  bytes(count: number): Uint8Array {
    this.#need(count);
    const out = this.#bytes.subarray(this.#offset, this.#offset + count);
    this.#offset += count;
    return out;
  }

  /** 커서에서 끝까지 전부. */
  rest(): Uint8Array {
    return this.bytes(this.remaining);
  }

  skip(count: number): void {
    this.#need(count);
    this.#offset += count;
  }

  /** 레코드가 담을 만큼 길 때만 필드를 읽는다. */
  optionalUint8(fallback = 0): number {
    return this.hasMore(1) ? this.uint8() : fallback;
  }

  optionalUint16(fallback = 0): number {
    return this.hasMore(2) ? this.uint16() : fallback;
  }

  optionalInt16(fallback = 0): number {
    return this.hasMore(2) ? this.int16() : fallback;
  }

  optionalUint32(fallback = 0): number {
    return this.hasMore(4) ? this.uint32() : fallback;
  }

  optionalInt32(fallback = 0): number {
    return this.hasMore(4) ? this.int32() : fallback;
  }

  optionalColor(fallback = 0): number {
    return this.hasMore(4) ? this.color() : fallback;
  }

  optionalString(fallback = ""): string {
    if (!this.hasMore(2)) return fallback;
    const start = this.#offset;
    const length = this.uint16();
    if (this.remaining < length * 2) {
      this.#offset = start;
      return fallback;
    }
    return this.wchars(length);
  }
}

export class ByteWriter {
  #chunks: Uint8Array[] = [];
  #buffer = new Uint8Array(1024);
  #length = 0;

  get length(): number {
    return this.#chunks.reduce((sum, c) => sum + c.length, 0) + this.#length;
  }

  #ensure(bytes: number): void {
    if (this.#length + bytes <= this.#buffer.length) return;
    this.#chunks.push(this.#buffer.subarray(0, this.#length));
    this.#buffer = new Uint8Array(Math.max(1024, bytes * 2));
    this.#length = 0;
  }

  uint8(value: number): this {
    this.#ensure(1);
    this.#buffer[this.#length++] = value & 0xff;
    return this;
  }

  int8(value: number): this {
    return this.uint8(value < 0 ? value + 0x100 : value);
  }

  uint16(value: number): this {
    this.#ensure(2);
    const v = value & 0xffff;
    this.#buffer[this.#length++] = v & 0xff;
    this.#buffer[this.#length++] = (v >>> 8) & 0xff;
    return this;
  }

  int16(value: number): this {
    return this.uint16(value < 0 ? value + 0x10000 : value);
  }

  uint32(value: number): this {
    this.#ensure(4);
    const v = value >>> 0;
    this.#buffer[this.#length++] = v & 0xff;
    this.#buffer[this.#length++] = (v >>> 8) & 0xff;
    this.#buffer[this.#length++] = (v >>> 16) & 0xff;
    this.#buffer[this.#length++] = (v >>> 24) & 0xff;
    return this;
  }

  int32(value: number): this {
    return this.uint32(value < 0 ? value + 0x100000000 : value);
  }

  hwpUnit(value: number): this {
    return this.uint32(Math.round(value));
  }

  sHwpUnit(value: number): this {
    return this.int32(Math.round(value));
  }

  hwpUnit16(value: number): this {
    return this.int16(Math.round(value));
  }

  /** `0xRRGGBB`를 HWP의 `0x00BBGGRR`로 내보낸다. */
  color(value: number): this {
    const r = (value >>> 16) & 0xff;
    const g = (value >>> 8) & 0xff;
    const b = value & 0xff;
    return this.uint32(((b << 16) | (g << 8) | r) >>> 0);
  }

  rawColor(value: number): this {
    return this.uint32(value);
  }

  /** 코드 단위 개수를 담은 WORD, 그다음 UTF-16LE 데이터. NUL 종결자 없음. */
  string(value: string): this {
    this.uint16(value.length);
    return this.wchars(value);
  }

  wchars(value: string): this {
    for (let i = 0; i < value.length; i++) this.uint16(value.charCodeAt(i));
    return this;
  }

  bytes(value: Uint8Array): this {
    this.#ensure(value.length);
    this.#buffer.set(value, this.#length);
    this.#length += value.length;
    return this;
  }

  zeros(count: number): this {
    this.#ensure(count);
    this.#length += count;
    return this;
  }

  finish(): Uint8Array {
    const total = this.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.#chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    out.set(this.#buffer.subarray(0, this.#length), offset);
    return out;
  }
}

/** 32비트 비트필드에서 `start`부터 `count`비트를 읽는다. */
export const bits = (value: number, start: number, end: number): number => {
  const width = end - start + 1;
  return (value >>> start) & ((1 << width) - 1);
};

/** 비트 하나를 검사한다. */
export const bit = (value: number, index: number): boolean =>
  ((value >>> index) & 1) === 1;

/** 누산기의 `start..end` 비트에 `value`를 넣는다. */
export const setBits = (
  target: number,
  start: number,
  end: number,
  value: number,
): number => {
  const width = end - start + 1;
  const mask = ((1 << width) - 1) << start;
  return ((target & ~mask) | ((value << start) & mask)) >>> 0;
};

export const setBit = (
  target: number,
  index: number,
  value: boolean | undefined,
): number =>
  value ? (target | (1 << index)) >>> 0 : (target & ~(1 << index)) >>> 0;
