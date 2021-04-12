/**
 * This class wraps the details of the h264 WASM module.
 * Each call to decode(nalu) will decode a single encoded element.
 * When decode(nalu) returns PIC_RDY, a picture is ready in the output buffer.
 */
export declare class H264Decoder {
    private pStorage;
    private pWidth;
    private pHeight;
    private pPicture;
    private decBuffer;
    private memory;
    private asm;
    width: number;
    height: number;
    pic: Uint8Array;
    static RDY: number;
    static PIC_RDY: number;
    static HDRS_RDY: number;
    static ERROR: number;
    static PARAM_SET_ERROR: number;
    static MEMALLOC_ERROR: number;
    constructor();
    init(): Promise<void>;
    decode(nalu: Uint8Array): number;
}
