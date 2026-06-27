class AudioProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const channelData = input[0];
      // Convert Float32 to Int16 PCM (Little Endian for Google API / standard WAV)
      const buffer = new ArrayBuffer(channelData.length * 2);
      const view = new DataView(buffer);
      for (let i = 0; i < channelData.length; i++) {
        let sample = Math.max(-1, Math.min(1, channelData[i]));
        let val = sample < 0 ? sample * 32768 : sample * 32767;
        view.setInt16(i * 2, val, true); // true = Little Endian
      }
      this.port.postMessage(buffer);
    }
    return true; // Keep the processor alive
  }
}
registerProcessor('audio-processor', AudioProcessor);
