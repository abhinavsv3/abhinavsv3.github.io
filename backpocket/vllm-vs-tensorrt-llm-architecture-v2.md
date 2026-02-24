---
layout: '../../layouts/PostLayout.astro'
title: 'vLLM vs TensorRT-LLM: What I Learned Running Both in Production'
description: "After deploying both frameworks at scale, here's the real tradeoff: it's not throughput, it's engineering hours."
pubDate: '2025-12-22'
tags: ['machine learning', 'infrastructure', 'optimization']
---

In my experience deploying LLMs at scale, I've run both vLLM and TensorRT-LLM in production. The throughput benchmarks you see online are real. TensorRT-LLM is faster. But that's not the whole story.

The real question isn't "which is faster?" It's "which is worth your team's time?"

Here's my honest take after living with both.

## Which Do I Reach For First?

**vLLM, in nearly all scenarios.** For both production and research workloads, vLLM is where I start. New model architectures can be supported in hours or days. With TensorRT-LLM, properly optimizing for new or unconventional architectures can take weeks.

The exception: when I'm squeezing maximum throughput from flagship NVIDIA hardware (H100, A100) and the model is stable. Then TensorRT-LLM earns its keep.

## The Core Architectural Difference

**vLLM: Runtime flexibility.** Models load as-is, optimizations happen dynamically. The key innovation is PagedAttention, which treats KV cache like virtual memory.

**TensorRT-LLM: Compile-time optimization.** Models are compiled into optimized TensorRT engines with fused kernels and hardware-specific code generation. Peak performance, but upfront cost.

This shapes everything: startup time, throughput ceiling, flexibility, and how much of your life you spend debugging.

## Memory Management

Memory management for KV cache is the defining challenge of LLM serving. Context lengths are variable, requests arrive unpredictably, and the cache dominates GPU memory.

### PagedAttention (vLLM)

vLLM's key insight: treat KV cache like operating system virtual memory.

```
Traditional approach:
  Request A: [############--------]  (12 tokens, 8 wasted)
  Request B: [################----]  (16 tokens, 4 wasted)
  Request C: [####----]              (4 tokens, 4 wasted)
  → 16 slots wasted to fragmentation

PagedAttention:
  Physical blocks: [AAAA][AAAA][AAAA][BBBB][BBBB][BBBB][BBBB][CCCC]
  → Near-zero waste, non-contiguous allocation
```

Each "page" is a fixed-size block (typically 16 tokens). Requests allocate pages as needed, release them immediately on completion.

Results:
- 4x more requests in same memory vs naive allocation
- Enables prefix caching (shared pages across requests with common prefixes)
- Copy-on-write for beam search and parallel sampling

### TensorRT-LLM KV Cache

TensorRT-LLM adopted paged KV cache concepts. The implementation differs (integrated with the compiled graph rather than managed by a Python runtime), but the core idea is now shared.

The difference: TensorRT-LLM's memory management is more static. Pool sizes and maximum sequence lengths are often set at compile time, trading flexibility for predictability.

## Batching Strategies

Both frameworks implement continuous batching. The concept:

1. Don't wait for all requests to finish
2. After each decode step, check: any requests done?
3. If yes, evict them and admit new requests
4. Process next token for remaining requests

This eliminates head-of-line blocking from variable sequence lengths.

### Scheduling Differences

**vLLM's scheduler** runs in Python, making decisions every iteration. This is the "Python tax" I've experienced: preemption support, dynamic priority adjustment, flexible admission policies, but with per-iteration overhead.

**TensorRT-LLM's in-flight batching** is tighter: C++ scheduler, batching decisions partly compiled, lower flexibility but lower latency.

### Prefill vs Decode

LLM inference has two distinct phases:
- **Prefill**: Process the entire prompt (compute-bound, parallelizable)
- **Decode**: Generate tokens one-by-one (memory-bound, sequential)

vLLM handles these uniformly: prefill is just the first iteration with more tokens. TensorRT-LLM can compile separate optimized kernels for each phase.

