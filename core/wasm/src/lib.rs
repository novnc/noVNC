#![feature(wasm_custom_section, wasm_import_module, use_extern_macros)]

extern crate wasm_bindgen;

use std::mem;
use std::slice;
use std::os::raw::c_void;
use wasm_bindgen::prelude::*;

//////////////////////////////////////////////////////////
/// draw1

#[wasm_bindgen]
extern "C" {
    pub type ImageData;

    #[wasm_bindgen(constructor)]
    pub fn new(arr: &Uint8ClampedArray, width: u32, height: u32) -> ImageData;
}

#[wasm_bindgen]
extern "C" {
    pub type Uint8ClampedArray;

    #[wasm_bindgen(constructor)]
    pub fn new(arr: &[u8]) -> Uint8ClampedArray;
}

#[wasm_bindgen]
extern "C" {
    pub type CanvasRenderingContext2D;

    #[wasm_bindgen(method, js_name = putImageData)]
    pub fn put_image_data(this: &CanvasRenderingContext2D, image_data: &ImageData, p_1: i32, p_2: i32);
}

pub fn fill(width: u32, height: u32, frame: u32) -> Vec<u8> {
  let mut data: Vec<u8> = vec![];

  for x in 0..width {
    for y in 0..height {
      let r = if (x%512) < 256 {x%256} else {255-(x%256)};
      let g = if (y%512) < 256 {y%256} else {255-(y%256)};
      let b = if (frame%512) < 256 {frame%256} else {255-(frame%256)};
      data.push(r as u8);
      data.push(g as u8);
      data.push(b as u8);
      data.push(255);
    }
  }

  data
}

#[wasm_bindgen]
pub fn draw1(ctx: &CanvasRenderingContext2D, width: u32, height: u32, frame: u32) {
    let data = fill(width, height, frame);
    let uint8_array = Uint8ClampedArray::new(&data);

    ctx.put_image_data(&ImageData::new(&uint8_array, width, height), 0, 0);
}

//////////////////////////////////////////////////////////
/// draw2

// In order to work with the memory we expose allocation method
#[wasm_bindgen]
pub fn alloc(size: usize) -> *mut c_void {
  let mut buf = Vec::with_capacity(size);
  let ptr = buf.as_mut_ptr();
  mem::forget(buf);
  return ptr as *mut c_void;
}

#[wasm_bindgen]
pub fn draw2(mem: *mut u8, width: usize, height: usize, frame: u32) {

  // pixels are stored in RGBA, so each pixel is 4 bytes
  let sl = unsafe { slice::from_raw_parts_mut(mem, width * height * 4) };

  for y in 0..height {
    for x in 0..width {
      let r = if (x%512) < 256 {x%256} else {255-(x%256)};
      let g = if (y%512) < 256 {y%256} else {255-(y%256)};
      let b = if (frame%512) < 256 {frame%256} else {255-(frame%256)};
      let xy = x*4 + y*4*width;
      sl[xy + 0] = r as u8;
      sl[xy + 1] = g as u8;
      sl[xy + 2] = b as u8;
      sl[xy + 3] = 255;
    }
  }
}

//////////////////////////////////////////////////////////
/// draw3

#[wasm_bindgen]
pub fn draw3(mem: *mut u32, width: usize, height: usize, frame: u32) {

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
