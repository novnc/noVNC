export function RGB2PPM(rgb: Uint8Array, width: number, height: number): string {
  const lines: string[] = [];
  for (let i = 0; i < rgb.length; i += 3) {
    lines.push(`${ rgb[i] } ${ rgb[i+1] } ${ rgb[i+2] }`);
  }

  return `P3 ${ width } ${ height } 255\n` + lines.join('\n');
}

export function YUV2RBG(yuv: Uint8Array, width: number, height: number) {
  const uStart = width * height;
  const halfWidth = (width >>> 1);
  const vStart = uStart + (uStart >>> 2);
  const rgb = new Uint8Array(uStart * 3);

  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const yy = yuv[y * width + x];
      const colorIndex = (y >>> 1) * halfWidth + (x >>> 1);
      const uu = yuv[uStart + colorIndex] - 128;
      const vv = yuv[vStart + colorIndex] - 128;

      rgb[i++] = yy + 1.402 * vv;              // R
      rgb[i++] = yy - 0.344 * uu - 0.714 * vv; // G
      rgb[i++] = yy + 1.772 * uu;              // B
    }
  }

  return rgb;
}