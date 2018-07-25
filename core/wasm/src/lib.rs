#![feature(wasm_custom_section, wasm_import_module, use_extern_macros)]

extern crate wasm_bindgen;

use wasm_bindgen::prelude::*;

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

#[wasm_bindgen]
pub fn draw(ctx: &CanvasRenderingContext2D, width: u32, height: u32, red: u8, green: u8, blue: u8) {
    let data = fill(width, height, red, green, blue);
    let uint8_array = Uint8ClampedArray::new(&data);

    ctx.put_image_data(&ImageData::new(&uint8_array, width, height), 0, 0);
}

///////////////////////////////////////////////////

pub fn fill(width: u32, height: u32, red: u8, green: u8, blue: u8) -> Vec<u8> {
  let mut data: Vec<u8> = vec![];

  for _x in 0..width {
    for _y in 0..height {
      data.push(red as u8);
      data.push(green as u8);
      data.push(blue as u8);
      data.push(255);
    }
  }

  data
}
