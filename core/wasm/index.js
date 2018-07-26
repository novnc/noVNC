const WIDTH = 1024
const HEIGHT = 1024
const MODE = 3

import * as novnc from './novnc'
import { memory } from './novnc_bg'

const canvas = document.getElementById('target')
const ctx = canvas.getContext('2d')

canvas.width = WIDTH;
canvas.height = HEIGHT;

if (MODE === 2 || MODE === 3) {
  let byteSize = WIDTH * HEIGHT * 4
  var pointer = novnc.alloc( byteSize )

  var u8array = new Uint8ClampedArray(memory.buffer, pointer, byteSize)
  var imgData = new ImageData(u8array, WIDTH, HEIGHT)
  console.log("imgData:", imgData)
}

let msList1 = []
let msList2 = []

function avg(l) {
  return (l.reduce((a,b) => a+b, 0)/l.length).toFixed(2)
}

function update() {
  let ms1, ms2
  const startMs = (new Date()).getTime()
  const red   = parseInt(Math.random()*256)
  const green = parseInt(Math.random()*256)
  const blue  = parseInt(Math.random()*256)
  console.log(`red: ${red}, green: ${green}, blue: ${blue}`)
  if (MODE === 1) {
    novnc.draw1(ctx, WIDTH, HEIGHT,
        red, green, blue)
    ms1 = (new Date()).getTime()
    msList1.push(ms1 - startMs)
    console.log(`frame elapsed: ${ms1 - startMs} (${avg(msList1)})`)
  } else {
    if (MODE === 2) {
      novnc.draw2(pointer, WIDTH, HEIGHT,
          red, green, blue)
    } else if (MODE === 3) {
      novnc.draw3(pointer, WIDTH, HEIGHT,
          red, green, blue)
    }
    ms1 = (new Date()).getTime()
    ctx.putImageData(imgData, 0, 0)
    ms2 = (new Date()).getTime()
    msList1.push(ms1 - startMs)
    msList2.push(ms2 - ms1)
    console.log(`draw elapsed: ${ms1 - startMs} (${avg(msList1)}), ` +
                `putIMageData elapsed: ${ms2 - ms1} (${avg(msList2)})`)

    //window.requestAnimationFrame(update)
  }
}

canvas.addEventListener('click', () => {
  update()
})
update()
