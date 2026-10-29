// AudioWorklet que graba su entrada (canal 0) y la envía al hilo principal junto con el
// índice de frame del reloj de audio (currentFrame) en que empieza cada bloque.
class LabRecorder extends AudioWorkletProcessor {
    constructor() {
        super();
        this.on = false;
        this.buf = new Float32Array(128 * 64);
        this.fill = 0;
        this.startFrame = 0;
        this.port.onmessage = (e) => {
            if (e.data === "start") {
                this.on = true;
                this.fill = 0;
            } else if (e.data === "stop") {
                this.flush();
                this.on = false;
            }
        };
    }

    flush() {
        if (this.fill > 0) {
            this.port.postMessage({
                frame: this.startFrame,
                data: this.buf.slice(0, this.fill)
            });
            this.fill = 0;
        }
    }

    process(inputs) {
        if (!this.on) return true;
        const ch = inputs[0]?.[0];
        if (this.fill === 0) this.startFrame = currentFrame;
        if (ch) this.buf.set(ch, this.fill);
        else this.buf.fill(0, this.fill, this.fill + 128);
        this.fill += 128;
        if (this.fill >= this.buf.length) this.flush();
        return true;
    }
}
registerProcessor("lab-recorder", LabRecorder);
