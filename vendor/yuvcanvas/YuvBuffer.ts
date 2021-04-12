/*
Copyright (c) 2014-2016 Brion Vibber <brion@pobox.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
MPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
ONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/**
 * Represents metadata about a YUV frame format.
 * @typedef {Object} YUVFormat
 * @property {number} width - width of encoded frame in luma pixels
 * @property {number} height - height of encoded frame in luma pixels
 * @property {number} chromaWidth - width of encoded frame in chroma pixels
 * @property {number} chromaHeight - height of encoded frame in chroma pixels
 * @property {number} cropLeft - upper-left X coordinate of visible crop region, in luma pixels
 * @property {number} cropTop - upper-left Y coordinate of visible crop region, in luma pixels
 * @property {number} cropWidth - width of visible crop region, in luma pixels
 * @property {number} cropHeight - height of visible crop region, in luma pixels
 * @property {number} displayWidth - final display width of visible region, in luma pixels
 * @property {number} displayHeight - final display height of visible region, in luma pixels
 */
export interface YUVFormat {
  width : number;
  height : number;
  chromaWidth : number;
  chromaHeight : number;
  cropLeft : number;
  cropTop : number;
  cropWidth : number;
  cropHeight : number;
  displayWidth : number;
  displayHeight : number;
}

/**
 * Represents underlying image data for a single luma or chroma plane.
 * Cannot be interpreted without the format data from a frame buffer.
 * @typedef {Object} YUVPlane
 * @property {Uint8Array} bytes - typed array containing image data bytes
 * @property {number} stride - byte distance between rows in data
 */
export interface YUVPlane {
  bytes : Uint8Array;
  stride : number;
}

/**
 * Represents a YUV image frame buffer, with enough format information
 * to interpret the data usefully. Buffer objects use generic objects
 * under the hood and can be transferred between worker threads using
 * the structured clone algorithm.
 *
 * @typedef {Object} YUVFrame
 * @property {YUVFormat} format
 * @property {YUVPlane} y
 * @property {YUVPlane} u
 * @property {YUVPlane} v
 */
export interface YUVFrame {
  format : YUVFormat;
  y : YUVPlane;
  u : YUVPlane;
  v : YUVPlane;
}

/**
 * Holder namespace for utility functions and constants related to
 * YUV frame and plane buffers.
 *
 * @namespace
 */
export class YUVBuffer {

  constructor() {
  }

  /**
   * Validate a plane dimension
   * @param {number} dim - vertical or horizontal dimension
   * @throws exception on zero, negative, or non-integer value
   */
  static validateDimension(dim:number) {
    if (dim <= 0 || dim !== (dim | 0)) {
      throw 'YUV plane dimensions must be a positive integer';
    }
  }

  /**
   * Validate a plane offset
   * @param {number} dim - vertical or horizontal dimension
   * @throws exception on negative or non-integer value
   */
  static validateOffset(dim:number) {
    if (dim < 0 || dim !== (dim | 0)) {
      throw 'YUV plane offsets must be a non-negative integer';
    }
  }

  /**
   * Validate and fill out a YUVFormat object structure.
   *
   * At least width and height fields are required; other fields will be
   * derived if left missing or empty:
   * - chromaWidth and chromaHeight will be copied from width and height as for a 4:4:4 layout
   * - cropLeft and cropTop will be 0
   * - cropWidth and cropHeight will be set to whatever of the frame is visible after cropTop and cropLeft are applied
   * - displayWidth and displayHeight will be set to cropWidth and cropHeight.
   *
   * @param {YUVFormat} fields - input fields, must include width and height.
   * @returns {YUVFormat} - validated structure, with all derivable fields filled out.
   * @throws exception on invalid fields or missing width/height
   */
  static format(fields:YUVFormat) {
    var width = fields.width,
      height = fields.height,
      chromaWidth = fields.chromaWidth || width,
      chromaHeight = fields.chromaHeight || height,
      cropLeft = fields.cropLeft || 0,
      cropTop = fields.cropTop || 0,
      cropWidth = fields.cropWidth || width - cropLeft,
      cropHeight = fields.cropHeight || height - cropTop,
      displayWidth = fields.displayWidth || cropWidth,
      displayHeight = fields.displayHeight || cropHeight;
    YUVBuffer.validateDimension(width);
    YUVBuffer.validateDimension(height);
    YUVBuffer.validateDimension(chromaWidth);
    YUVBuffer.validateDimension(chromaHeight);
    YUVBuffer.validateOffset(cropLeft);
    YUVBuffer.validateOffset(cropTop);
    YUVBuffer.validateDimension(cropWidth);
    YUVBuffer.validateDimension(cropHeight);
    YUVBuffer.validateDimension(displayWidth);
    YUVBuffer.validateDimension(displayHeight);
    return {
      width: width,
      height: height,
      chromaWidth: chromaWidth,
      chromaHeight: chromaHeight,
      cropLeft: cropLeft,
      cropTop: cropTop,
      cropWidth: cropWidth,
      cropHeight: cropHeight,
      displayWidth: displayWidth,
      displayHeight: displayHeight
    };
  }

