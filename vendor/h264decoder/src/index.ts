import {h264Module as modulePromise} from "./h264.wasm.js";

type ModuleMemory = {
  HEAP8: Int8Array;
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  memory: WebAssembly.Memory;
}

type H264Exports = {
  init(ptr: number, len: number): void;
  malloc(size: number): number;
  decode(
    pStorage: number, decBuffer: number, byteLength: number,
    pPicture: number, pWidth: number, pHeight: number,
  ): number;
  h264alloc(): number;
};

const memcpy = (Module: ModuleMemory) =>
  (dest: number, src: number, num: number) => {
    Module.HEAPU8.copyWithin(dest, src, src + num);
  }

function alignUp(x: number, multiple: number) {
  const mod = x % multiple;
  return (mod > 0) ? x + multiple - mod : x;
}

const resize = (Module: ModuleMemory) => (requestedSize: number) => {
  const oldSize = Module.HEAPU8.length;
  const PAGE_MULTIPLE = 65536;
  const maxHeapSize = 2147483648;
  if (requestedSize > maxHeapSize) {
    return false;
  }
  const minHeapSize = 16777216;
  for (let cutDown = 1; cutDown <= 4; cutDown *= 2) {
    let overGrownHeapSize = oldSize * (1 + .2 / cutDown);
    overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
    const newSize = Math.min(maxHeapSize, alignUp(Math.max(minHeapSize, requestedSize, overGrownHeapSize), PAGE_MULTIPLE));
    try {
      const { memory } = Module;
      memory.grow((newSize - memory.buffer.byteLength + 65535) >>> 16);
      const { buffer } = memory;
      Module.HEAP8 = new Int8Array(buffer);
      Module.HEAPU8 = new Uint8Array(buffer);
      Module.HEAP32 = new Int32Array(buffer);
      return true;
    } catch (e) {}
  }
  return false;
}

const WASM_PAGE_SIZE = 65536;
const DYNAMIC_BASE = 5251792;
const DYNAMICTOP_PTR = 8752;
const INITIAL_INITIAL_MEMORY = 16777216;

/**
 * This class wraps the details of the h264 WASM module.
 * Each call to decode(nalu) will decode a single encoded element.
 * When decode(nalu) returns PIC_RDY, a picture is ready in the output buffer.
 */

export class H264Decoder {
  private pStorage: number;
  private pWidth: number;
  private pHeight: number;
  private pPicture: number;
  private decBuffer: number;
  private memory: ModuleMemory|null;
  private asm: H264Exports|null;

  public width = 0;
  public height = 0;
  public pic = new Uint8Array(0);

  static RDY = 0;
  static PIC_RDY = 1;
  static HDRS_RDY = 2;
  static ERROR = 3;
  static PARAM_SET_ERROR = 4;
  static MEMALLOC_ERROR = 5;

  constructor () {
    this.pStorage = 0;
    this.pWidth = 0;
    this.pHeight = 0;
    this.pPicture = 0;
    this.decBuffer = 0;
    this.memory = null;
    this.asm = null;
  }

  async init() {
    const h264Module = await modulePromise;

    const wasmMemory = new WebAssembly.Memory({
      "initial": INITIAL_INITIAL_MEMORY / WASM_PAGE_SIZE,
      "maximum": 2147483648 / WASM_PAGE_SIZE
    });

    const memory: ModuleMemory = {
      memory: wasmMemory,
      HEAP8: new Int8Array(wasmMemory.buffer),
      HEAPU8: new Uint8Array(wasmMemory.buffer),
      HEAP32: new Int32Array(wasmMemory.buffer),
    };

    memory.HEAP32[DYNAMICTOP_PTR >> 2] = DYNAMIC_BASE;

    const instantiatePromise = WebAssembly.instantiate(h264Module, {
      h264: {
        memory: wasmMemory,
        memcpy: memcpy(memory),
        resize: resize(memory),
      }
    }) as Promise<{ exports: H264Exports }>;

    const { exports: asm } = await instantiatePromise;

    this.memory = memory;
    this.asm = asm;
    this.pStorage = asm.h264alloc();
    this.pWidth = asm.malloc(4);
    this.pHeight = asm.malloc(4);
    this.pPicture = asm.malloc(4);

    this.decBuffer = asm.malloc(1024 * 1024);

    asm.init(this.pStorage, 0);
  }

  decode (nalu: Uint8Array) {
    const { memory, asm } = this;
    (memory as ModuleMemory).HEAPU8.set(nalu, this.decBuffer);

    const retCode = (asm as H264Exports).decode(
      this.pStorage, this.decBuffer, nalu.byteLength,
      this.pPicture, this.pWidth, this.pHeight,
    );

    if (retCode === H264Decoder.PIC_RDY) {
      const width = this.width = (memory as ModuleMemory).HEAP32[this.pWidth >>> 2];
      const height = this.height = (memory as ModuleMemory).HEAP32[this.pHeight >>> 2];
      const picPtr = (memory as ModuleMemory).HEAP32[this.pPicture >> 2];
      const datalen = (width * height) * 3 / 2;
      this.pic = (memory as ModuleMemory).HEAPU8.subarray(picPtr, picPtr + datalen);
    }

    return retCode;
  }
}
