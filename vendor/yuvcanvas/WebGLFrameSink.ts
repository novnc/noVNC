import {YUVFrame} from "./YuvBuffer";

export class WebGLFrameSink {
    canvas : HTMLCanvasElement;
    gl : WebGLRenderingContext|null;
    program:WebGLProgram;
    unpackProgram:WebGLProgram;
    textures:{[key:string]:WebGLTexture} = {};
    framebuffers:{[key:string]:WebGLFramebuffer} = {};
    // stripes = {};
    buf:any;
    rectangle:Float32Array;
    positionLocation:number;
    unpackPositionLocation:number;
    unpackTexturePositionBuffer:WebGLBuffer;
    unpackTexturePositionLocation:number;
    stripeLocation:number;
    unpackTextureLocation:number;
    lumaPositionBuffer:WebGLBuffer;
    lumaPositionLocation:number;
    chromaPositionBuffer:WebGLBuffer;
    chromaPositionLocation:number;

    static shaders:{
        vertex : string;
        fragment : string;
    } = {
        vertex : `
            precision lowp float;
            attribute vec2 aPosition;
            attribute vec2 aLumaPosition;
            attribute vec2 aChromaPosition;
            varying vec2 vLumaPosition;
            varying vec2 vChromaPosition;
            void main() {
                gl_Position = vec4(aPosition, 0, 1);
                vLumaPosition = aLumaPosition;
                vChromaPosition = aChromaPosition;
            }
        `,
        fragment : `
            precision lowp float;
            uniform sampler2D uTextureY;
            uniform sampler2D uTextureCb;
            uniform sampler2D uTextureCr;
            varying vec2 vLumaPosition;
            varying vec2 vChromaPosition;
            void main() {
               // Y, Cb, and Cr planes are uploaded as LUMINANCE textures.
               float fY = texture2D(uTextureY, vLumaPosition).x;
               float fCb = texture2D(uTextureCb, vChromaPosition).x;
               float fCr = texture2D(uTextureCr, vChromaPosition).x;
            
               // Premultipy the Y...
               float fYmul = fY * 1.1643828125;
            
               // And convert that to RGB!
               // gl_FragColor = vec4(
               //   fYmul + 1.59602734375 * fCr - 0.87078515625,
               //   fYmul - 0.39176171875 * fCb - 0.81296875 * fCr + 0.52959375,
               //   fYmul + 2.017234375   * fCb - 1.081390625,
               //   1
               // );
               gl_FragColor = vec4(                 
                 fYmul + 2.017234375   * fCb - 1.081390625,
                 fYmul - 0.39176171875 * fCb - 0.81296875 * fCr + 0.52959375,
                 fYmul + 1.59602734375 * fCr - 0.87078515625,
                 1
               );
            }
        `
    }

    constructor(canvas:HTMLCanvasElement) {
        this.canvas = canvas;
        this.gl = WebGLFrameSink.contextForCanvas(canvas);
        if (this.gl === null) {
            throw new Error('WebGL unavailable');
        }

        // In the world of GL there are no rectangles.
        // There are only triangles.
        // THERE IS NO SPOON.
        this.rectangle = new Float32Array([
            // First triangle (top left, clockwise)
            -1.0, -1.0,
            +1.0, -1.0,
            -1.0, +1.0,

            // Second triangle (bottom right, clockwise)
            -1.0, +1.0,
            +1.0, -1.0,
            +1.0, +1.0
        ]);
        this.clear();
    }

    /**
     * Static function to check if WebGL will be available with appropriate features.
     * @returns true if available
     */
    static isAvailable() {
        let gl:WebGLRenderingContext|null = null;
        const canvas:HTMLCanvasElement = document.createElement('canvas') as HTMLCanvasElement;
        canvas.width = 1;
        canvas.height = 1;

        try {
            gl = WebGLFrameSink.contextForCanvas(canvas);
        } catch (e) {
            return false;
        }

        if (gl) {
            var register = gl.TEXTURE0,
              width = 4,
              height = 4,
              texture = gl.createTexture(),
              data = new Uint8Array(width * height),
              // texWidth = WebGLFrameSink.stripe ? (width / 4) : width,
              // format = WebGLFrameSink.stripe ? gl.RGBA : gl.LUMINANCE,
              // filter = WebGLFrameSink.stripe ? gl.NEAREST : gl.LINEAR;
              texWidth = width,
              format = gl.LUMINANCE,
              filter = gl.LINEAR;

            gl.activeTexture(register);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
            gl.texImage2D(
              gl.TEXTURE_2D,
              0, // mip level
              format, // internal format
              texWidth,
              height,
              0, // border
              format, // format
              gl.UNSIGNED_BYTE, //type
              data // data!
            );

            var err = gl.getError();
            if (err) {
                // Doesn't support luminance textures?
                return false;
            } else {
                return true;
            }
        } else {
            return false;
        }
    }

