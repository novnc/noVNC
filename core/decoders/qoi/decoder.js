let wasm;
const heap = new Array(32).fill(undefined);
heap.push(undefined, null, true, false);

function getObject(idx) {
  return heap[idx];
}
let heap_next = heap.length;

function dropObject(idx) {
  if (idx < 36) return;
  heap[idx] = heap_next;
  heap_next = idx;
}

function takeObject(idx) {
  const ret = getObject(idx);
  dropObject(idx);
  return ret;
}
const cachedTextDecoder = new TextDecoder('utf-8', {
  ignoreBOM: true,
  fatal: true
});
cachedTextDecoder.decode();
let cachegetUint8Memory0 = null;

function getUint8Memory0() {
  if (cachegetUint8Memory0 === null || cachegetUint8Memory0.buffer !== wasm.memory.buffer) {
    cachegetUint8Memory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachegetUint8Memory0;
}

function getStringFromWasm0(ptr, len) {
  return cachedTextDecoder.decode(getUint8Memory0().subarray(ptr, ptr + len));
}

let cachegetInt32Memory0 = null;

function getInt32Memory0() {
  if (cachegetInt32Memory0 === null || cachegetInt32Memory0.buffer !== wasm.memory.buffer) {
    cachegetInt32Memory0 = new Int32Array(wasm.memory.buffer);
  }
  return cachegetInt32Memory0;
}

function getArrayU8FromWasm0(ptr, len) {
  return getUint8Memory0().subarray(ptr / 1, ptr / 1 + len);
}

let WASM_VECTOR_LEN = 0;

function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1);
  getUint8Memory0().set(arg, ptr / 1);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
/**
 * @param {Uint8Array} bytes
 * @returns {ImageData}
 */
function decode_qoi(bytes) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.decode_qoi(retptr, ptr0, len0);
    var r0 = getInt32Memory0()[retptr / 4 + 0];
    var r1 = getInt32Memory0()[retptr / 4 + 1];
    var r2 = getInt32Memory0()[retptr / 4 + 2];
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

function addHeapObject(obj) {
  if (heap_next === heap.length) heap.push(heap.length + 1);
  const idx = heap_next;
  heap_next = heap[idx];

  heap[idx] = obj;
  return idx;
}

const cachedTextEncoder = new TextEncoder('utf-8');

const encodeString = (typeof cachedTextEncoder.encodeInto === 'function' ?
  function(arg, view) {
    return cachedTextEncoder.encodeInto(arg, view);
  } :
  function(arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
      read: arg.length,
      written: buf.length
    };
  });

function passStringToWasm0(arg, malloc, realloc) {

  if (realloc === undefined) {
    const buf = cachedTextEncoder.encode(arg);
    const ptr = malloc(buf.length);
    getUint8Memory0().subarray(ptr, ptr + buf.length).set(buf);
    WASM_VECTOR_LEN = buf.length;
    return ptr;
  }

  let len = arg.length;
  let ptr = malloc(len);

  const mem = getUint8Memory0();

  let offset = 0;

  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 0x7F) break;
    mem[ptr + offset] = code;
  }

  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset);
    }
    ptr = realloc(ptr, len, len = offset + arg.length * 3);
    const view = getUint8Memory0().subarray(ptr + offset, ptr + len);
    const ret = encodeString(arg, view);

    offset += ret.written;
  }

  WASM_VECTOR_LEN = offset;
  return ptr;
}

let cachegetUint8ClampedMemory0 = null;

function getUint8ClampedMemory0() {
  if (cachegetUint8ClampedMemory0 === null || cachegetUint8ClampedMemory0.buffer !== wasm.memory.buffer) {
    cachegetUint8ClampedMemory0 = new Uint8ClampedArray(wasm.memory.buffer);
  }
  return cachegetUint8ClampedMemory0;
}

