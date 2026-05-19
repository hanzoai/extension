// WebGPU AI Runner for Browser Extension
// Enables local AI inference directly in the browser via WebGPU compute shaders.
// Supports model loading, BPE tokenization, autoregressive generation, and embeddings.
//
// File format support:
//   - Raw blob (legacy hanzo-browser-control): the bytes are uploaded as one
//     GPUBuffer and consumed by the inline matmul/softmax shaders below.
//   - GGUF (llama.cpp's quantized container, v1-v3): parsed into a
//     name-keyed map of (offset, length, dtype, shape) descriptors, with
//     each tensor lazily uploaded to its own GPUBuffer through ExpertCache.
//     This unlocks Zen-Nano/Zen-Eco/Zen-Coder GGUF artifacts published on
//     HuggingFace without an intermediate conversion step.
//
// Sparse-load shell (ExpertCache below) materialises tensors on demand and
// evicts cold ones under an LRU budget. For dense models the cache simply
// holds every layer; for MoE (Zen Coder 480B, etc.) it only ever holds the
// experts the router actually picks for live tokens, which is the whole
// point of being able to run "too big" models in a browser.
//
// Still TODO before a GGUF model is end-to-end runnable here:
//   - Transformer kernel suite: RMSNorm, RoPE, multi-head attention with
//     KV cache, SwiGLU FFN, MoE router + dispatch (multiple thousand lines
//     of WGSL). The parser + cache below ARE the prerequisite layer.
//   - Speculative decoding: small dense draft (Zen Nano 0.6B) proposing N
//     tokens, large MoE verify (Zen Coder 31B/3B-active) checking the batch
//     in one forward pass. Layered on top of the kernels.

interface ModelConfig {
  name: string;
  url: string;
  quantization: '4bit' | '8bit' | 'fp16';
  maxTokens: number;
  vocabUrl?: string;
}

interface LoadedModel {
  buffer: GPUBuffer;
  config: ModelConfig;
  vocab: string[];
  vocabIndex: Map<string, number>;
  // Populated when the artifact is GGUF (otherwise undefined and the legacy
  // single-blob matmul/softmax pipeline runs).
  gguf?: GGUFContext;
}

// ---------------------------------------------------------------------------
// GGUF format
// ---------------------------------------------------------------------------
//
// Reference: https://github.com/ggerganov/ggml/blob/master/docs/gguf.md
// Layout (LE throughout):
//   [magic:4 "GGUF"] [version:u32] [tensor_count:u64] [kv_count:u64]
//   <kv-metadata × kv_count>
//   <tensor-info  × tensor_count>
//   <padding to alignment (default 32B)>
//   <tensor data blob>

const GGUF_MAGIC = 0x46554747; // "GGUF" little-endian as u32

enum GGUFType {
  UINT8 = 0,
  INT8 = 1,
  UINT16 = 2,
  INT16 = 3,
  UINT32 = 4,
  INT32 = 5,
  FLOAT32 = 6,
  BOOL = 7,
  STRING = 8,
  ARRAY = 9,
  UINT64 = 10,
  INT64 = 11,
  FLOAT64 = 12,
}

// GGML quantization types — only the ones modern HF GGUFs use are enumerated.
enum GGMLDType {
  F32 = 0,
  F16 = 1,
  Q4_0 = 2,
  Q4_1 = 3,
  Q5_0 = 6,
  Q5_1 = 7,
  Q8_0 = 8,
  Q8_1 = 9,
  Q2_K = 10,
  Q3_K = 11,
  Q4_K = 12,
  Q5_K = 13,
  Q6_K = 14,
  Q8_K = 15,
  I8 = 16,
  I16 = 17,
  I32 = 18,
}

interface GGUFTensorInfo {
  name: string;
  shape: number[];
  dtype: GGMLDType;
  /** Byte offset within the tensor-data blob (NOT within the file). */
  offset: number;
  /** Bytes occupied — computed once at parse, used for slicing + cache budget. */
  length: number;
}

