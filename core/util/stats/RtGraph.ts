interface RtGraphOptions {
  container : HTMLDivElement;
  width : number;
  height : number;
  graphType? : "bar"|"line";
  axisColor? : string;
  fontColor? : string;
  backgroundColor? : string;
  foregroundStroke? : string;
  foregroundFill? : string;
  fontSizePx? : number;
  padding? : number;
  rangeX? : number[];
  rangeY? : number[];
  tickLengthX? : number;
  tickLengthY? : number;
  tickDistanceX? : number;
  tickDistanceY? : number;
}

export class RtGraph {
  options : RtGraphOptions;
  canvas : HTMLCanvasElement;
  ctx : CanvasRenderingContext2D;
  width : number;
  height : number;
  axisColor : string;
  fontColor : string;
  backgroundColor : string;
  foregroundFill : string;
  foregroundStroke : string;
  padding : number;
  rangeX : number[];
  rangeY : number[];
  tickLengthX : number;
  tickLengthY : number;
  tickDistanceX : number;
  tickDistanceY : number;
  graphType : "line"|"bar";
  fontSizePx : number;

  scaleX : number;
  offsetX : number;
  scaleY : number;
  offsetY : number;

  constructor(options:RtGraphOptions) {
    this.options = options;
    this.canvas = document.createElement("canvas");
    this.canvas.width = options.width;
    this.canvas.height = options.height;
    this.options.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.width = options.width ?? 200;
    this.height = options.height ?? 200;
    this.fontColor = options.fontColor ?? "rgba(255,255,255, 1.0)";
    this.axisColor = options.axisColor ?? "rgba(255,255,255, 0.5)";
    this.foregroundFill = options.foregroundFill ?? "rgba(0,255,0, 0.2)";
    this.foregroundStroke = options.foregroundStroke ?? "rgba(0,255,0, 0.9)";
    this.backgroundColor = options.backgroundColor ?? "rgba(0,0,0, 1.0)";
    this.padding = options.padding ?? 10;
    this.rangeX = this.options.rangeX ?? [0, options.width - this.padding*2];
    this.rangeY = this.options.rangeY ?? [0, options.height - this.padding*2];
    this.tickDistanceX = options.tickDistanceX ?? 10;
    this.tickDistanceY = options.tickDistanceX ?? 10;
    this.tickLengthX = options.tickLengthX ?? 5;
    this.tickLengthY = options.tickLengthY ?? 5;
    this.scaleX = (this.width - this.padding*2) / (this.rangeX[1]-this.rangeX[0]);
    this.scaleY = (this.height - this.padding*2) / (this.rangeY[1]-this.rangeY[0]);
    this.fontSizePx = this.fontSizePx ?? 8;
    this.offsetX = this.padding;
    this.offsetY = this.padding;
    this.graphType = this.options.graphType ?? "line";
  }

  redraw(data:number[]) {
    this.clear();
    this.drawData(data);
    this.drawAxes();
  }

  drawData(data:number[]) {
    let ctx = this.ctx;
    let h = this.height;
    let w = this.width;
    let px = this.padding;
    let py = this.padding;
    let x0 = px + 0.5;
    let y0 = py + 0.5;
    let x1 = (w - px) + 0.5;
    let y1 = (h - py) + 0.5;

    if(this.graphType === "line") {
      ctx.beginPath();
      ctx.moveTo(x0, y1);
      ctx.lineTo(x0, y1 - this.scaleY * data[0]);
      for(let i = 0; i < data.length; i++) {
        ctx.lineTo(x0 + (i*this.scaleX), y1 - this.scaleY * data[i]);
      }
      ctx.lineTo(x1, y1);
      ctx.closePath();
      ctx.fillStyle = this.foregroundFill;
      ctx.fill();
      ctx.strokeStyle = this.foregroundStroke;
      ctx.stroke();
    } else if(this.graphType === "bar") {
      let barWidth = this.scaleX;
      for(let i = 0; i < data.length; i++) {
        let x = (x0+(i*this.scaleX))-barWidth/2
        let h = this.scaleY * data[i];
        let y = y1 - h;
        let w = barWidth;
        ctx.fillStyle = this.foregroundStroke;
        ctx.fillRect(x, y, w, h);
      }
    }
  }

  clear() {
    this.ctx.fillStyle = this.backgroundColor;
    this.ctx.fillRect(0,0,this.options.width, this.options.height);
  }

  drawAxes() {
    let h = this.height;
    let w = this.width;
    let px = this.padding;
    let py = this.padding;
    let x0 = px + 0.5;
    let y0 = py + 0.5;
    let x1 = (w - px) + 0.5;
    let y1 = (h - py) + 0.5;
    this.ctx.beginPath();
    this.ctx.strokeStyle = this.axisColor;
    this.ctx.lineWidth = 1;

    //x axis
    this.ctx.moveTo(x0, y1);
    this.ctx.lineTo(x1, y1);
    //ticks x
    let offsetX = px;
    while(offsetX < w - px) {
      this.ctx.moveTo(Math.floor(offsetX) + 0.5, Math.floor(y1 - this.tickLengthX/2)+0.5);
      this.ctx.lineTo(Math.floor(offsetX) + 0.5, Math.floor(y1 + this.tickLengthX/2)+0.5);
      offsetX += this.tickDistanceX*this.scaleX;
    }

    //y axis
    this.ctx.moveTo(x0, y1);
    this.ctx.lineTo(x0, y0);

    //ticks y
    let offsetY = h - py;
    while(offsetY > py) {
      this.ctx.moveTo(Math.floor(x0 - this.tickLengthY/2)+0.5, Math.floor(offsetY) + 0.5);
      //this.ctx.lineTo(Math.floor(x0 + this.tickLengthY/2)+0.5, Math.floor(offsetY) + 0.5);
      this.ctx.lineTo(x1, Math.floor(offsetY) + 0.5);
      this.ctx.fillStyle = this.fontColor;
      this.ctx.textBaseline = "bottom";
      this.ctx.font = `bold ${this.fontSizePx}px Arial`;
      this.ctx.fillText((this.rangeY[1] - (offsetY/this.scaleY)).toFixed(1), x0, offsetY);
      offsetY -= this.tickDistanceY*this.scaleY;
    }
    this.ctx.stroke();
  }
}

function test() {
  let graphs : RtGraph[] = [];
  for(let i = 0; i < 20; i++) {
    graphs.push(new RtGraph({
      graphType : "bar",
      container : document.getElementById("container") as HTMLDivElement,
      width : 300,
      height : 70,
      padding : 0
    }));
  }

  let data:number[] = [];
  for(let i = 0; i < 300; i++) {
    data.push(60 * Math.sin(i*Math.PI*2/30)+30+Math.random()*5);
  }

  window.setInterval(()=>{
    data.shift();
    data.push(60 * Math.random());
    window.requestAnimationFrame(time => {
      graphs.forEach(graph => graph.redraw(data));
    })
  }, 200);
}