function getClampedArrayU8FromWasm0(ptr, len) {
  return getUint8ClampedMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function handleError(f, args) {
  try {
    return f.apply(this, args);
  } catch (e) {
    wasm.__wbindgen_exn_store(addHeapObject(e));
  }
}
/**
 */
class QoiImage {

  static __wrap(ptr) {
    const obj = Object.create(QoiImage.prototype);
    obj.ptr = ptr;

    return obj;
  }

  __destroy_into_raw() {
    const ptr = this.ptr;
    this.ptr = 0;

    return ptr;
  }

  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_qoiimage_free(ptr);
  }
  /**
   */
  constructor() {
    const ret = wasm.qoiimage_new();
    return QoiImage.__wrap(ret);
  }
  /**
   * @returns {number}
   */
  get_width() {
    const ret = wasm.qoiimage_get_width(this.ptr);
    return ret >>> 0;
  }
  /**
   * @returns {number}
   */
  get_height() {
    const ret = wasm.qoiimage_get_height(this.ptr);
    return ret >>> 0;
  }
  /**
   * @returns {number}
   */
  get_channels() {
    const ret = wasm.qoiimage_get_channels(this.ptr);
    return ret;
  }
  /**
   * @returns {Uint8Array}
   */
  get_bytes() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.qoiimage_get_bytes(retptr, this.ptr);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      var v0 = getArrayU8FromWasm0(r0, r1).slice();
      wasm.__wbindgen_free(r0, r1 * 1);
      return v0;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
}

async function load(module, imports) {
  if (typeof Response === 'function' && module instanceof Response) {
    const bytes = await module.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const instance = await WebAssembly.instantiate(module, imports);

    if (instance instanceof WebAssembly.Instance) {
      return {
        instance,
        module
      };

    } else {
      return instance;
    }
  }
}

async function init(input) {
  if (typeof input === 'undefined') {
    input = path + 'core/decoders/qoi/qoi_viewer_bg.wasm';
  }
  const imports = {};
  imports.wbg = {};
  imports.wbg.__wbg_new_693216e109162396 = function() {
    const ret = new Error();
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_stack_0ddaca5d1abfb52f = function(arg0, arg1) {
    const ret = getObject(arg1).stack;
    const ptr0 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len0;
    getInt32Memory0()[arg0 / 4 + 0] = ptr0;
  };
  imports.wbg.__wbg_error_09919627ac0992f5 = function(arg0, arg1) {
    try {
      console.error(getStringFromWasm0(arg0, arg1));
    } finally {
      wasm.__wbindgen_free(arg0, arg1);
    }
  };
  imports.wbg.__wbindgen_object_drop_ref = function(arg0) {
    takeObject(arg0);
  };
  imports.wbg.__wbg_newwithu8clampedarrayandsh_87d2f0a48030f922 = function() {
    return handleError(function(arg0, arg1, arg2, arg3) {
      const ret = new ImageData(getClampedArrayU8FromWasm0(arg0, arg1), arg2 >>> 0, arg3 >>> 0);
      return addHeapObject(ret);
    }, arguments)
  };
  imports.wbg.__wbindgen_throw = function(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
  };
  if (typeof input === 'string' || (typeof Request === 'function' && input instanceof Request) || (typeof URL === 'function' && input instanceof URL)) {
    input = fetch(input);
  }
  const {
    instance,
    module
  } = await load(await input, imports);
  wasm = instance.exports;
  init.__wbindgen_wasm_module = module;
  return wasm;
}

var path;
async function run() {
  self.addEventListener('message', async function(evt) {
    if (evt.data.path) {
      path = evt.data.path;
      await init();
      //Send message that worker is ready
      self.postMessage({
        result: 1
      })
    } else if (evt.data.freemem) {
      evt.data.freemem = null;
    } else {
      try {
        let image = evt.data.image;
        let data = new Uint8Array(image);
        let resultData = decode_qoi(data);
        let img = {
          colorSpace: resultData.colorSpace,
          width: resultData.width,
          height: resultData.height
        };
        var buff = new ArrayBuffer(resultData.data.length);
        new Uint8Array(buff).set(new Uint8Array(resultData.data));
        self.postMessage({
          result: 0,
          img: img,
          width: evt.data.width,
          height: evt.data.height,
          x: evt.data.x,
          y: evt.data.y,
          frame_id: evt.data.frame_id,
          data: buff,
          freemem: evt.data.image
        }, [buff]);
      } catch (err) {
        self.postMessage({
          result: 2,
          error: err
        });
      }
    }
  }, false);
}

run();
