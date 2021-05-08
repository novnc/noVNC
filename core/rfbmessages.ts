import Websock from "./websock";
import RFB, {
  extendedClipboardActionNotify,
  extendedClipboardActionProvide,
  extendedClipboardActionRequest,
  extendedClipboardFormatText
} from "./rfb.js";
import Deflator from "./deflator.js";
import {encodeUTF8} from "./util/strings.js";
import {toUnsigned32bit} from "./util/int.js";

export class RFBMessages {
  static keyEvent(sock:Websock, keysym:number, down:number) {
    const buff = sock._sQ;
    const offset = sock._sQlen;

    buff[offset] = 4;  // msg-type
    buff[offset + 1] = down;

    buff[offset + 2] = 0;
    buff[offset + 3] = 0;

    buff[offset + 4] = (keysym >> 24);
    buff[offset + 5] = (keysym >> 16);
    buff[offset + 6] = (keysym >> 8);
    buff[offset + 7] = keysym;

    sock._sQlen += 8;
    sock.flush();
  }

  static QEMUExtendedKeyEvent(sock:Websock, keysym:number, down:number, keycode:number) {
    function getRFBkeycode(xtScanCode:number) {
      const upperByte = (keycode >> 8);
      const lowerByte = (keycode & 0x00ff);
      if (upperByte === 0xe0 && lowerByte < 0x7f) {
        return lowerByte | 0x80;
      }
      return xtScanCode;
    }

    const buff = sock._sQ;
    const offset = sock._sQlen;

    buff[offset] = 255; // msg-type
    buff[offset + 1] = 0; // sub msg-type

    buff[offset + 2] = (down >> 8);
    buff[offset + 3] = down;

    buff[offset + 4] = (keysym >> 24);
    buff[offset + 5] = (keysym >> 16);
    buff[offset + 6] = (keysym >> 8);
    buff[offset + 7] = keysym;

    const RFBkeycode = getRFBkeycode(keycode);

    buff[offset + 8] = (RFBkeycode >> 24);
    buff[offset + 9] = (RFBkeycode >> 16);
    buff[offset + 10] = (RFBkeycode >> 8);
    buff[offset + 11] = RFBkeycode;

    sock._sQlen += 12;
    sock.flush();
  }

  static pointerEvent(sock:Websock, x:number, y:number, mask:number) {
    const buff = sock._sQ;
    const offset = sock._sQlen;

    buff[offset] = 5; // msg-type

    buff[offset + 1] = mask;

    buff[offset + 2] = x >> 8;
    buff[offset + 3] = x;

    buff[offset + 4] = y >> 8;
    buff[offset + 5] = y;

    sock._sQlen += 6;
    sock.flush();
  }

  // Used to build Notify and Request data.
  static _buildExtendedClipboardFlags(actions:number[], formats:number[]) {
    let data = new Uint8Array(4);
    let formatFlag = 0x00000000;
    let actionFlag = 0x00000000;

    for (let i = 0; i < actions.length; i++) {
      actionFlag |= actions[i];
    }

    for (let i = 0; i < formats.length; i++) {
      formatFlag |= formats[i];
    }

    data[0] = actionFlag >> 24; // Actions
    data[1] = 0x00;             // Reserved
    data[2] = 0x00;             // Reserved
    data[3] = formatFlag;       // Formats

    return data;
  }

  static extendedClipboardProvide(sock:Websock, formats:number[], inData:string[]) {
    // Deflate incomming data and their sizes
    let deflator = new Deflator();
    let dataToDeflate = [];

    for (let i = 0; i < formats.length; i++) {
      // We only support the format Text at this time
      if (formats[i] != extendedClipboardFormatText) {
        throw new Error("Unsupported extended clipboard format for Provide message.");
      }

      // Change lone \r or \n into \r\n as defined in rfbproto
      inData[i] = inData[i].replace(/\r\n|\r|\n/gm, "\r\n");

      // Check if it already has \0
      let text = encodeUTF8(inData[i] + "\0");

      dataToDeflate.push( (text.length >> 24) & 0xFF,
        (text.length >> 16) & 0xFF,
        (text.length >>  8) & 0xFF,
        (text.length & 0xFF));

      for (let j = 0; j < text.length; j++) {
        dataToDeflate.push(text.charCodeAt(j));
      }
    }

    let deflatedData = deflator.deflate(new Uint8Array(dataToDeflate));

    // Build data  to send
    let data = new Uint8Array(4 + deflatedData.length);
    data.set(RFBMessages._buildExtendedClipboardFlags([extendedClipboardActionProvide],
      formats));
    data.set(deflatedData, 4);

    RFBMessages.clientCutText(sock, data, true);
  }

