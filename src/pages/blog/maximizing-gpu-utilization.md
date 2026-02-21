---
layout: '../../layouts/PostLayout.astro'
title: 'Why Your GPU Utilization Is Lower Than You Think'
description: "A batch size of 1 on an A100 typically achieves 10-20% utilization. Understanding why—and how to fix it—is key to cost-effective inference."
pubDate: '2025-12-08'
tags: ['machine learning', 'infrastructure', 'optimization']
---

GPUs are expensive. An A100 80GB costs $2-4/hour in the cloud. If you're running inference at 20% utilization, you're paying 5x more per token than you need to. Most teams significantly underutilize their hardware—not because they're doing something wrong, but because LLM inference has fundamentally different bottlenecks than training.

## Why Utilization Is Low

### The Memory Bandwidth Problem

Training is compute-bound: matrix multiplications dominate, and GPUs are built for this.

Inference is memory-bound: for each generated token, you load the entire model weights but only do a single forward pass.

**The math:**
- A100 compute: 312 TFLOPS (fp16)
- A100 memory bandwidth: 2 TB/s
- 70B model weights: ~140GB (fp16)

To fully utilize compute, you'd need ~156 bytes of compute per byte of memory transfer. LLM inference does closer to 2-4 bytes of compute per byte transferred. You're waiting on memory, not math.

### Batch Size 1 Is The Killer

With batch size 1:
- Load 140GB of weights
- Process 1 token
- Repeat

With batch size 8:
- Load 140GB of weights
- Process 8 tokens
- Repeat (same memory load, 8x the useful work)

**This is why batching matters so much for inference.** The weight loading cost is amortized across more tokens.

| Batch Size | Relative Throughput | Utilization (typical) |
|------------|--------------------|-----------------------|
| 1 | 1.0x | 10-20% |
| 4 | 3.5x | 45-55% |
| 8 | 5.5x | 65-75% |
| 16 | 7x | 75-85% |

The gains taper as you approach compute-bound territory—but most inference workloads never get there.

## The Batching Challenge

"Just use bigger batches" sounds simple. It isn't.

### Latency vs Throughput

Batching requires waiting for requests to accumulate. If your SLA is "respond within 500ms," you can't wait 2 seconds to fill a batch.

The tradeoff:
- Larger batches → higher throughput, higher latency
- Smaller batches → lower throughput, lower latency

### Variable Sequence Lengths

In a batch of 8 requests:
- Request 1: 50 tokens
- Request 8: 800 tokens

With naive batching, all requests wait for Request 8 to finish. The short requests have terrible latency.

**Continuous batching** solves this: as short requests complete, new requests join the batch. No waiting for the longest sequence.

| Batching Strategy | Throughput | Latency (short requests) |
|-------------------|------------|-------------------------|
| Static | Baseline | Poor (waits for longest) |
| Continuous | +30-50% | Good (exits when done) |

### Memory Pressure From KV Cache

Each request in the batch needs its own KV cache:
- 70B model, 4K context, fp16: ~10GB per request
- Batch of 8: 80GB just for KV cache
- Plus ~140GB for weights
- You've exceeded A100 80GB

This is why long-context inference often can't batch at all. The KV cache—not weights—becomes the limiting factor.

## Mixing Workloads: The Underused Strategy

Most inference deployments have multiple traffic types:
- **Online**: Real-time API requests with latency SLAs
- **Offline**: Batch processing (embeddings, bulk inference, evaluation)

These are often served separately, each underutilized.

**The insight:** Use offline work to fill batch slots that online traffic leaves empty.

```
Instead of:
  Online cluster: 8 GPUs, 20% utilization, waiting for requests
  Offline cluster: 4 GPUs, 30% utilization, running slowly

Do:
  Unified cluster: 8 GPUs
  - Online requests get priority
  - Offline work fills unused batch slots
  - Target: 70-80% utilization
```

### The Backfill Pattern

1. Set a short batch collection window (10-20ms)
2. Fill batch slots with online requests first
3. If slots remain, add offline work
4. Process batch
5. Route responses to appropriate callers

Online latency increases slightly (the collection window), but you're not burning GPUs on idle cycles.

