import {RtGraph} from "./RtGraph.js";
import {frameStatKeys, StatisticsData} from "./StatisticsData.js";

export class StatisticsDisplay {
  static container : HTMLDivElement;

  static graphVisible:{[key:string]:boolean} = {
    decodeDurationMs : true
  };

  static graphs : {[k:string]:RtGraph};
  constructor() {
    StatisticsDisplay.container = document.createElement("div");
    StatisticsDisplay.container.className = "statistics-display";
    StatisticsDisplay.container.style.position = "absolute";
    StatisticsDisplay.container.style.left = "0";
    StatisticsDisplay.container.style.top = "0";
    StatisticsDisplay.container.style.zIndex = "100";
    StatisticsDisplay.container.style.display = "flex";
    StatisticsDisplay.container.style.flexDirection = "row";
    document.body.appendChild(StatisticsDisplay.container);

    StatisticsDisplay.graphs = {};
    frameStatKeys.forEach(key => {
      if(StatisticsDisplay.graphVisible[key]) {
        StatisticsDisplay.graphs[key] = new RtGraph({
          graphType : "bar",
          container : StatisticsDisplay.container,
          width : 200,
          height : 120,
          padding : 0
        });
      }
    });
    StatisticsData.onUpdate = (type, data) => {
      StatisticsDisplay.graphs[type]?.redraw(data);
    };
  }
}