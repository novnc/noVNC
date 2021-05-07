
export const frameStatKeys = [
  "encodeTsStartMs",
  "encodeTsEndMs",
  "encodeDurationMs",
  "txTsStartMs",
  "txTsEndMs",
  "txDurationMs",
  "decodeTsStartMs",
  "decodeTsEndMs",
  "decodeDurationMs",
  "displayTsStartMs",
  "displayTsEndMs",
  "displayDurationMs",
  "frameSizeBytes"
];

export interface FrameStats {
  encodeTsStartMs : number[];
  encodeTsEndMs : number[];
  encodeDurationMs : number[];
  txTsStartMs : number[];
  txTsEndMs : number[];
  txDurationMs : number[];
  decodeTsStartMs : number[];
  decodeTsEndMs : number[];
  decodeDurationMs : number[];
  displayTsStartMs : number[];
  displayTsEndMs : number[];
  displayDurationMs : number[];
  frameSizeBytes : number[];
  lagDurationMs : number[];
}

export interface SessionStats {
  encodedFrameCount : number;
  decodedFrameCount : number;
  sessionStartTsMs?:number;
  receivedBytes?:number;
  sentBytes?:number;
  avgTxBytes?:number;
  avgRxBytes?:number;
  fpsEncoder?:number;
  fpsDecoder?:number;
  stdFps?:number;
}

export class StatisticsData {
  static BUFFER_LENGTH = 200;
  static sessionStats:SessionStats = {
    encodedFrameCount : 0,
    decodedFrameCount : 0,
    sentBytes : 0,
    receivedBytes : 0,
    stdFps : 0,
    fpsEncoder : 0,
    fpsDecoder : 0,
    avgRxBytes : 0,
    avgTxBytes : 0,
    sessionStartTsMs : 0
  };
  static frameStats:FrameStats = {
    encodeTsStartMs : new Array(StatisticsData.BUFFER_LENGTH),
    encodeTsEndMs : new Array(StatisticsData.BUFFER_LENGTH),
    encodeDurationMs : new Array(StatisticsData.BUFFER_LENGTH),
    txTsStartMs : new Array(StatisticsData.BUFFER_LENGTH),
    txTsEndMs : new Array(StatisticsData.BUFFER_LENGTH),
    txDurationMs : new Array(StatisticsData.BUFFER_LENGTH),
    decodeTsStartMs : new Array(StatisticsData.BUFFER_LENGTH),
    decodeTsEndMs : new Array(StatisticsData.BUFFER_LENGTH),
    decodeDurationMs : new Array(StatisticsData.BUFFER_LENGTH),
    displayTsStartMs : new Array(StatisticsData.BUFFER_LENGTH),
    displayTsEndMs : new Array(StatisticsData.BUFFER_LENGTH),
    displayDurationMs : new Array(StatisticsData.BUFFER_LENGTH),
    frameSizeBytes : new Array(StatisticsData.BUFFER_LENGTH),
    lagDurationMs : new Array(StatisticsData.BUFFER_LENGTH),
  };

  static onUpdate:((type:keyof FrameStats, data : number[])=>void)|undefined;
  static onUpdateSessionStats:(sessionStats:SessionStats)=>void;

  static encodeTimeData:number[] = new Array(200);

  static setSessionStat(type:keyof SessionStats, value:number) {
    StatisticsData.sessionStats[type] = value;
    StatisticsData?.onUpdateSessionStats(StatisticsData.sessionStats);
  }

  static setFrameStat(type:keyof FrameStats, value:number) {
    StatisticsData.frameStats[type].shift();
    StatisticsData.frameStats[type].push(value);
    StatisticsData?.onUpdate(type, StatisticsData.frameStats[type]);
  }
}