  static extendedClipboardNotify(sock:Websock, formats:number[]) {
    let flags = RFBMessages._buildExtendedClipboardFlags([extendedClipboardActionNotify],
      formats);
    RFBMessages.clientCutText(sock, flags, true);
  }

  static extendedClipboardRequest(sock:Websock, formats:number[]) {
    let flags = RFBMessages._buildExtendedClipboardFlags([extendedClipboardActionRequest],
      formats);
    RFBMessages.clientCutText(sock, flags, true);
  }

  static extendedClipboardCaps(sock:Websock, actions:number[], formats:number[]) {
    let formatKeys = Object.keys(formats).map(x => parseInt(x));
    let data  = new Uint8Array(4 + (4 * formatKeys.length));

    formatKeys.sort((a, b) =>  a - b);

    data.set(RFBMessages._buildExtendedClipboardFlags(actions, []));

    let loopOffset = 4;
    for (let i = 0; i < formatKeys.length; i++) {
      data[loopOffset]     = formats[formatKeys[i]] >> 24;
      data[loopOffset + 1] = formats[formatKeys[i]] >> 16;
      data[loopOffset + 2] = formats[formatKeys[i]] >> 8;
      data[loopOffset + 3] = formats[formatKeys[i]] >> 0;

      loopOffset += 4;
      data[3] |= (1 << formatKeys[i]); // Update our format flags
    }

    RFBMessages.clientCutText(sock, data, true);
  }

  static clientCutText(sock:Websock, data:Uint8Array, extended:boolean = false) {
    const buff = sock._sQ;
    const offset = sock._sQlen;

    buff[offset] = 6; // msg-type

    buff[offset + 1] = 0; // padding
    buff[offset + 2] = 0; // padding
    buff[offset + 3] = 0; // padding

    let length;
    if (extended) {
      length = toUnsigned32bit(-data.length);
    } else {
      length = data.length;
    }

    buff[offset + 4] = length >> 24;
    buff[offset + 5] = length >> 16;
    buff[offset + 6] = length >> 8;
    buff[offset + 7] = length;

    sock._sQlen += 8;

    // We have to keep track of from where in the data we begin creating the
    // buffer for the flush in the next iteration.
    let dataOffset = 0;

    let remaining = data.length;
    while (remaining > 0) {

      let flushSize = Math.min(remaining, (sock._sQbufferSize - sock._sQlen));
      for (let i = 0; i < flushSize; i++) {
        buff[sock._sQlen + i] = data[dataOffset + i];
      }

      sock._sQlen += flushSize;
      sock.flush();

      remaining -= flushSize;
      dataOffset += flushSize;
    }

  }

  static setDesktopSize(sock:Websock, width:number, height:number, id:number, flags:number) {
    const buff = sock._sQ;
    const offset = sock._sQlen;

    buff[offset] = 251;              // msg-type
    buff[offset + 1] = 0;            // padding
    buff[offset + 2] = width >> 8;   // width
    buff[offset + 3] = width;
    buff[offset + 4] = height >> 8;  // height
    buff[offset + 5] = height;

    buff[offset + 6] = 1;            // number-of-screens
    buff[offset + 7] = 0;            // padding

    // screen array
    buff[offset + 8] = id >> 24;     // id
    buff[offset + 9] = id >> 16;
    buff[offset + 10] = id >> 8;
    buff[offset + 11] = id;
    buff[offset + 12] = 0;           // x-position
    buff[offset + 13] = 0;
    buff[offset + 14] = 0;           // y-position
    buff[offset + 15] = 0;
    buff[offset + 16] = width >> 8;  // width
    buff[offset + 17] = width;
    buff[offset + 18] = height >> 8; // height
    buff[offset + 19] = height;
    buff[offset + 20] = flags >> 24; // flags
    buff[offset + 21] = flags >> 16;
    buff[offset + 22] = flags >> 8;
    buff[offset + 23] = flags;

    sock._sQlen += 24;
    sock.flush();
  }

  static clientFence(sock:Websock, flags:number, payload:string) {
    const buff = sock._sQ;
    const offset = sock._sQlen;

    buff[offset] = 248; // msg-type

    buff[offset + 1] = 0; // padding
    buff[offset + 2] = 0; // padding
    buff[offset + 3] = 0; // padding

    buff[offset + 4] = flags >> 24; // flags
    buff[offset + 5] = flags >> 16;
    buff[offset + 6] = flags >> 8;
    buff[offset + 7] = flags;

    const n = payload.length;

    buff[offset + 8] = n; // length

    for (let i = 0; i < n; i++) {
      buff[offset + 9 + i] = payload.charCodeAt(i);
    }

    sock._sQlen += 9 + n;
    sock.flush();
  }