| Phase | vLLM | TensorRT-LLM |
|-------|------|--------------|
| Prefill | Dynamic chunking | Optimized prefill kernel |
| Decode | Standard attention | Fused decode kernel |
| Mixing | Unified scheduling | Separate optimization |

## The Compilation Tradeoff

Here's where the philosophies diverge most sharply.

### vLLM: Interpretation

```python
# vLLM model loading (simplified)
model = AutoModelForCausalLM.from_pretrained("llama-70b")
engine = LLMEngine(model)
# Ready to serve in ~2 minutes (model loading)
```

vLLM loads HuggingFace models directly. Optimizations happen at runtime:
- FlashAttention kernels selected dynamically
- Batch sizes adjusted on-the-fly
- No compilation step

### TensorRT-LLM: Compilation

```bash
# TensorRT-LLM model preparation (simplified)
# Step 1: Convert model (offline, ~30-60 minutes)
trtllm-build --model_dir llama-70b --output_dir engine_dir \
    --max_batch_size 32 --max_input_len 2048 --max_output_len 512

# Step 2: Load compiled engine (~1 minute)
engine = tensorrt_llm.runtime.ModelRunner.from_dir("engine_dir")
```

The compilation step fuses operations, generates hardware-specific CUDA kernels, optimizes memory layout, and prunes unused code paths.

**My experience: TensorRT-LLM compilation is tedious.** The 30-60 minutes isn't the problem. It's the iteration cycle. Change a parameter? Recompile. Different GPU type? Recompile. Different max sequence length? Recompile. This adds up fast.

### The Usability Gap Is Closing (Slowly)

NVIDIA has made strides in reducing TensorRT-LLM's cold-start pain:

**NGC Pre-built Assets:** Pre-compiled engines for popular models on common GPU types. Download and run.

**AutoDeploy (Beta):** Takes HuggingFace models and automatically compiles them without manual API rewrites. Supports 100+ text-to-text LLMs.

```bash
# AutoDeploy example
python build_and_run_ad.py --model "meta-llama/Llama-3-8B"
```

I haven't tried AutoDeploy in production yet. The promise is there, but I'd want to see it handle edge cases before trusting it at scale.

### The Numbers

| Aspect | vLLM | TensorRT-LLM |
|--------|------|--------------|
| Cold start | 2-5 min | 30-60 min (first time) |
| Warm start | 2-5 min | 1-2 min (engine cached) |
| Peak throughput (A100) | ~3000 tok/s | ~4000 tok/s |
| Memory efficiency | Excellent | Very good |
| New model support | Hours-days | Days-weeks |

**Does the ~30% throughput gap hold up?** In my experience, yes. TensorRT-LLM maintains its throughput advantage on flagship NVIDIA hardware (H100/A100). The gap is real.

But throughput isn't the only cost.

## The Gotchas Nobody Tells You

### vLLM

**Encoder-decoder models are second-class citizens.** If you're running T5, BART, or similar architectures, vLLM's support is limited. This surprised me. The focus is heavily on decoder-only models (GPT, Llama, etc.).

**The Python tax is real.** For latency-sensitive applications, the per-iteration Python overhead adds up. It's not a dealbreaker, but it's measurable.

### TensorRT-LLM

**Triton Server complexity.** The recommended deployment path is through NVIDIA Triton Inference Server. This adds another layer of configuration, debugging, and operational overhead. It's powerful, but it's not simple.

**Engine compilation is brittle.** Change your max_batch_size? Recompile. Different sequence length requirements? Recompile. New GPU SKU in your cluster? Recompile. The iteration cycle is painful.

## Flexibility vs Performance

### Adding New Models

**vLLM**: If it runs in HuggingFace Transformers, it likely works. New architectures in hours or days.

**TensorRT-LLM**: New architectures require implementing the model in TensorRT-LLM's API, then compilation. NVIDIA provides implementations for popular models. Custom architectures? Budget weeks.

### Quantization

