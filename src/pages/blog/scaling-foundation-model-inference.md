---
layout: '../../layouts/PostLayout.astro'
title: 'The Two Phases of LLM Inference: Prefill and Decode'
description: "Time-to-first-token is compute-bound. Token generation is memory-bound. Understanding this split is key to optimizing inference."
pubDate: '2025-11-14'
tags: ['machine learning', 'infrastructure']
---

LLM inference looks simple: input goes in, tokens come out. But under the hood, there are two fundamentally different phases with opposite bottlenecks. Prefill (processing your prompt) is compute-bound. Decode (generating tokens) is memory-bound. Optimizations that help one phase often don't help—or hurt—the other.

## The Two Phases

### Prefill: Processing the Input

When you send a prompt to an LLM, the model first processes all input tokens in parallel. This is the "prefill" phase.

```
Input: "Explain quantum computing in simple terms"
Prefill: Process all 6 tokens at once
Output: KV cache ready, first token probability distribution
```

**Characteristics:**
- Parallelizable: all tokens processed simultaneously
- Compute-bound: matrix multiplications dominate
- Linear in input length: 2x longer prompt ≈ 2x longer prefill

### Decode: Generating Output

After prefill, the model generates tokens one at a time. Each new token requires:
1. Load model weights
2. Run one forward pass
3. Sample next token
4. Repeat

**Characteristics:**
- Sequential: each token depends on all previous tokens
- Memory-bound: loading weights dominates
- Linear in output length: 100 tokens ≈ 100× the time of 1 token

## Why the Bottlenecks Differ

### Prefill is Compute-Bound

Processing 1000 input tokens means doing matrix multiplications on a [1000, hidden_dim] tensor. The GPU's compute units are busy—this is what GPUs are designed for.

Metric: **FLOPS utilization is high** during prefill.

### Decode is Memory-Bound

Processing 1 token at a time means loading the entire model for minimal compute. With a 70B model:

```
Model weights: 140GB (fp16)
Work per token: One forward pass
Memory bandwidth: 2 TB/s (A100)
Time just for memory: 140GB / 2TB/s = 70ms
```

You spend most of decode time waiting for memory, not computing.

Metric: **Memory bandwidth utilization is high** during decode; compute utilization is low.

## TTFT vs TPS: The Two Metrics

**Time-to-first-token (TTFT)**: How long until the first response token appears. Dominated by prefill time. Users perceive this as "response latency."

**Tokens per second (TPS)**: How fast tokens stream after the first one. Dominated by decode throughput. Users perceive this as "how fast it types."

Different applications have different priorities:

| Use Case | TTFT Priority | TPS Priority |
|----------|---------------|--------------|
| Chat | High (users wait) | Medium (streaming hides latency) |
| Batch processing | Low | High |
| Code completion | Very high (inline suggestions) | Medium |
| Summarization | Medium | High |

## Optimization Strategies

### For Prefill (TTFT)

**Problem**: Compute-bound on large prompts.

**Solutions:**
- **Chunked prefill**: Split long prompts into chunks, interleave with decode batches
- **Tensor parallelism**: Split model across GPUs to parallelize compute
- **KV cache reuse**: If prompts share prefixes (system prompts), cache and reuse

**What doesn't help:**
- Quantization (compute-bound, not memory-bound)
- More memory bandwidth

### For Decode (TPS)

**Problem**: Memory-bound, sequential.

**Solutions:**
- **Batching**: Amortize weight loading across multiple sequences
- **Quantization**: Reduce weight size → less memory traffic → faster decode
- **Speculative decoding**: Draft multiple tokens, verify in parallel
- **KV cache optimization**: Reduce cache memory to fit more batches

**What doesn't help:**
- More compute (already underutilized)
- Tensor parallelism (helps latency, not throughput)

## The KV Cache Problem

During decode, each token attends to all previous tokens. The keys and values from previous tokens are cached—the "KV cache."

**KV cache size per token:**
```
2 × num_layers × num_heads × head_dim × bytes_per_element
```

For Llama 2 70B (80 layers, 64 heads, 128 dim, fp16):
```
2 × 80 × 64 × 128 × 2 = 2.6MB per token
```

At 8K context: **20.5 GB just for KV cache**

This is why long-context models are expensive—the KV cache, not the weights, becomes the memory bottleneck.

### KV Cache Solutions

- **GQA (Grouped Query Attention)**: Llama 2 uses 8 KV heads instead of 64 → 8x smaller cache
- **MLA (Multi-head Latent Attention)**: Compress KV into smaller latent space
- **Paged attention**: Manage cache like virtual memory, reduce fragmentation
- **KV cache quantization**: Store in INT8, decompress on demand

## Batching: The Key to Utilization

Single-request decode is inefficient: load 140GB of weights for one token.

Batched decode: load 140GB of weights for N tokens (one per request).

| Batch Size | Relative Throughput |
|------------|---------------------|
| 1 | 1.0x |
| 8 | ~5x |
| 32 | ~12x |

But batching has limits:
- KV cache memory scales with batch size
- Latency for all requests = latency for longest request (without continuous batching)
- Prefill can interfere with decode batches

**Continuous batching** addresses the latency problem: requests enter and exit the batch dynamically rather than waiting for all to complete.

## The System Design Tradeoffs

### Separate Prefill and Decode

Some systems (like TensorRT-LLM) support running prefill and decode on separate GPU pools:

**Prefill pool:**
- Optimized for compute
- Higher batch sizes for prefill
- Tensor parallelism for low TTFT

**Decode pool:**
- Optimized for memory bandwidth
- Continuous batching
- Quantization for more sequences

This separation allows optimizing each phase independently.

### Disaggregated KV Cache

Instead of coupling KV cache to the decode instance:
1. Prefill computes KV cache
2. Cache stored in distributed memory (Redis, etc.)
3. Decode instances pull cache as needed

Benefits: scale prefill and decode independently, handle bursty traffic better.

Cost: network latency for cache transfer, engineering complexity.

## Practical Implications

**For latency-sensitive applications:**
- Optimize TTFT (prefill) first—it's what users wait for
- Use tensor parallelism to parallelize prefill across GPUs
- Consider chunked prefill if decode latency matters too

**For throughput-sensitive applications:**
- Optimize decode throughput via batching
- Quantize to fit more concurrent sequences
- Use continuous batching to avoid head-of-line blocking

**For long-context applications:**
- KV cache is your bottleneck
- Use GQA/MLA models (Llama 3, DeepSeek V3)
- Consider KV cache offloading or compression

## The Fundamental Insight

LLM inference isn't one problem—it's two problems with opposite characteristics:

| Phase | Bottleneck | Optimization Approach |
|-------|------------|----------------------|
| Prefill | Compute | Parallelism, chunking |
| Decode | Memory | Batching, quantization |

Systems that treat inference as a single problem leave performance on the table. The best inference stacks handle prefill and decode differently, optimizing each for its actual bottleneck.

---

*For deep dives on specific optimizations, see the vLLM paper (continuous batching, paged attention) and the Flash Attention papers (memory-efficient attention). Sebastian Raschka's [The Big LLM Architecture Comparison](https://magazine.sebastianraschka.com/p/the-big-llm-architecture-comparison) covers KV cache designs across models.*
