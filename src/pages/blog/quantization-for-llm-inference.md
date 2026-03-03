---
layout: '../../layouts/PostLayout.astro'
title: 'Quantization for LLM Inference: From FP16 to INT4'
description: "Quantization cuts memory and speeds up inference. But naive 8-bit quantization breaks at 6.7B+ parameters. Here's why, and how modern methods fix it."
pubDate: '2026-02-27'
tags: ['machine learning', 'inference', 'optimization']
---

A 70B parameter model in FP16 needs 140GB just for weights. Quantize to INT8 and that drops to 70GB. INT4 brings it to 35GB. The difference between needing 4 GPUs and needing 1 GPU. But naive quantization destroys model quality at scale. Models above 6.7B parameters exhibit emergent outlier features that break simple approaches. Modern quantization methods work around this.

*This post assumes you understand what model weights are and roughly how LLM inference works. If you're new to inference optimization, start with [Scaling Foundation Model Inference](/blog/scaling-foundation-model-inference/) for context.*

## The Quick Reference

If you just want to know what to use:

| Scenario | Method | Why |
|----------|--------|-----|
| H100 GPUs, production | FP8 | Native hardware support, best speed |
| Quality-critical, any GPU | LLM.int8() | Handles outliers gracefully |
| High throughput batch inference | SmoothQuant | Fast INT8 without runtime overhead |
| Memory-constrained (fit on fewer GPUs) | AWQ 4-bit | Best quality at 4-bit |

Read on for why these recommendations exist.

## Why Quantization Matters

Memory dominates LLM inference cost. As covered in [Maximizing GPU Utilization](/blog/maximizing-gpu-utilization/), decode is memory-bound: you load the entire model for each token generated. Smaller weights mean less data to move from GPU memory (HBM) to compute units.

The math is straightforward:

| Precision | Bytes per Param | 70B Model Size | A100 80GB GPUs Needed |
|-----------|-----------------|----------------|----------------------|
| FP32 | 4 | 280GB | 4 |
| FP16/BF16 | 2 | 140GB | 2 |
| INT8 | 1 | 70GB | 1 |
| INT4 | 0.5 | 35GB | 1 |

The question is: how low can you go before quality suffers?

## The Outlier Problem

Think of quantization like compressing an image. If all pixels have similar brightness, compression works well. But if one pixel is 100x brighter than the rest, you have a problem: either that pixel clips, or everything else gets squashed into near-black.

The same thing happens with LLM weights and activations.

Naive quantization maps values to a fixed range. For INT8, that's -128 to 127:

```
quantized = round(value / scale)
scale = max(abs(values)) / 127
```

Tim Dettmers discovered that transformers above 6.7B parameters develop **emergent outlier features**: specific hidden dimensions with values 100x larger than typical values. In a dimension where most values are around 0.1, outliers reach -60 or higher.

When you quantize with outliers present:
- Scale is set by the outlier (60/127 ≈ 0.47)
- Normal values (0.1) quantize to round(0.1/0.47) = 0
- Information is destroyed

It's like setting your camera exposure for the sun and expecting to capture detail in the shadows.

**Why does this happen?** The outliers correlate with model capability. Better models (lower perplexity, meaning better predictions) have more pronounced outliers. They seem to be how large models encode important information. You can't train them away without hurting quality.

**The phase transition**: Below 6.7B parameters, layers disagree on which dimensions are outliers. Above 6.7B, all layers coordinate on the same outlier dimensions. This is why quantization methods that work fine on 7B models can fail completely on 70B models.

## Two Approaches: PTQ vs QAT

**Post-Training Quantization (PTQ)**: Quantize after training. Run some calibration data through the model, figure out value ranges, and convert weights. Cheap and fast.

**Quantization-Aware Training (QAT)**: Simulate quantization during training so the model learns to be robust to it. Better quality but requires a full training run.

For LLM inference, PTQ dominates because training 70B+ models is expensive. All methods below are PTQ approaches.

## LLM.int8(): Handle Outliers Separately

The key insight: outliers are rare. Only about 6 dimensions out of thousands contain them. What if we just... handle those separately?

LLM.int8() splits the computation:
1. Identify outlier dimensions (values above a threshold)
2. Compute outliers in full precision (FP16)
3. Compute everything else in INT8
4. Combine results

The INT8 path handles 99.9% of computation. The FP16 path handles the problematic 0.1%.

**Result**: Quality matches full FP16, with most computation in INT8.

**Tradeoff**: The split adds overhead. You're running two separate matrix multiplications and combining them. Not as fast as pure INT8 would be.

## SmoothQuant: Make Activations Behave

Here's an observation: weights don't have outliers. Activations do. What if we could transfer the problem?

Mathematically, you can multiply activations by a factor and divide weights by the same factor without changing the result:

```
Y = X @ W = (X / s) @ (W * s)
```

SmoothQuant chooses `s` per-channel to "smooth" the activations. Channels with large outliers get divided down; their corresponding weight columns get multiplied up to compensate.

After smoothing, both weights and activations have similar ranges and quantize cleanly.

**Result**: True INT8 computation for both weights and activations (called W8A8 in the literature). No runtime splitting like LLM.int8().

