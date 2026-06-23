// Audio engine for Talk mode: mic capture → PCM16 frames (for talk.session.appendAudio)
// and a playback queue for the agent's PCM16 audio events. Browser-only (Web Audio +
// an AudioWorklet); the pure conversion helpers below are unit-tested.
//
// The gateway "gateway-relay" transport carries PCM16 (signed 16-bit, mono) as base64.
// Confirm the exact sample rate against the live `audio` event when wiring end-to-end;
// 24 kHz is the OpenAI-realtime convention and our default.

export const TALK_SAMPLE_RATE = 24000
// AnalyserNode bins exposed for the FFT visualizers (fftSize 128 → 64 bins).
export const FREQ_BINS = 64

// ── pure conversion helpers (unit-tested) ──────────────────────────────────────

// Float32 [-1,1] → signed 16-bit PCM.
export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

// Signed 16-bit PCM → Float32 [-1,1].
export function pcm16ToFloat32(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length)
  for (let i = 0; i < input.length; i++) out[i] = input[i] / (input[i] < 0 ? 0x8000 : 0x7fff)
  return out
}

// Linear-interpolation resample of mono Float32 from inRate → outRate.
export function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate === inRate || input.length === 0) return input
  const ratio = inRate / outRate
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0)
  }
  return out
}

// Int16 PCM ↔ base64. Chunked to avoid arg-count limits on large buffers.
export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  // Copy into an aligned buffer (the source offset may not be 2-byte aligned).
  return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (bytes.length & ~1)))
}

// RMS amplitude (0..1) of a Float32 frame — drives the orb level.
export function rms(frame: Float32Array): number {
  if (frame.length === 0) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return Math.min(1, Math.sqrt(sum / frame.length))
}

// ── capture worklet (inlined as a Blob → robust in the Electron file:// renderer) ──

const CAPTURE_WORKLET = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch && ch.length) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('talk-capture', CaptureProcessor)
`

export interface TalkAudioCallbacks {
  onAudioChunk: (base64: string) => void   // mic PCM16 base64, ready for appendAudio
  onMicLevel?: (level: number) => void
  onAgentLevel?: (level: number) => void
}

// Owns the mic capture chain and the agent playback queue for one Talk session.
export class TalkAudio {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private worklet: AudioWorkletNode | null = null
  // FFT taps for the visualizers — mic-input side and agent-playback side.
  private micAnalyser: AnalyserNode | null = null
  private agentAnalyser: AnalyserNode | null = null
  private muted = false
  // capture batching — coalesce the worklet's ~3ms frames into ~100ms chunks
  private pending: Int16Array[] = []
  private pendingLen = 0
  private static readonly CHUNK_SAMPLES = TALK_SAMPLE_RATE / 10  // 100 ms
  // playback scheduling
  private playHead = 0
  private active = new Set<AudioBufferSourceNode>()

  constructor(private cb: TalkAudioCallbacks) {}

  async startCapture(): Promise<void> {
    this.ctx = new AudioContext()
    // Echo cancellation so the agent never hears itself (false-interrupt prevention).
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const blobUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }))
    await this.ctx.audioWorklet.addModule(blobUrl)
    URL.revokeObjectURL(blobUrl)

    const src = this.ctx.createMediaStreamSource(this.stream)
    // Analysers for the FFT visualizers (mic from the input, agent from playback).
    this.micAnalyser = this.ctx.createAnalyser(); this.micAnalyser.fftSize = 128; this.micAnalyser.smoothingTimeConstant = 0.7
    this.agentAnalyser = this.ctx.createAnalyser(); this.agentAnalyser.fftSize = 128; this.agentAnalyser.smoothingTimeConstant = 0.7
    src.connect(this.micAnalyser)
    this.worklet = new AudioWorkletNode(this.ctx, 'talk-capture')
    const inRate = this.ctx.sampleRate
    this.worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const frame = e.data
      this.cb.onMicLevel?.(rms(frame))
      if (this.muted) return
      this.pending.push(floatTo16BitPCM(downsample(frame, inRate, TALK_SAMPLE_RATE)))
      this.pendingLen += this.pending[this.pending.length - 1].length
      if (this.pendingLen >= TalkAudio.CHUNK_SAMPLES) this.flushCapture()
    }
    src.connect(this.worklet)
    // Worklet must be connected to the graph to pull; route to a muted gain (no monitoring).
    const sink = this.ctx.createGain()
    sink.gain.value = 0
    this.worklet.connect(sink).connect(this.ctx.destination)
  }

  // Concat the pending frames into one chunk and hand it off for appendAudio.
  private flushCapture(): void {
    if (this.pendingLen === 0) return
    const merged = new Int16Array(this.pendingLen)
    let off = 0
    for (const c of this.pending) { merged.set(c, off); off += c.length }
    this.pending = []; this.pendingLen = 0
    this.cb.onAudioChunk(int16ToBase64(merged))
  }

  setMuted(m: boolean): void { this.muted = m; if (m) { this.pending = []; this.pendingLen = 0 } }

  // Fill `out` (length FREQ_BINS) with the current byte-frequency data for the mic
  // input or the agent playback. Returns false if that analyser isn't ready.
  readFrequencies(kind: 'mic' | 'agent', out: Uint8Array): boolean {
    const a = kind === 'agent' ? this.agentAnalyser : this.micAnalyser
    if (!a) return false
    a.getByteFrequencyData(out)
    return true
  }

  // Queue an agent PCM16 chunk for gapless playback.
  enqueue(base64: string): void {
    if (!this.ctx) return
    const pcm = base64ToInt16(base64)
    if (pcm.length === 0) return
    const f32 = pcm16ToFloat32(pcm)
    this.cb.onAgentLevel?.(rms(f32))
    const buf = this.ctx.createBuffer(1, f32.length, TALK_SAMPLE_RATE)
    buf.copyToChannel(f32, 0)
    const node = this.ctx.createBufferSource()
    node.buffer = buf
    node.connect(this.ctx.destination)
    if (this.agentAnalyser) node.connect(this.agentAnalyser)   // tap for the visualizer
    const now = this.ctx.currentTime
    if (this.playHead < now) this.playHead = now
    node.start(this.playHead)
    this.playHead += buf.duration
    this.active.add(node)
    node.onended = () => { this.active.delete(node); if (this.active.size === 0) this.cb.onAgentLevel?.(0) }
  }

  // Barge-in: stop everything queued/playing immediately.
  flushPlayback(): void {
    for (const n of this.active) { try { n.stop() } catch { /* already stopped */ } }
    this.active.clear()
    this.playHead = this.ctx ? this.ctx.currentTime : 0
    this.cb.onAgentLevel?.(0)
  }

  async stop(): Promise<void> {
    this.flushPlayback()
    this.worklet?.port.close()
    this.worklet?.disconnect()
    this.stream?.getTracks().forEach(t => t.stop())
    await this.ctx?.close().catch(() => {})
    this.ctx = null; this.stream = null; this.worklet = null
    this.micAnalyser = null; this.agentAnalyser = null
  }
}