    static contextForCanvas(canvas:HTMLCanvasElement) {
        var options = {
            // Don't trigger discrete GPU in multi-GPU systems
            preferLowPowerToHighPerformance: true,
            powerPreference: 'low-power',
            // Don't try to use software GL rendering!
            failIfMajorPerformanceCaveat: true,
            // In case we need to capture the resulting output.
            preserveDrawingBuffer: true
        };
        return (canvas.getContext('webgl', options) ||
          canvas.getContext('experimental-webgl', options)) as WebGLRenderingContext;
    }

    compileShader(type:number, source:string) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const err = this.gl.getShaderInfoLog(shader);
            this.gl.deleteShader(shader);
            throw new Error('GL shader compilation for ' + type + ' failed: ' + err);
        }
        return shader;
    }

    createOrReuseTexture(name:string) {
        if (!this.textures[name]) {
            this.textures[name] = this.gl.createTexture();
        }
        return this.textures[name];
    }

    uploadTexture(name:string, width:number, height:number, data:Uint8Array) {
        const gl = this.gl;
        const texture = this.createOrReuseTexture(name);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0, // mip level
            gl.LUMINANCE, // internal format
            width,
            height,
            0, // border
            gl.LUMINANCE, // format
            gl.UNSIGNED_BYTE, //type
            data // data!
        );
    }

    unpackTexture(name:string, width:number, height:number) {
        const gl = this.gl;
        const texture = this.textures[name];

        // Upload to a temporary RGBA texture, then unpack it.
        // This is faster than CPU-side swizzling in ANGLE on Windows.
        gl.useProgram(this.unpackProgram);

        var fb = this.framebuffers[name];
        if (!fb) {
            // Create a framebuffer and an empty target size
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texImage2D(
                gl.TEXTURE_2D,
                0, // mip level
                gl.RGBA, // internal format
                width,
                height,
                0, // border
                gl.RGBA, // format
                gl.UNSIGNED_BYTE, //type
                null // data!
            );

            fb = this.framebuffers[name] = gl.createFramebuffer();
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

        const tempTexture = this.textures[name + '_temp'];
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, tempTexture);
        gl.uniform1i(this.unpackTextureLocation, 1);

        // const stripeTexture = textures[name + '_stripe'];
        // gl.activeTexture(gl.TEXTURE2);
        // gl.bindTexture(gl.TEXTURE_2D, stripeTexture);
        // gl.uniform1i(stripeLocation, 2);

        // Rectangle geometry
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        gl.enableVertexAttribArray(this.positionLocation);
        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

        // Set up the texture geometry...
        gl.bindBuffer(gl.ARRAY_BUFFER, this.unpackTexturePositionBuffer);
        gl.enableVertexAttribArray(this.unpackTexturePositionLocation);
        gl.vertexAttribPointer(this.unpackTexturePositionLocation, 2, gl.FLOAT, false, 0, 0);

        // Draw into the target texture...
        gl.viewport(0, 0, width, height);

        gl.drawArrays(gl.TRIANGLES, 0, this.rectangle.length / 2);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    }

    attachTexture(name:string, register:number, index:number) {
        const gl = this.gl;
        gl.activeTexture(register);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[name]);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        gl.uniform1i(gl.getUniformLocation(this.program, name), index);
    }

    // function buildStripe(width) {
    //     if (stripes[width]) {
    //         return stripes[width];
    //     }
    //     var len = width,
    //         out = new Uint32Array(len);
    //     for (var i = 0; i < len; i += 4) {
    //         out[i    ] = 0x000000ff;
    //         out[i + 1] = 0x0000ff00;
    //         out[i + 2] = 0x00ff0000;
    //         out[i + 3] = 0xff000000;
    //     }
    //     return stripes[width] = new Uint8Array(out.buffer);
    // }

    initProgram(vertexShaderSource:string, fragmentShaderSource:string) {
        const gl = this.gl;
        var vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexShaderSource);
        var fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

        var program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);

        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            var err = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error('GL program linking failed: ' + err);
        }

        return program;
    }

    init() {
        const gl = this.gl;
        // if (WebGLFrameSink.stripe) {
        //     unpackProgram = initProgram(shaders.vertexStripe, shaders.fragmentStripe);
        //     unpackPositionLocation = gl.getAttribLocation(unpackProgram, 'aPosition');
        //
        //     unpackTexturePositionBuffer = gl.createBuffer();
        //     var textureRectangle = new Float32Array([
        //         0, 0,
        //         1, 0,
        //         0, 1,
        //         0, 1,
        //         1, 0,
        //         1, 1
        //     ]);
        //     gl.bindBuffer(gl.ARRAY_BUFFER, unpackTexturePositionBuffer);
        //     gl.bufferData(gl.ARRAY_BUFFER, textureRectangle, gl.STATIC_DRAW);
        //
        //     unpackTexturePositionLocation = gl.getAttribLocation(unpackProgram, 'aTexturePosition');
        //     stripeLocation = gl.getUniformLocation(unpackProgram, 'uStripe');
        //     unpackTextureLocation = gl.getUniformLocation(unpackProgram, 'uTexture');
        // }
        this.program = this.initProgram(WebGLFrameSink.shaders.vertex, WebGLFrameSink.shaders.fragment);

        this.buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        gl.bufferData(gl.ARRAY_BUFFER, this.rectangle, gl.STATIC_DRAW);

        this.positionLocation = gl.getAttribLocation(this.program, 'aPosition');
        this.lumaPositionBuffer = gl.createBuffer();
        this.lumaPositionLocation = gl.getAttribLocation(this.program, 'aLumaPosition');
        this.chromaPositionBuffer = gl.createBuffer();
        this.chromaPositionLocation = gl.getAttribLocation(this.program, 'aChromaPosition');
    }

    /**
     * Actually draw a frame.
     * @param buffer - YUV frame buffer object
     */
    drawFrame(buffer:YUVFrame) {
        const gl = this.gl;
        const format = buffer.format;

        var formatUpdate = (!this.program || this.canvas.width !== format.displayWidth || this.canvas.height !== format.displayHeight);
        if (formatUpdate) {
            // Keep the canvas at the right size...
            this.canvas.width = format.displayWidth;
            this.canvas.height = format.displayHeight;
            this.clear();
        }

        if (!this.program) {
            this.init();
        }

        if (formatUpdate) {
            var setupTexturePosition = function(buffer:WebGLBuffer, location:number, texWidth:number) {
                // Warning: assumes that the stride for Cb and Cr is the same size in output pixels
                var textureX0 = format.cropLeft / texWidth;
                var textureX1 = (format.cropLeft + format.cropWidth) / texWidth;
                var textureY0 = (format.cropTop + format.cropHeight) / format.height;
                var textureY1 = format.cropTop / format.height;
                var textureRectangle = new Float32Array([
                    textureX0, textureY0,
                    textureX1, textureY0,
                    textureX0, textureY1,
                    textureX0, textureY1,
                    textureX1, textureY0,
                    textureX1, textureY1
                ]);

                gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                gl.bufferData(gl.ARRAY_BUFFER, textureRectangle, gl.STATIC_DRAW);
            };
            setupTexturePosition(
                this.lumaPositionBuffer,
                this.lumaPositionLocation,
                buffer.y.stride);
            setupTexturePosition(
                this.chromaPositionBuffer,
                this.chromaPositionLocation,
                buffer.u.stride * format.width / format.chromaWidth);
        }

        // Create or update the textures...
        this.uploadTexture('uTextureY', buffer.y.stride, format.height, buffer.y.bytes);
        this.uploadTexture('uTextureCb', buffer.u.stride, format.chromaHeight, buffer.u.bytes);
        this.uploadTexture('uTextureCr', buffer.v.stride, format.chromaHeight, buffer.v.bytes);

        // if (WebGLFrameSink.stripe) {
        //     // Unpack the textures after upload to avoid blocking on GPU
        //     unpackTexture('uTextureY', buffer.y.stride, format.height);
        //     unpackTexture('uTextureCb', buffer.u.stride, format.chromaHeight);
        //     unpackTexture('uTextureCr', buffer.v.stride, format.chromaHeight);
        // }

        // Set up the rectangle and draw it
        gl.useProgram(this.program);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        this.attachTexture('uTextureY', gl.TEXTURE0, 0);
        this.attachTexture('uTextureCb', gl.TEXTURE1, 1);
        this.attachTexture('uTextureCr', gl.TEXTURE2, 2);

        // Set up geometry
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        gl.enableVertexAttribArray(this.positionLocation);
        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

        // Set up the texture geometry...
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lumaPositionBuffer);
        gl.enableVertexAttribArray(this.lumaPositionLocation);
        gl.vertexAttribPointer(this.lumaPositionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.chromaPositionBuffer);
        gl.enableVertexAttribArray(this.chromaPositionLocation);
        gl.vertexAttribPointer(this.chromaPositionLocation, 2, gl.FLOAT, false, 0, 0);

        // Aaaaand draw stuff.
        gl.drawArrays(gl.TRIANGLES, 0, this.rectangle.length / 2);
    }

    clear() {
        const gl = this.gl;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }
}

//TODO: determine what is sweating - GPU or CPU? if it is GPU in fact implement this.

// For Windows; luminance and alpha textures are ssllooww to upload,
// so we pack into RGBA and unpack in the shaders.
//
// This seems to affect all browsers on Windows, probably due to fun
// mismatches between GL and D3D.
// WebGLFrameSink.stripe = (function() {
//     if (navigator.userAgent.indexOf('Windows') !== -1) {
//         return true;
//     }
//     return false;
// })();