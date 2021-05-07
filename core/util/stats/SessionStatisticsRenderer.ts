import {SessionStats} from "./StatisticsData.js";

export class SessionStatisticsRenderer {

  container:HTMLDivElement;

  fpsEncoderCell:HTMLTableCellElement;
  fpsDecoderCell:HTMLTableCellElement;
  fpsStdCell:HTMLTableCellElement;
  rxBytesCell:HTMLTableCellElement;
  txBytesCell:HTMLTableCellElement;
  encodedFramesCell:HTMLTableCellElement;
  decodedFramesCell:HTMLTableCellElement;
  frameLagCell:HTMLTableCellElement;

  getDom() {
    const table = `<table style="border:1px solid white;color:limegreen;font-size:12px">
      <tbody>
        <tr>
          <td>fps enc (average)</td>
          <td style="width:5em" id="fps-encoder">0</td>
        </tr>
        <tr>
          <td>fps dec (average)</td>
          <td style="width:5em" id="fps-decoder">0</td>
        </tr>
        <tr>
          <td>fps (std)</td>
          <td id="fps-std">0</td>
        </tr>
        <tr>
          <td>rx (kb)</td>
          <td id="rx-bytes">0</td>
        </tr>
        <tr>
          <td>tx (kb)</td>
          <td id="tx-bytes">0</td>
        </tr>
        <tr>
          <td>encoded frames (#)</td>
          <td id="encoded-frames">0</td>
        </tr>
        <tr>
          <td>decoded frames (#)</td>
          <td id="decoded-frames">0</td>
        </tr>
        <tr>
          <td>lag (#frames)</td>
          <td style="color:red" id="frame-lag">0</td>
        </tr>       
      </tbody>
    </table>`;
    this.container = document.createElement("div");
    this.container.innerHTML = table;
    this.fpsEncoderCell = this.container.querySelector("#fps-encoder");
    this.fpsDecoderCell = this.container.querySelector("#fps-decoder");
    this.fpsStdCell = this.container.querySelector("#fps-std");
    this.rxBytesCell = this.container.querySelector("#rx-bytes");
    this.txBytesCell = this.container.querySelector("#tx-bytes");
    this.encodedFramesCell = this.container.querySelector("#encoded-frames");
    this.decodedFramesCell = this.container.querySelector("#decoded-frames");
    this.frameLagCell = this.container.querySelector("#frame-lag");
    return this.container;
  }

  render(sessionStats : SessionStats) {
    this.fpsEncoderCell.innerText = sessionStats.fpsEncoder.toFixed(2);
    this.fpsDecoderCell.innerText = sessionStats.fpsDecoder.toFixed(2);
    this.fpsStdCell.innerText = sessionStats.stdFps.toFixed(2);
    this.encodedFramesCell.innerText = sessionStats.encodedFrameCount.toFixed(0);
    this.decodedFramesCell.innerText = sessionStats.decodedFrameCount.toFixed(0);
    this.frameLagCell.innerText = (sessionStats.encodedFrameCount - sessionStats.decodedFrameCount).toFixed(0);
    this.rxBytesCell.innerText = (sessionStats.receivedBytes/1024).toFixed(2);
    this.txBytesCell.innerText = (sessionStats.sentBytes/1024).toFixed(2)
  }
}