### Fairness Considerations

Without guardrails, online traffic can starve offline work during peaks. Reserve a small fraction of capacity (e.g., 10% of batch slots) for offline regardless of online load. Predictable batch completion is often worth slight online latency increase.

## Other Utilization Tactics

### Speculative Decoding

Use a small "draft" model to generate candidate tokens, verify with the large model in parallel.

- Draft model: 7B, fast but less accurate
- Target model: 70B, slow but accurate
- Draft generates 4 tokens speculatively
- Target verifies all 4 in one forward pass (same cost as 1 token)
- Accept correct prefix, reject wrong suffix

2-3x speedup is common. The key: verification is parallel (cheap), drafting is serial (the bottleneck).

### Quantization

FP16 → INT8: 2x memory reduction, ~1.1x speedup, minimal quality loss
FP16 → INT4: 4x memory reduction, ~1.3x speedup, measurable quality loss on some tasks

Quantization reduces memory traffic (the bottleneck), enabling larger batches.

### KV Cache Optimization

- **Paged attention** (vLLM): Manage KV cache like virtual memory, reducing fragmentation
- **KV cache quantization**: Store cache in INT8, decompress for compute
- **Prefix caching**: Share KV cache across requests with common prefixes (system prompts)

### Right-Sizing

Don't use a 70B model for every request. Route based on complexity:
- Simple queries → 7B model
- Complex queries → 70B model

The 7B model can run at batch size 32+ where the 70B struggles with batch size 4.

## Measuring Utilization

Don't trust `nvidia-smi` utilization alone. It shows "GPU is doing something," not "GPU is doing useful work."

Better metrics:
- **SM (streaming multiprocessor) utilization**: What % of compute units are active
- **Tokens per second per GPU**: Direct measure of useful throughput
- **Cost per 1M tokens**: The metric that actually matters

Profile with `nsys` or similar tools to find the real bottlenecks. Memory-bound vs compute-bound has different solutions.

## The Practical Playbook

1. **Measure current utilization** (likely lower than you think)
2. **Enable continuous batching** (vLLM, TensorRT-LLM, or equivalent)
3. **Quantize if memory-constrained** (INT8 is usually safe)
4. **Mix online/offline workloads** if you have both
5. **Consider speculative decoding** for latency-sensitive use cases
6. **Right-size model selection** based on request complexity

The goal isn't 100% utilization—that would mean requests are always waiting. But if you're below 50%, there's likely low-hanging fruit.

## The Economics

| Utilization | Effective Cost per Token |
|-------------|-------------------------|
| 20% | 5.0x baseline |
| 40% | 2.5x baseline |
| 60% | 1.67x baseline |
| 80% | 1.25x baseline |

Going from 20% to 60% utilization reduces your inference costs by 3x without changing hardware. At scale, this is millions of dollars.

The GPU efficiency problem is an engineering problem, not a hardware problem. The techniques are known. The question is whether you've implemented them.

---

## References

- **[Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180)** — The vLLM paper introducing PagedAttention for KV cache management (Kwon et al., SOSP 2023)
- **[Orca: A Distributed Serving System for Transformer-Based Generative Models](https://www.usenix.org/conference/osdi22/presentation/yu)** — The original paper introducing continuous batching / iteration-level scheduling (Yu et al., OSDI 2022)
- **[Accelerating LLM Decoding with Speculative Sampling](https://arxiv.org/abs/2302.01318)** — DeepMind's speculative decoding paper achieving 2-2.5x speedup on Chinchilla 70B (Chen et al., 2023)
- **[Mastering LLM Techniques: Inference Optimization](https://developer.nvidia.com/blog/mastering-llm-techniques-inference-optimization/)** — NVIDIA's comprehensive guide covering KV caching, parallelism, and FlashAttention
- **[How Continuous Batching Enables 23x Throughput in LLM Inference](https://www.anyscale.com/blog/continuous-batching-llm-inference)** — Anyscale's deep dive on continuous batching with benchmarks
- **[High-Performance LLM Inference Guide](https://modal.com/docs/guide/high-performance-llm-inference)** — Modal's practical guide to inference optimization, including engine recommendations
