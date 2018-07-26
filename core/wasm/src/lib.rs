#![feature(wasm_custom_section, wasm_import_module, use_extern_macros)]

extern crate wasm_bindgen;

use std::mem;
use std::slice;
use std::os::raw::c_void;
use wasm_bindgen::prelude::*;

// In order to work with the memory we expose allocation method
#[wasm_bindgen]
pub fn alloc(size: usize) -> *mut c_void {
  let mut buf = Vec::with_capacity(size);
  let ptr = buf.as_mut_ptr();
  mem::forget(buf);
  return ptr as *mut c_void;
}

#[wasm_bindgen]
pub fn draw(mem: *mut u32, width: usize, height: usize, frame: u32) {

  // pixels are stored in RGBA
  let sl = unsafe { slice::from_raw_parts_mut(mem, width * height) };

  for y in 0..height {
    for x in 0..width {
      let r = if (x%512) < 256 {x%256} else {255-(x%256)};
      let g = if (y%512) < 256 {y%256} else {255-(y%256)};
      let b = if (frame%512) < 256 {frame%256} else {255-(frame%256)};
      let color = 0xff000000 |
                  (b          << 16) |
                  ((g as u32) << 8) |
                  ((r as u32) << 0);
      sl[y*width + x] = color;
    }
  }
}
