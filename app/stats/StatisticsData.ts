
export const frameStatKeys = [
  "encodeTsStartMs",
  "encodeTsEndMs",
  "transmissionTsStartMs",
  "transmissionTsEndMs",
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
  transmissionTsStartMs : number[];
  transmissionTsEndMs : number[];
  decodeTsStartMs : number[];
  decodeTsEndMs : number[];
  decodeDurationMs : number[];
  displayTsStartMs : number[];
  displayTsEndMs : number[];
  displayDurationMs : number[];
  frameSizeBytes : number[];
}

export interface SessionStats {
  sessionStartTsMs?:number;
  receivedBytes?:number;
  sentBytes?:number;
  avgTxBytes?:number;
  avgRxBytes?:number;
  avgFps?:number;
  stdFps?:number;
}

export class StatisticsData {
  static BUFFER_LENGTH = 200;
  static sessionStats:SessionStats = {};
  static frameStats:FrameStats = {
    encodeTsStartMs : new Array(StatisticsData.BUFFER_LENGTH),
    encodeTsEndMs : new Array(StatisticsData.BUFFER_LENGTH),
    transmissionTsStartMs : new Array(StatisticsData.BUFFER_LENGTH),
    transmissionTsEndMs : new Array(StatisticsData.BUFFER_LENGTH),
    decodeTsStartMs : new Array(StatisticsData.BUFFER_LENGTH),
    decodeTsEndMs : new Array(StatisticsData.BUFFER_LENGTH),
    decodeDurationMs : new Array(StatisticsData.BUFFER_LENGTH),
    displayTsStartMs : new Array(StatisticsData.BUFFER_LENGTH),
    displayTsEndMs : new Array(StatisticsData.BUFFER_LENGTH),
    displayDurationMs : new Array(StatisticsData.BUFFER_LENGTH),
    frameSizeBytes : new Array(StatisticsData.BUFFER_LENGTH),
  };
  static onUpdate:((type:keyof FrameStats, data : number[])=>void)|undefined;

  static encodeTimeData:number[] = new Array(200);

  static setSessionStat(type:keyof SessionStats, value:number) {
    // StatisticsData.sessionStats[type] = value;
    // StatisticsData?.onUpdate(type, []);
  }

  static setFrameStat(/*frame:number,*/ type:keyof FrameStats, value:number) {
    StatisticsData.frameStats[type].shift();
    StatisticsData.frameStats[type].push(value);
    StatisticsData?.onUpdate(type, StatisticsData.frameStats[type]);
  }
}