  /**
   * Allocate a new YUVPlane object of the given size.
   * @param {number} stride - byte distance between rows
   * @param {number} rows - number of rows to allocate
   * @returns {YUVPlane} - freshly allocated planar buffer
   */
  static allocPlaneFunction(stride:number, rows:number) {
    YUVBuffer.validateDimension(stride);
    YUVBuffer.validateDimension(rows);
    return {
      bytes: new Uint8Array(stride * rows),
      stride: stride
    }
  }

  /**
   * Pick a suitable stride for a custom-allocated thingy
   * @param {number} width - width in bytes
   * @returns {number} - new width in bytes at least as large
   * @throws exception on invalid input width
   */
  static suitableStride(width:number) {
    YUVBuffer.validateDimension(width);
    var alignment = 4,
      remainder = width % alignment;
    if (remainder == 0) {
      return width;
    } else {
      return width + (alignment - remainder);
    }
  }

  /**
   * Allocate or extract a YUVPlane object from given dimensions/source.
   * @param {number} width - width in pixels
   * @param {number} height - height in pixels
   * @param {Uint8Array} source - input byte array; optional (will create empty buffer if missing)
   * @param {number} stride - row length in bytes; optional (will create a default if missing)
   * @param {number} offset - offset into source array to extract; optional (will start at 0 if missing)
   * @returns {YUVPlane} - freshly allocated planar buffer
   */
  static allocPlane(width:number, height:number, source:Uint8Array, stride:number, offset:number) {
    var size, bytes;

    YUVBuffer.validateDimension(width);
    YUVBuffer.validateDimension(height);

    offset = offset || 0;

    stride = stride || YUVBuffer.suitableStride(width);
    YUVBuffer.validateDimension(stride);
    if (stride < width) {
      throw "Invalid input stride for YUV plane; must be larger than width";
    }

    size = stride * height;

    if (source) {
      if (source.length - offset < size) {
        throw "Invalid input buffer for YUV plane; must be large enough for stride times height";
      }
      bytes = source.slice(offset, offset + size);
    } else {
      bytes = new Uint8Array(size);
      stride = stride || this.suitableStride(width);
    }

    return {
      bytes: bytes,
      stride: stride
    };
  }

  /**
   * Allocate a new YUVPlane object big enough for a luma plane in the given format
   * @param {YUVFormat} format - target frame format
   * @param {Uint8Array} source - input byte array; optional (will create empty buffer if missing)
   * @param {number} stride - row length in bytes; optional (will create a default if missing)
   * @param {number} offset - offset into source array to extract; optional (will start at 0 if missing)
   * @returns {YUVPlane} - freshly allocated planar buffer
   */
  static lumaPlane(format:YUVFormat, source?:Uint8Array, stride?:number, offset?:number) {
    return YUVBuffer.allocPlane(format.width, format.height, source, stride, offset);
  }

  /**
   * Allocate a new YUVPlane object big enough for a chroma plane in the given format,
   * optionally copying data from an existing buffer.
   *
   * @param {YUVFormat} format - target frame format
   * @param {Uint8Array} source - input byte array; optional (will create empty buffer if missing)
   * @param {number} stride - row length in bytes; optional (will create a default if missing)
   * @param {number} offset - offset into source array to extract; optional (will start at 0 if missing)
   * @returns {YUVPlane} - freshly allocated planar buffer
   */
  static chromaPlane(format:YUVFormat, source?:Uint8Array, stride?:number, offset?:number) {
    return YUVBuffer.allocPlane(format.chromaWidth, format.chromaHeight, source, stride, offset);
  }

  /**
   * Allocate a new YUVFrame object big enough for the given format
   * @param {YUVFormat} format - target frame format
   * @param {YUVPlane} y - optional Y plane; if missing, fresh one will be allocated
   * @param {YUVPlane} u - optional U plane; if missing, fresh one will be allocated
   * @param {YUVPlane} v - optional V plane; if missing, fresh one will be allocated
   * @returns {YUVFrame} - freshly allocated frame buffer
   */
  static frame(format:YUVFormat, y:YUVPlane, u:YUVPlane, v:YUVPlane) {
    y = y || YUVBuffer.lumaPlane(format);
    u = u || YUVBuffer.chromaPlane(format);
    v = v || YUVBuffer.chromaPlane(format);
    return {
      format: format,
      y: y,
      u: u,
      v: v
    }
  }

  /**
   * Duplicate a plane using new buffer memory.
   * @param {YUVPlane} plane - input plane to copy
   * @returns {YUVPlane} - freshly allocated and filled planar buffer
   */
  static copyPlane(plane:YUVPlane) {
    return {
      bytes: plane.bytes.slice(),
      stride: plane.stride
    }
  }

  /**
   * Duplicate a frame using new buffer memory.
   * @param {YUVFrame} frame - input frame to copyFrame
   * @returns {YUVFrame} - freshly allocated and filled frame buffer
   */
  static copyFrame(frame:YUVFrame) {
    return {
      format: frame.format,
      y: this.copyPlane(frame.y),
      u: this.copyPlane(frame.u),
      v: this.copyPlane(frame.v)
    }
  }

  /**
   * List the backing buffers for the frame's planes for transfer between
   * threads via Worker.postMessage.
   * @param {YUVFrame} frame - input frame
   * @returns {Array} - list of transferable objects
   */
  static transferables(frame:YUVFrame) {
    return [frame.y.bytes.buffer, frame.u.bytes.buffer, frame.v.bytes.buffer];
  }
}
