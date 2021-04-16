import Websock from "../websock";
import Display from "../display";
import {H264Decoder} from "../../vendor/h264decoder/src/index.js";
import {YUVBuffer, YUVFrame} from "../../vendor/yuvcanvas/YuvBuffer.js";
import {StatisticsData} from "../../app/stats/StatisticsData.js";

export default class X264Decoder {
  decoder : H264Decoder;
  emptyu:Uint8Array|null;
  emptyv:Uint8Array|null;

  constructor() {
  }

  async init() {
    this.decoder = new H264Decoder();
    this.emptyu = null;
    this.emptyv = null;
    await this.decoder.init();
  }

  decodeRect(x:number, y:number, width:number, height:number, sock:Websock, display:Display, depth:number) {
    //TODO: switch to Webgl display whecurn in x264 mode
    //TODO: instantiate h264 decoder.
    //TODO: receive data, check where decodeRect is called, maybe we need another header sent in server to trigger this
    //   function
    const payloadSize = sock.rQlen;

    let startDecode = performance.now();

    const payload = sock.rQshiftBytes(payloadSize);
    const result = this.decoder.decode(payload);

    let endDecode = performance.now();
    StatisticsData.setFrameStat("decodeDurationMs", endDecode-startDecode);


    if(result === H264Decoder.PIC_RDY && this.decoder.pic) {
      console.log("frame decoded.");
    } else {
      console.log("decoder error "+result);
    }

    height+=8;

    if(result === 1 && this.decoder.pic) {
      const frame:YUVFrame = {
        format : YUVBuffer.format({
          width: width,
          height: height,
          chromaWidth: width/2,
          chromaHeight: height/2,
          cropLeft: 0, // default
          cropTop: 0, // default
          cropWidth: width, // derived from width
          cropHeight: height,
          displayWidth: width, // derived from width via cropWidth
          displayHeight: height // derived from cropHeight
        }),
        y : {
          bytes : this.decoder.pic.subarray(0, width*height),
          stride : width,
        },
        u : {
          bytes : this.decoder.pic.subarray(width*height, (width*height) + (width*height)/4),
          stride : width/2,
        },
        v : {
          bytes : this.decoder.pic.subarray((width*height) + (width*height/4), (width*height) + (width*height/4) + (width*height/4)),
          stride : width/2,
        }
      };

      display.blitImageWebgl(frame);
    }


    return true; //important to return true, otherwise receive queue will break.
  }
}