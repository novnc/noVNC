const WIDTH = 2048
const HEIGHT = 1024
const MODE = 3

import * as novnc from './novnc'
import { memory } from './novnc_bg'

const canvas = document.getElementById('target')
const ctx = canvas.getContext('2d')

canvas.width = WIDTH
canvas.height = HEIGHT

if (MODE === 2 || MODE === 3) {
  let byteSize = WIDTH * HEIGHT * 4
  var pointer = novnc.alloc( byteSize )

  var u8array = new Uint8ClampedArray(memory.buffer, pointer, byteSize)
  var imgData = new ImageData(u8array, WIDTH, HEIGHT)
}

let frame = -1

function renderLoop() {
  const startMs = (new Date()).getTime()
  fps.render()
  frame += 1

  if (MODE === 1) {
    novnc.draw1(ctx, WIDTH, HEIGHT, frame)
  } else {
    if (MODE === 2) {
      novnc.draw2(pointer, WIDTH, HEIGHT, frame)
    } else if (MODE === 3) {
      novnc.draw3(pointer, WIDTH, HEIGHT, frame)
    }

    ctx.putImageData(imgData, 0, 0)
  }
  animationId = requestAnimationFrame(renderLoop)
  //console.log("elapsed:", (new Date()).getTime() - startMs)
}


//////////////////////////////////////////////////////////////////////////////
// From: https://github.com/rustwasm/wasm_game_of_life/blob/3253fa3a1557bdb9525f3b5c134b58efa1041c55/index.js#L27

let animationId = null

const fps = new class {
  constructor() {
    this.fps = document.getElementById("fps")
    this.frames = []
    this.lastFrameTimeStamp = performance.now()
  }

  render() {
    const now = performance.now()
    const delta = now - this.lastFrameTimeStamp
    this.lastFrameTimeStamp = now
    const fps = 1 / delta * 1000

    this.frames.push(fps)
    if (this.frames.length > 100) {
      this.frames.shift()
    }

    let min = Infinity
    let max = -Infinity
    let sum = 0
    for (let i = 0; i < this.frames.length; i++) {
      sum += this.frames[i]
      min = Math.min(this.frames[i], min)
      max = Math.max(this.frames[i], max)
    }
    let mean = sum / this.frames.length

    this.fps.textContent = `
Frames per Second:
         latest = ${Math.round(fps)}
avg of last 100 = ${Math.round(mean)}
min of last 100 = ${Math.round(min)}
max of last 100 = ${Math.round(max)}
`.trim()
  }
}

const playPauseButton = document.getElementById("play-pause")

const isPaused = () => {
  return animationId === null
}

const play = () => {
  playPauseButton.textContent = "⏸"
  renderLoop()
}

const pause = () => {
  playPauseButton.textContent = "▶"
  cancelAnimationFrame(animationId)
  animationId = null
}

playPauseButton.addEventListener("click", event => {
  if (isPaused()) {
    play()
  } else {
    pause()
  }
})
playPauseButton.textContent = "▶"

//////////////////////////////////////////////////////////////////////////////