  static enableContinuousUpdates(sock:Websock, enable:boolean, x:number, y:number, width:number, height:number) {
    const buff = sock._sQ;
    const offset = sock._sQlen;

    buff[offset] = 150;             // msg-type
    buff[offset + 1] = enable ? 1 : 0;      // enable-flag

    buff[offset + 2] = x >> 8;      // x
    buff[offset + 3] = x;
    buff[offset + 4] = y >> 8;      // y
    buff[offset + 5] = y;
    buff[offset + 6] = width >> 8;  // width
    buff[offset + 7] = width;
    buff[offset + 8] = height >> 8; // height
    buff[offset + 9] = height;

    sock._sQlen += 10;
    sock.flush();
  }

  static pixelFormat(sock:Websock, depth:number, trueColor:boolean) {
    const buff = sock._sQ;
    const offset = sock._sQlen;

    let bpp;

    if (depth > 16) {
      bpp = 32;
    } else if (depth > 8) {
      bpp = 16;
    } else {
      bpp = 8;
    }

    const bits = Math.floor(depth/3);

    buff[offset] = 0;  // msg-type

    buff[offset + 1] = 0; // padding
    buff[offset + 2] = 0; // padding
    buff[offset + 3] = 0; // padding

    buff[offset + 4] = bpp;                 // bits-per-pixel
    buff[offset + 5] = depth;               // depth
    buff[offset + 6] = 0;                   // little-endian
    buff[offset + 7] = trueColor ? 1 : 0;  // true-color

    buff[offset + 8] = 0;    // red-max
    buff[offset + 9] = (1 << bits) - 1;  // red-max

    buff[offset + 10] = 0;   // green-max
    buff[offset + 11] = (1 << bits) - 1; // green-max

    buff[offset + 12] = 0;   // blue-max
    buff[offset + 13] = (1 << bits) - 1; // blue-max

    buff[offset + 14] = bits * 0; // red-shift
    buff[offset + 15] = bits * 1; // green-shift
    buff[offset + 16] = bits * 2; // blue-shift

    buff[offset + 17] = 0;   // padding
    buff[offset + 18] = 0;   // padding
    buff[offset + 19] = 0;   // padding

    sock._sQlen += 20;
    sock.flush();
  }

  static clientEncodings(sock:Websock, encodings:number[]) {
    const buff = sock._sQ;
    const offset = sock._sQlen;

    buff[offset] = 2; // msg-type
    buff[offset + 1] = 0; // padding

    buff[offset + 2] = encodings.length >> 8;
    buff[offset + 3] = encodings.length;

    let j = offset + 4;
    for (let i = 0; i < encodings.length; i++) {
      const enc = encodings[i];
      buff[j] = enc >> 24;
      buff[j + 1] = enc >> 16;
      buff[j + 2] = enc >> 8;
      buff[j + 3] = enc;

      j += 4;
    }

    sock._sQlen += j - offset;
    sock.flush();
  }

  static fbUpdateRequest(sock:Websock, incremental:boolean, x:number, y:number, w:number, h:number) {
    const buff = sock._sQ;
    const offset = sock._sQlen;

    if (typeof(x) === "undefined") { x = 0; }
    if (typeof(y) === "undefined") { y = 0; }

    buff[offset] = 3;  // msg-type
    buff[offset + 1] = incremental ? 1 : 0;

    buff[offset + 2] = (x >> 8) & 0xFF;
    buff[offset + 3] = x & 0xFF;

    buff[offset + 4] = (y >> 8) & 0xFF;
    buff[offset + 5] = y & 0xFF;

    buff[offset + 6] = (w >> 8) & 0xFF;
    buff[offset + 7] = w & 0xFF;

    buff[offset + 8] = (h >> 8) & 0xFF;
    buff[offset + 9] = h & 0xFF;

    sock._sQlen += 10;
    sock.flush();
  }

  static xvpOp(sock:Websock, ver:number, op:number) {
    const buff = sock._sQ;
    const offset = sock._sQlen;

    buff[offset] = 250; // msg-type
    buff[offset + 1] = 0; // padding

    buff[offset + 2] = ver;
    buff[offset + 3] = op;

    sock._sQlen += 4;
    sock.flush();
  }
}