**Tradeoff**: Requires calibration data to find the right smoothing factors. The factors are baked into the weights, so it's a one-time cost.

## GPTQ: Push Weights to 4-bit

What if 8-bit isn't aggressive enough? GPTQ pushes weights to 4-bit (or even 3-bit) using a clever error-correction scheme.

The insight: when you quantize one weight and introduce error, you can adjust nearby weights to compensate. It's like rounding one number down and another up to keep the sum correct.

GPTQ quantizes weights one column at a time:
1. Quantize a column to 4-bit
2. Measure the error introduced
3. Adjust remaining columns to compensate
4. Repeat

**Result**: 4-bit weights with quality surprisingly close to FP16. Works well for 70B+ models.

**Tradeoff**: Only quantizes weights, not activations. You save memory but don't get the full speedup of quantizing everything. Also, quantization takes a few hours (one-time cost).

## AWQ: Not All Weights Are Equal

AWQ asks: which weights matter most? If you're forced to quantize aggressively, put your precision budget where it counts.

Here's a concrete example. Imagine a weight matrix where:
- Column A connects to activations that are usually near zero
- Column B connects to activations that frequently spike to large values

Errors in Column A barely affect output (small activation × error ≈ small impact). Errors in Column B get amplified (large activation × error ≈ large impact).

AWQ protects the important weights:
1. Run calibration data through the model
2. Track which weight columns see large activations
3. Scale those columns up before quantization (preserving precision)
4. Scale them back down at runtime

**Result**: Better quality than GPTQ at the same bit-width, especially at 4-bit. Also faster to quantize.

**Tradeoff**: Like GPTQ, weight-only. Activations stay in FP16.

## FP8: The Hardware Solution

NVIDIA's H100 (and newer) GPUs have native FP8 support. Instead of integer quantization, you use 8-bit floating point.

Why FP8 over INT8?
- Floating point naturally handles wide value ranges (no outlier problem)
- Native tensor core support (as fast as INT8)
- Simpler calibration (no complex smoothing or error correction)

Two FP8 formats exist:
- **E4M3**: 4 exponent bits, 3 mantissa bits (more precision, less range)
- **E5M2**: 5 exponent bits, 2 mantissa bits (more range, less precision)

Typical setup: E4M3 for weights (need precision), E5M2 for activations (need range for outliers).

**Tradeoff**: Requires H100 or newer. Older GPUs don't have FP8 tensor cores.

## Quality vs Compression

General patterns from benchmarks:

| Compression | Typical Quality Impact |
|-------------|------------------------|
| FP16 → INT8 | <1% loss with proper methods |
| FP16 → INT4 | 1-5% loss, task-dependent |
| FP16 → INT3 | Noticeable degradation |

Quality loss varies by task:
- **Factual recall**: Sensitive to quantization (exact knowledge gets corrupted)
- **Creative writing**: Tolerant (many valid outputs anyway)
- **Math/reasoning**: Varies (depends on whether key reasoning weights are preserved)

Always benchmark on your actual use case.

## Combining with Other Optimizations

Quantization stacks with other inference techniques:

- [Flash Attention](/blog/flash-attention-in-practice/): Reduces memory traffic for attention (orthogonal to weight quantization)
- [Tensor Parallelism](/blog/tensor-parallelism-fundamentals/): Split quantized model across GPUs
- [Speculative Decoding](/blog/speculative-decoding-explained/): Works with quantized models (draft model can be quantized more aggressively)
- Continuous batching: Quantized models fit larger batches in same memory

A production stack might combine: AWQ 4-bit weights + Flash Attention + continuous batching.

## Implementation

**HuggingFace (LLM.int8()):**
```python
from transformers import AutoModelForCausalLM

model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-70b-hf",
    load_in_8bit=True,
    device_map="auto"
)
```

**HuggingFace (4-bit):**
```python
model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-70b-hf",
    load_in_4bit=True,
    device_map="auto"
)
```

**vLLM (AWQ):**
```bash
python -m vllm.entrypoints.openai.api_server \
    --model TheBloke/Llama-2-70B-AWQ \
    --quantization awq
```

---

## References

**Learning path:**
- Beginner: Lilian Weng's [Inference Optimization](https://lilianweng.github.io/posts/2023-01-10-inference-optimization/) - understand the landscape
- Intermediate: Tim Dettmers' [LLM.int8() post](https://timdettmers.com/2022/08/17/llm-int8-and-emergent-features/) - deep insight into outlier behavior
- Advanced: MIT Han Lab papers - implement or improve methods

**Papers:**
1. Dettmers et al., "LLM.int8(): 8-bit Matrix Multiplication for Transformers at Scale" (2022) - https://arxiv.org/abs/2208.07339
2. Xiao et al., "SmoothQuant: Accurate and Efficient Post-Training Quantization for Large Language Models" (2023) - https://arxiv.org/abs/2211.10438
3. Frantar et al., "GPTQ: Accurate Post-Training Quantization for Generative Pre-trained Transformers" (2023) - https://arxiv.org/abs/2210.17323
4. Lin et al., "AWQ: Activation-aware Weight Quantization for LLM Compression and Acceleration" (2023) - https://arxiv.org/abs/2306.00978