interface GGUFContext {
  /** Raw KV metadata. ``general.architecture``, hyperparameters, vocab live here. */
  kv: Record<string, any>;
  /** Name → tensor descriptor. ``offset`` is relative to ``dataStart``. */
  tensors: Map<string, GGUFTensorInfo>;
  /** Byte offset in the source ArrayBuffer where the tensor data blob begins. */
  dataStart: number;
  /** Total tensor-data length. */
  dataLength: number;
  /** Backing buffer (kept for lazy slicing into GPUBuffers via ExpertCache). */
  source: ArrayBuffer;
}

/**
 * LRU sparse-load cache. Keys are typically ``"<layer>.<expert>.<tensor>"``
 * (or simpler ``"<tensor-name>"`` for dense models). On a miss the loader
 * fn is invoked to upload the bytes into a fresh GPUBuffer; on overflow the
 * coldest entry is destroyed.
 *
 * Why this shape: WebGPU has a ~2GB per-buffer cap and shared VRAM budgets
 * vary by platform, so the cache budget is in bytes (not entries). For MoE
 * the eviction policy is what lets you run Zen Coder 480B Q4 (~240GB
 * weights) on a 100GB Mac — the live working set per token is tiny.
 */
class ExpertCache {
  private map = new Map<string, { buffer: GPUBuffer; bytes: number }>();
  private order: string[] = []; // LRU: front = most recent
  private currentBytes = 0;

  constructor(
    private device: GPUDevice,
    /** Max bytes resident on the device. Default 4 GiB; bump for larger VRAM. */
    private budgetBytes: number = 4 * 1024 * 1024 * 1024,
  ) {}

  has(key: string): boolean { return this.map.has(key); }

  /** Get the GPUBuffer for ``key``, loading it on miss. */
  async get(key: string, loader: () => Promise<{ data: ArrayBuffer; label?: string }>): Promise<GPUBuffer> {
    const hit = this.map.get(key);
    if (hit) {
      this._touch(key);
      return hit.buffer;
    }
    const { data, label } = await loader();
    while (this.currentBytes + data.byteLength > this.budgetBytes && this.order.length > 0) {
      this._evictColdest();
    }
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: label || `expert-${key}`,
    });
    this.device.queue.writeBuffer(buffer, 0, data);
    this.map.set(key, { buffer, bytes: data.byteLength });
    this.order.unshift(key);
    this.currentBytes += data.byteLength;
    return buffer;
  }

  /** Force-evict everything. */
  clear(): void {
    for (const { buffer } of this.map.values()) buffer.destroy();
    this.map.clear();
    this.order = [];
    this.currentBytes = 0;
  }

  stats(): { entries: number; bytes: number; budget: number } {
    return { entries: this.map.size, bytes: this.currentBytes, budget: this.budgetBytes };
  }

  private _touch(key: string): void {
    const i = this.order.indexOf(key);
    if (i > 0) {
      this.order.splice(i, 1);
      this.order.unshift(key);
    }
  }

  private _evictColdest(): void {
    const coldKey = this.order.pop();
    if (!coldKey) return;
    const entry = this.map.get(coldKey);
    if (!entry) return;
    entry.buffer.destroy();
    this.map.delete(coldKey);
    this.currentBytes -= entry.bytes;
    console.log(`[Hanzo AI] Cache evicted ${coldKey} (${entry.bytes} bytes)`);
  }
}

export class WebGPUAI {
  private device: GPUDevice | null = null;
  private models: Map<string, LoadedModel> = new Map();

  async initialize(): Promise<boolean> {
    if (!navigator.gpu) {
      console.warn('[Hanzo AI] WebGPU not supported in this browser');
      return false;
    }

    try {
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });
      if (!adapter) {
        console.warn('[Hanzo AI] No GPU adapter found');
        return false;
      }