**vLLM** is the king of community formats. GGUF, AWQ, GPTQ, FP8 from HuggingFace, vLLM runs it. No conversion, no recompilation.

**TensorRT-LLM** is the king of FP8 on Hopper/Blackwell. On H100 or B200, TRT-LLM's FP8 is the gold standard for throughput without accuracy loss. But quantization is part of compilation, so changing schemes means rebuilding.

### Hardware Lock-In

**vLLM** is increasingly hardware-agnostic: AMD ROCm, AWS Inferentia, Intel Gaudi. If your cloud strategy involves switching providers, vLLM is the safer bet.

**TensorRT-LLM** is strictly NVIDIA-only. You're trading portability for peak efficiency.

## The Real Cost: Engineering Hours

Here's what I wish someone had told me before I started:

**The "Usability Gap" is the real cost, not the hardware.**

Teams often underestimate the engineering man-hours required to maintain a TensorRT-LLM pipeline. Unless you're operating at massive scale where a 30% throughput gain translates to millions of dollars in saved GPU compute, the "developer experience tax" of TRT-LLM is hard to justify.

Engine compilation, Triton server complexity, recompilation cycles, debugging opaque CUDA errors. It adds up.

With vLLM, the surprise was different: encoder-decoder model support gaps and Python overhead. But these are manageable. The operational simplicity buys you time to focus on actual product work.

## When to Use Which

### Choose vLLM when:
- Rapid iteration matters (research, prototyping)
- Model architectures change frequently
- Hardware portability is required
- Operational simplicity is priority
- You're running decoder-only models

### Choose TensorRT-LLM when:
- Maximum throughput on NVIDIA GPUs is critical
- Models are stable (recompilation is rare)
- You have engineering bandwidth for the complexity
- The 30% throughput gain saves real money at your scale
- You're already invested in NVIDIA's ecosystem (Triton)

### Quick Reference

| If you care about... | Winner | Why |
|---------------------|--------|-----|
| Developer velocity | vLLM | Zero compilation; standard Python debugging |
| Cloud portability | vLLM | Runs on NVIDIA, AMD, Intel, AWS chips |
| Extreme throughput | TensorRT-LLM | 30% advantage on H100/A100 |
| Enterprise support | TensorRT-LLM | Part of NVIDIA AI Enterprise stack |
| Encoder-decoder models | TensorRT-LLM | vLLM support is limited |

## The Convergence

The two frameworks are learning from each other:
- TensorRT-LLM adopted paged KV cache concepts
- vLLM is adding more optimized kernels
- Both now support speculative decoding
- Both support prefix caching

The philosophical difference (runtime flexibility vs compile-time optimization) remains. But the feature gap is narrowing.

## My Bottom Line

For most teams, start with vLLM. Lower complexity, faster iteration, good-enough performance. You can always migrate later if throughput becomes the bottleneck.

Only reach for TensorRT-LLM when you've validated that:
1. The 30% throughput gain translates to meaningful cost savings at your scale
2. Your models are stable enough that recompilation won't kill your velocity
3. You have the engineering bandwidth to absorb the operational complexity

The choice isn't permanent. Many production deployments prototype with vLLM and graduate to TensorRT-LLM for high-traffic endpoints. The models are the same; only the serving layer changes.

---

## References

1. Kwon et al., "Efficient Memory Management for Large Language Model Serving with PagedAttention" (SOSP 2023) - https://arxiv.org/abs/2309.06180
2. vLLM Documentation - https://docs.vllm.ai/
3. TensorRT-LLM Documentation - https://nvidia.github.io/TensorRT-LLM/
4. NVIDIA, "Automating Inference Optimizations with TensorRT LLM AutoDeploy" - https://developer.nvidia.com/blog/automating-inference-optimizations-with-nvidia-tensorrt-llm-autodeploy
5. Yu et al., "Orca: A Distributed Serving System for Transformer-Based Generative Models" (OSDI 2022) - https://www.usenix.org/conference/osdi22/presentation/yu
