import {StatisticsData} from "./StatisticsData.js";

export class StatisticsMeasurement {
  prevEncodedFrameCount : number = 0;
  prevDecodedFrameCount : number = 0;

  constructor() {
    window.setInterval(()=>{
      let encoderFps = (StatisticsData.sessionStats.encodedFrameCount - this.prevEncodedFrameCount);
      let decoderFps = (StatisticsData.sessionStats.decodedFrameCount - this.prevDecodedFrameCount);
      this.prevEncodedFrameCount = StatisticsData.sessionStats.encodedFrameCount;
      this.prevDecodedFrameCount = StatisticsData.sessionStats.decodedFrameCount;
      StatisticsData.setSessionStat("fpsEncoder", encoderFps);
      StatisticsData.setSessionStat("fpsDecoder", decoderFps);
    }, 1000);
  }
}