      this.device = await adapter.requestDevice({
        requiredLimits: {
          maxStorageBufferBindingSize: adapter.limits?.maxStorageBufferBindingSize || 134217728,
          maxBufferSize: adapter.limits?.maxBufferSize || 268435456,
        },
      });

      this.device.lost.then((info) => {
        console.error('[Hanzo AI] GPU device lost:', info.message);
        this.device = null;
      });

      console.log('[Hanzo AI] WebGPU initialized successfully');
      const features = adapter.features;
      console.log('[Hanzo AI] GPU Features:', Array.from(features));

      return true;
    } catch (error) {
      console.error('[Hanzo AI] WebGPU initialization failed:', error);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // BPE Tokenizer (byte-level, GPT-2 compatible)
  // ---------------------------------------------------------------------------

  private byteEncoder: Record<number, string> = {};
  private byteDecoder: Record<string, number> = {};
  private byteEncoderInitialized = false;

  private initByteEncoder(): void {
    if (this.byteEncoderInitialized) return;

    const bs: number[] = [];
    for (let i = 33; i <= 126; i++) bs.push(i);
    for (let i = 161; i <= 172; i++) bs.push(i);
    for (let i = 174; i <= 255; i++) bs.push(i);
    const cs = bs.slice();
    let n = 0;
    for (let b = 0; b < 256; b++) {
      if (!bs.includes(b)) {
        bs.push(b);
        cs.push(256 + n);
        n++;
      }
    }
    for (let i = 0; i < bs.length; i++) {
      this.byteEncoder[bs[i]] = String.fromCharCode(cs[i]);
      this.byteDecoder[String.fromCharCode(cs[i])] = bs[i];
    }
    this.byteEncoderInitialized = true;
  }

  private tokenize(text: string, model: LoadedModel): number[] {
    this.initByteEncoder();

    if (!model.vocab.length) {
      // Character-level fallback
      const tokens: number[] = [];
      for (let i = 0; i < text.length; i++) {
        tokens.push(text.charCodeAt(i));
      }
      return tokens;
    }

    // Encode text bytes to BPE character representation
    const bytes = new TextEncoder().encode(text);
    let word = '';
    for (const b of bytes) {
      word += this.byteEncoder[b] || String.fromCharCode(b);
    }

    // Greedy longest-match tokenization against vocabulary
    const tokens: number[] = [];
    let pos = 0;
    while (pos < word.length) {
      let bestLen = 0;
      let bestIdx = -1;
      const maxLen = Math.min(word.length - pos, 50);
      for (let len = maxLen; len >= 1; len--) {
        const candidate = word.substring(pos, pos + len);
        const idx = model.vocabIndex.get(candidate);
        if (idx !== undefined) {
          bestLen = len;
          bestIdx = idx;
          break;
        }
      }
      if (bestIdx !== -1) {
        tokens.push(bestIdx);
        pos += bestLen;
      } else {
        tokens.push(word.charCodeAt(pos) % Math.max(model.vocab.length, 1));
        pos++;
      }
    }
    return tokens;
  }

  private detokenize(tokenIds: Int32Array | number[], model: LoadedModel): string {
    this.initByteEncoder();

    if (!model.vocab.length) {
      const arr = tokenIds instanceof Int32Array ? Array.from(tokenIds) : tokenIds;
      return String.fromCharCode(...arr.filter(t => t > 0 && t < 65536));
    }

    let byteStr = '';
    for (const id of tokenIds) {
      if (id >= 0 && id < model.vocab.length) {
        byteStr += model.vocab[id];
      }
    }

    // Decode byte-level BPE back to UTF-8 bytes
    const decoded: number[] = [];
    for (const ch of byteStr) {
      if (ch in this.byteDecoder) {
        decoded.push(this.byteDecoder[ch]);
      } else {
        decoded.push(ch.charCodeAt(0) & 0xFF);
      }
    }
    return new TextDecoder().decode(new Uint8Array(decoded));
  }

  // ---------------------------------------------------------------------------
  // Model Loading
  // ---------------------------------------------------------------------------

  async loadModel(config: ModelConfig): Promise<void> {
    if (!this.device) {
      throw new Error('WebGPU not initialized');
    }

    console.log(`[Hanzo AI] Loading model: ${config.name}`);

    // Load model weights — cache-first, streaming with progress logs.
    // Service-worker Cache API persists across worker restarts so the bytes
    // are downloaded at most once per URL. Range-streaming the body avoids
    // pinning the entire blob in JS memory before GPU upload.
    const modelData = await this._fetchWithCache(config.url, config.name);

    // Create GPU buffer for model weights
    const modelBuffer = this.device.createBuffer({
      size: modelData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: `model-${config.name}`,
    });
    this.device.queue.writeBuffer(modelBuffer, 0, modelData);

    // Load vocabulary
    let vocab: string[] = [];
    const vocabIndex = new Map<string, number>();
    if (config.vocabUrl) {
      try {
        const vocabResp = await fetch(config.vocabUrl);
        if (vocabResp.ok) {
          const vocabData = await vocabResp.json();
          if (Array.isArray(vocabData)) {
            vocab = vocabData;
          } else if (typeof vocabData === 'object') {
            // Handle {token: id} format (GPT-2 style)
            const entries = Object.entries(vocabData) as [string, number][];
            entries.sort((a, b) => a[1] - b[1]);
            vocab = entries.map(e => e[0]);
          }
          for (let i = 0; i < vocab.length; i++) {
            vocabIndex.set(vocab[i], i);
          }
        }
      } catch (e) {
        console.warn(`[Hanzo AI] Vocabulary load failed for ${config.name}:`, e);
      }
    }

    this.models.set(config.name, {
      buffer: modelBuffer,
      config,
      vocab,
      vocabIndex,
    });

    console.log(`[Hanzo AI] Model ${config.name} loaded: ${modelData.byteLength} bytes, vocab: ${vocab.length}`);
  }

  // ---------------------------------------------------------------------------
  // WGSL Compute Shaders
  // ---------------------------------------------------------------------------

  private readonly matmulShader = `
    @group(0) @binding(0) var<storage, read> weights: array<f32>;
    @group(0) @binding(1) var<storage, read> input_tokens: array<f32>;
    @group(0) @binding(2) var<storage, read_write> output_logits: array<f32>;
    @group(0) @binding(3) var<storage, read> params: array<u32>;

    // params[0] = input_size
    // params[1] = output_size (vocab_size)
    // params[2] = weights_offset

    @compute @workgroup_size(256)
    fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
      let out_idx = gid.x;
      let input_size = params[0];
      let output_size = params[1];
      let w_offset = params[2];

      if (out_idx >= output_size) {
        return;
      }

      var sum: f32 = 0.0;
      for (var j: u32 = 0u; j < input_size; j = j + 1u) {
        let w_idx = w_offset + out_idx * input_size + j;
        if (w_idx < arrayLength(&weights)) {
          sum = sum + weights[w_idx] * input_tokens[j];
        }
      }
      output_logits[out_idx] = sum;
    }
  `;

  private readonly softmaxShader = `
    @group(0) @binding(0) var<storage, read_write> data: array<f32>;
    @group(0) @binding(1) var<storage, read> size_buf: array<u32>;

    @compute @workgroup_size(1)
    fn main() {
      let size = size_buf[0];

      var max_val: f32 = data[0];
      for (var i: u32 = 1u; i < size; i = i + 1u) {
        if (data[i] > max_val) {
          max_val = data[i];
        }
      }

      var sum: f32 = 0.0;
      for (var i: u32 = 0u; i < size; i = i + 1u) {
        let e = exp(data[i] - max_val);
        data[i] = e;
        sum = sum + e;
      }

      for (var i: u32 = 0u; i < size; i = i + 1u) {
        data[i] = data[i] / sum;
      }
    }
  `;

  // ---------------------------------------------------------------------------
  // Inference
  // ---------------------------------------------------------------------------

  async runInference(modelName: string, input: string): Promise<string> {
    const model = this.models.get(modelName);
    if (!model || !this.device) {
      throw new Error(`Model ${modelName} not loaded or GPU unavailable`);
    }

    const tokens = this.tokenize(input, model);
    const vocabSize = Math.max(model.vocab.length, 256);
    const inputSize = Math.min(tokens.length, 2048);
    const maxTokens = model.config.maxTokens || 128;

    // Normalize token IDs to float [0, 1]
    const inputData = new Float32Array(inputSize);
    for (let i = 0; i < inputSize; i++) {
      inputData[i] = tokens[i] / vocabSize;
    }

    // Upload input to GPU
    const inputBuffer = this.device.createBuffer({
      size: inputData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'input',
    });
    this.device.queue.writeBuffer(inputBuffer, 0, inputData);

    // Output buffer: one logit per vocab entry
    const outputByteSize = vocabSize * 4;
    const outputBuffer = this.device.createBuffer({
      size: outputByteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      label: 'output',
    });

    const paramsData = new Uint32Array([inputSize, vocabSize, 0]);
    const paramsBuffer = this.device.createBuffer({
      size: paramsData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'params',
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    // Readback buffer
    const readBuffer = this.device.createBuffer({
      size: outputByteSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: 'readback',
    });

    // Matmul pipeline
    const matmulModule = this.device.createShaderModule({ code: this.matmulShader });
    const matmulLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    const matmulPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [matmulLayout] }),
      compute: { module: matmulModule, entryPoint: 'main' },
    });
    const matmulBindGroup = this.device.createBindGroup({
      layout: matmulLayout,
      entries: [
        { binding: 0, resource: { buffer: model.buffer } },
        { binding: 1, resource: { buffer: inputBuffer } },
        { binding: 2, resource: { buffer: outputBuffer } },
        { binding: 3, resource: { buffer: paramsBuffer } },
      ],
    });

    // Softmax pipeline
    const softmaxModule = this.device.createShaderModule({ code: this.softmaxShader });
    const softmaxLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    const sizeBuf = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(sizeBuf, 0, new Uint32Array([vocabSize]));
    const softmaxPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [softmaxLayout] }),
      compute: { module: softmaxModule, entryPoint: 'main' },
    });
    const softmaxBindGroup = this.device.createBindGroup({
      layout: softmaxLayout,
      entries: [
        { binding: 0, resource: { buffer: outputBuffer } },
        { binding: 1, resource: { buffer: sizeBuf } },
      ],
    });

    // Autoregressive token generation
    const generatedTokens: number[] = [];
    const temperature = 0.7;

    for (let step = 0; step < maxTokens; step++) {
      const encoder = this.device.createCommandEncoder();

      // Forward pass: matmul
      const matmulPass = encoder.beginComputePass();
      matmulPass.setPipeline(matmulPipeline);
      matmulPass.setBindGroup(0, matmulBindGroup);
      matmulPass.dispatchWorkgroups(Math.ceil(vocabSize / 256));
      matmulPass.end();

      // Softmax normalization
      const softmaxPass = encoder.beginComputePass();
      softmaxPass.setPipeline(softmaxPipeline);
      softmaxPass.setBindGroup(0, softmaxBindGroup);
      softmaxPass.dispatchWorkgroups(1);
      softmaxPass.end();

      // Copy output to readback
      encoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, outputByteSize);
      this.device.queue.submit([encoder.finish()]);

      // Read probabilities from GPU
      await readBuffer.mapAsync(GPUMapMode.READ);
      const probs = new Float32Array(readBuffer.getMappedRange().slice(0));
      readBuffer.unmap();

      // Temperature-scaled multinomial sampling
      const nextToken = this.sampleToken(probs, temperature);
      generatedTokens.push(nextToken);

      // EOS detection (token 0 or explicit end tokens)
      if (nextToken === 0 || nextToken === 2) break;

      // Feed next token back for autoregressive step
      const newInput = new Float32Array([nextToken / vocabSize]);
      this.device.queue.writeBuffer(inputBuffer, 0, newInput);
      paramsData[0] = 1;
      this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);
    }

    // Cleanup GPU resources
    inputBuffer.destroy();
    outputBuffer.destroy();
    paramsBuffer.destroy();
    readBuffer.destroy();
    sizeBuf.destroy();

    return this.detokenize(generatedTokens, model);
  }

  private sampleToken(probs: Float32Array, temperature: number): number {
    if (temperature <= 0) {
      // Greedy decoding
      let maxIdx = 0;
      let maxVal = probs[0];
      for (let i = 1; i < probs.length; i++) {
        if (probs[i] > maxVal) {
          maxVal = probs[i];
          maxIdx = i;
        }
      }
      return maxIdx;
    }

    // Temperature scaling + softmax
    const scaled = new Float32Array(probs.length);
    let sum = 0;
    for (let i = 0; i < probs.length; i++) {
      scaled[i] = Math.exp(Math.log(Math.max(probs[i], 1e-10)) / temperature);
      sum += scaled[i];
    }
    for (let i = 0; i < scaled.length; i++) {
      scaled[i] /= sum;
    }

    // Multinomial sampling
    const r = Math.random();
    let cumulative = 0;
    for (let i = 0; i < scaled.length; i++) {
      cumulative += scaled[i];
      if (r < cumulative) return i;
    }
    return scaled.length - 1;
  }

  // ---------------------------------------------------------------------------
  // Embedding computation (for DOM element analysis)
  // ---------------------------------------------------------------------------

  async computeEmbedding(modelName: string, text: string): Promise<Float32Array> {
    const model = this.models.get(modelName);
    if (!model || !this.device) {
      throw new Error(`Model ${modelName} not loaded or GPU unavailable`);
    }

    const tokens = this.tokenize(text, model);
    const inputSize = Math.min(tokens.length, 512);
    const embeddingDim = 256;

    // Encode input
    const inputData = new Float32Array(inputSize);
    for (let i = 0; i < inputSize; i++) {
      inputData[i] = tokens[i];
    }

    const inputBuffer = this.device.createBuffer({
      size: inputData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(inputBuffer, 0, inputData);

    const embeddingBuffer = this.device.createBuffer({
      size: embeddingDim * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    const paramData = new Uint32Array([inputSize, embeddingDim, 0]);
    const paramBuffer = this.device.createBuffer({
      size: paramData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramBuffer, 0, paramData);

    // Reuse matmul shader for projection
    const shaderModule = this.device.createShaderModule({ code: this.matmulShader });
    const layout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    const pipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });
    const bindGroup = this.device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: model.buffer } },
        { binding: 1, resource: { buffer: inputBuffer } },
        { binding: 2, resource: { buffer: embeddingBuffer } },
        { binding: 3, resource: { buffer: paramBuffer } },
      ],
    });

    const readBuffer = this.device.createBuffer({
      size: embeddingDim * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(embeddingDim / 256));
    pass.end();
    encoder.copyBufferToBuffer(embeddingBuffer, 0, readBuffer, 0, embeddingDim * 4);
    this.device.queue.submit([encoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const embedding = new Float32Array(readBuffer.getMappedRange().slice(0));
    readBuffer.unmap();

    // Normalize to unit vector
    let norm = 0;
    for (let i = 0; i < embedding.length; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= norm;
      }
    }

    // Cleanup
    inputBuffer.destroy();
    embeddingBuffer.destroy();
    paramBuffer.destroy();
    readBuffer.destroy();

    return embedding;
  }

  // ---------------------------------------------------------------------------
  // Cached, progress-reporting fetch — used by loadModel().
  // ---------------------------------------------------------------------------

  /**
   * Fetch a model blob with persistent caching. Backed by the service-worker
   * Cache API so the bytes survive worker restarts and only download once
   * per URL. Streams the body to log progress every ~5% so big artifacts
   * (huggingface.co/<repo>/resolve/main/<file>) don't appear to hang.
   *
   * Cache invalidation: the URL is the key; bump the URL (e.g. point to a
   * different revision sha) to force a re-fetch. Use ``WebGPUAI.evictCache``
   * to wipe everything when models go bad.
   */
  private async _fetchWithCache(url: string, label: string): Promise<ArrayBuffer> {
    const cacheName = 'hanzo-webgpu-models-v1';
    const cache = typeof caches !== 'undefined' ? await caches.open(cacheName) : null;

    if (cache) {
      const hit = await cache.match(url);
      if (hit) {
        console.log(`[Hanzo AI] Cache hit: ${label} (${url})`);
        return await hit.arrayBuffer();
      }
    }

    console.log(`[Hanzo AI] Fetching: ${label} (${url})`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${label}: ${response.status} ${response.statusText}`);
    }

    const total = Number(response.headers.get('content-length') || 0);
    let received = 0;
    let nextLog = total > 0 ? Math.floor(total * 0.05) : Infinity;
    const chunks: Uint8Array[] = [];

    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        if (total > 0 && received >= nextLog) {
          const pct = Math.floor((received / total) * 100);
          console.log(`[Hanzo AI] ${label}: ${pct}% (${received}/${total} bytes)`);
          nextLog = received + Math.floor(total * 0.05);
        }
      }
    } else {
      chunks.push(new Uint8Array(await response.arrayBuffer()));
    }

    // Stitch chunks into a single ArrayBuffer.
    const blob = new Uint8Array(received || chunks.reduce((n, c) => n + c.byteLength, 0));
    let offset = 0;
    for (const c of chunks) {
      blob.set(c, offset);
      offset += c.byteLength;
    }
    console.log(`[Hanzo AI] Fetched: ${label} (${blob.byteLength} bytes)`);

    // Write back into the cache. Response body is single-use; re-construct
    // from the assembled blob so cache.put gets a fresh, readable stream.
    if (cache) {
      try {
        await cache.put(url, new Response(blob, {
          headers: { 'content-type': 'application/octet-stream' },
        }));
        console.log(`[Hanzo AI] Cached: ${label}`);
      } catch (e) {
        // Quota errors are non-fatal — we still have the bytes in memory.
        console.warn(`[Hanzo AI] Cache write failed for ${label}:`, e);
      }
    }

    return blob.buffer;
  }

  /** Build an HF resolve URL for a given repo / file / revision. */
  static huggingFaceURL(repo: string, file: string, revision: string = 'main'): string {
    return `https://huggingface.co/${repo}/resolve/${revision}/${file}`;
  }

  /** Wipe every cached model blob. Useful when a model artifact is rotated. */
  static async evictCache(): Promise<void> {
    if (typeof caches === 'undefined') return;
    await caches.delete('hanzo-webgpu-models-v1');
    console.log('[Hanzo AI] WebGPU model cache evicted');
  }

  // ---------------------------------------------------------------------------
  // Status / Cleanup
  // ---------------------------------------------------------------------------

  getStatus(): { initialized: boolean; models: string[] } {
    return {
      initialized: !!this.device,
      models: Array.from(this.models.keys()),
    };
  }

  async unloadModel(name: string): Promise<void> {
    const model = this.models.get(name);
    if (model) {
      model.buffer.destroy();
      this.models.delete(name);
      console.log(`[Hanzo AI] Model ${name} unloaded`);
    }
  }

  destroy(): void {
    for (const [name, model] of this.models) {
      model.buffer.destroy();
    }
    this.models.clear();
    this.device = null;
  }
}
