import {RtGraph} from "./RtGraph.js";
import {frameStatKeys, SessionStats, StatisticsData} from "./StatisticsData.js";
import {SessionStatisticsRenderer} from "./SessionStatisticsRenderer.js";
import {StatisticsMeasurement} from "./StatisticsMeasurement.js";

export class StatisticsDisplay {
  static container : HTMLDivElement;

  static graphVisible:{[key:string]:boolean} = {
    encodeDurationMs : true,
    txDurationMs : true,
    decodeDurationMs : true
  };

  static statisticsMeasurement : StatisticsMeasurement;

  static sessionStatisticsRenderer : SessionStatisticsRenderer;
  static graphs : {[k:string]:RtGraph};

  constructor() {
    StatisticsDisplay.container = document.createElement("div");
    StatisticsDisplay.container.className = "statistics-display";
    StatisticsDisplay.container.style.backgroundColor = "black";
    StatisticsDisplay.container.style.opacity = "1.0";
    StatisticsDisplay.container.style.position = "absolute";
    StatisticsDisplay.container.style.left = "500px";
    StatisticsDisplay.container.style.bottom = "0";
    StatisticsDisplay.container.style.zIndex = "100";
    StatisticsDisplay.container.style.display = "flex";
    StatisticsDisplay.container.style.flexDirection = "row";
    // StatisticsDisplay.container.style.transform = "scale(0.5)";
    StatisticsDisplay.container.style.transformOrigin = "0 0";
    document.body.appendChild(StatisticsDisplay.container);

    //statistics measurement
    StatisticsDisplay.statisticsMeasurement = new StatisticsMeasurement();

    //session statistics
    StatisticsDisplay.sessionStatisticsRenderer = new SessionStatisticsRenderer();
    StatisticsDisplay.container.appendChild(StatisticsDisplay.sessionStatisticsRenderer.getDom());

    //frame statistics
    StatisticsDisplay.graphs = {};
    frameStatKeys.forEach(key => {
      if(StatisticsDisplay.graphVisible[key]) {
        const graphContainer = document.createElement("div");
        graphContainer.style.display = "flex";
        graphContainer.style.flexDirection = "column";
        graphContainer.className=`graph ${key}`;
        StatisticsDisplay.graphs[key] = new RtGraph({
          graphType : "bar",
          container : graphContainer,
          width : 200,
          height : 150,
          padding : 0
        });
        const graphLabel = document.createElement("div");
        graphLabel.style.padding = "2px";
        graphLabel.style.textAlign = "center";
        graphLabel.style.backgroundColor = "black";
        graphLabel.style.color = "white";
        graphLabel.style.fontSize = "12px";
        graphLabel.innerText = key;
        graphContainer.appendChild(graphLabel);
        StatisticsDisplay.container.appendChild(graphContainer);
      }
    });

    StatisticsData.onUpdate = (type, data) => {
      StatisticsDisplay.graphs[type]?.redraw(data);
    };

    StatisticsData.onUpdateSessionStats = (sessionStats:SessionStats) => {
      StatisticsDisplay.sessionStatisticsRenderer.render(sessionStats);
    }
  }
}