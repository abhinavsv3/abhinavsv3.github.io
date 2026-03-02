---
layout: '../../layouts/PostLayout.astro'
title: 'Speculative Decoding: Draft Once, Verify in Parallel'
description: "LLM decoding is sequential and memory-bound. Speculative decoding breaks this by guessing multiple tokens and verifying in parallel. Here's how it works and when to use it."
pubDate: '2026-02-27'
tags: ['machine learning', 'inference', 'optimization']
---

LLM inference has a fundamental problem: decoding is sequential. Each token depends on all previous tokens, so you generate one at a time. The GPU loads 140GB of weights, produces one token, and repeats. Most of the hardware sits idle waiting on memory. Speculative decoding attacks this by guessing multiple tokens ahead and verifying them in parallel.

## Why Decoding Is Slow

As covered in [Scaling Foundation Model Inference](/blog/scaling-foundation-model-inference/), the decode phase is memory-bound. For each token:

1. Load all model weights from HBM
2. Run one forward pass
3. Sample one token
4. Repeat

The GPU's compute units are mostly idle. You're paying for 312 TFLOPS but using a fraction of it.

The insight: **verification is parallel, generation is sequential**. If you could somehow "guess" the next 5 tokens, you could verify all 5 in a single forward pass (same cost as generating 1). If your guesses are good, you just generated 5 tokens for the price of 1.

## The Core Algorithm

Speculative decoding uses two models:
- **Draft model**: Small, fast, makes guesses
- **Target model**: Large, accurate, verifies guesses

```
1. Draft model generates K candidate tokens: [t1, t2, t3, t4, t5]
2. Target model scores all K tokens in one forward pass
3. Accept tokens left-to-right until one is rejected
4. Resample from target model at rejection point
5. Repeat
```

The key property: **the output distribution is identical to running the target model alone**. Speculative decoding is not an approximation. Rejected tokens are resampled correctly, so you get the exact same output quality.

## Acceptance Rate Math

If the draft model has acceptance rate α (probability each token matches what the target would generate), the expected tokens per iteration is:

```
Expected tokens = (1 - α^(K+1)) / (1 - α)
```

For K=5 draft tokens:
- α = 0.5 (50% acceptance): ~1.98 tokens per iteration
- α = 0.7 (70% acceptance): ~3.25 tokens per iteration
- α = 0.9 (90% acceptance): ~5.22 tokens per iteration

The speedup depends heavily on how well the draft model predicts the target. This varies by task.

## When Speculative Decoding Helps

**High acceptance rate tasks:**
- Code completion (syntax is predictable)
- Template-based generation (structured outputs)
- Continuation of existing text (style is established)
- Translation (strong alignment between source and target)

**Low acceptance rate tasks:**
- Creative writing (many valid continuations)
- Open-ended questions (target model's preferences matter more)
- Highly specific domain knowledge (draft model lacks context)

In practice, code completion sees 70-90% acceptance rates. Open-ended chat sees 40-60%.

## Draft Model Selection

The draft model needs to be:
1. **Fast**: Small enough that drafting K tokens is cheaper than one target forward pass
2. **Aligned**: Trained on similar data, similar tokenizer
3. **Predictable**: High acceptance rate on your workload

Common approaches:

| Strategy | Example | Tradeoff |
|----------|---------|----------|
| Smaller model from same family | Llama 8B drafts for Llama 70B | Best alignment, requires serving two models |
| Distilled model | Target-specific distillation | High acceptance, training cost |
| Early exit | Use first N layers of target | No extra model, moderate acceptance |
| n-gram / retrieval | Match recent context | Zero model cost, limited accuracy |

## Variants Beyond Draft Models

### Medusa

Adds multiple "heads" to the target model itself. Each head predicts a different future position.

```
Base model output → Head 1 predicts t+1
                  → Head 2 predicts t+2
                  → Head 3 predicts t+3
```

No separate draft model needed. But requires fine-tuning the heads on your target model.

### EAGLE

Similar to Medusa but the draft heads are autoregressive. Each head conditions on previous head outputs, improving coherence.

```
Head 1: predicts t+1
Head 2: predicts t+2 given Head 1's output
Head 3: predicts t+3 given Head 1 and 2's outputs
```

Higher acceptance rates than Medusa, same deployment simplicity.

### Lookahead Decoding

Uses Jacobi iteration instead of a draft model. Runs multiple parallel "guesses" that iteratively refine.

No draft model, no fine-tuning, but lower speedups than well-tuned draft models.

### Staged Speculative Decoding

Chains multiple draft models: tiny → small → medium → target.

```
Tiny model (100M) → drafts 20 tokens
Small model (1B) → verifies/drafts 10 tokens
Target model (70B) → final verification
```

More complex orchestration but can push acceptance rates higher.

## The Batch Size Tradeoff

Here's the catch: speculative decoding helps **latency** but can hurt **throughput**.

With batch size 1:
- Target model is heavily memory-bound
- Speculative decoding is a clear win

With batch size 32:
- Target model is approaching compute-bound (see [Maximizing GPU Utilization](/blog/maximizing-gpu-utilization/))
- Draft model overhead becomes significant
- Speculative decoding may not help or may hurt

**Rule of thumb**: Speculative decoding shines at low batch sizes (interactive use cases). At high batch sizes (batch inference), continuous batching alone may be more effective.

## Production Considerations

### Memory Overhead

You need to fit both models in memory. For a 70B target + 8B draft:
- Target: ~140GB (fp16)
- Draft: ~16GB (fp16)
- Total: ~156GB

On 8×H100 (640GB total), this is fine. On 2×A100 (160GB total), it's tight.

### Serving Complexity

Two models means:
- Two sets of weights to load
- KV cache for both models
- Orchestration logic for draft/verify cycles

vLLM and TensorRT-LLM both support speculative decoding natively, handling this complexity.

### Acceptance Rate Monitoring

In production, track acceptance rates per request type. If rates drop below ~50%, speculative decoding may not be worth the overhead.

## Practical Guidance

| Scenario | Recommendation |
|----------|----------------|
| Interactive chat, single user | Speculative decoding helps |
| Batch inference, high throughput | Skip speculative decoding |
| Code completion | Strong win, high acceptance |
| Creative writing | Test empirically, may not help |
| Memory constrained | May not be feasible |

**If implementing from scratch:**
1. Start with a draft model from the same family
2. Measure acceptance rates on your actual workload
3. Tune K (draft length) based on acceptance rate
4. Monitor latency improvement vs throughput impact

**If using existing frameworks:**
- vLLM: `--speculative-model` flag
- TensorRT-LLM: Speculative decoding support in latest versions

## The Bigger Picture

Speculative decoding is one solution to the decode bottleneck. Others include:
- [Flash Attention](/blog/flash-attention-in-practice/) (reduces memory traffic)
- [Tensor Parallelism](/blog/tensor-parallelism-fundamentals/) (distributes memory load)
- Quantization (reduces weight size)
- Continuous batching (amortizes weight loading)

These are complementary. A production stack might use all of them: quantized weights, tensor parallelism across GPUs, continuous batching for throughput, and speculative decoding for latency-sensitive requests.

---

## References

1. Leviathan et al., "Fast Inference from Transformers via Speculative Decoding" (2023) - https://arxiv.org/abs/2211.17192
2. Chen et al., "Accelerating Large Language Model Decoding with Speculative Sampling" (2023) - https://arxiv.org/abs/2302.01318
3. Cai et al., "Medusa: Simple LLM Inference Acceleration Framework with Multiple Decoding Heads" (2024) - https://arxiv.org/abs/2401.10774
4. Li et al., "EAGLE: Speculative Sampling Requires Rethinking Feature Uncertainty" (2024) - https://arxiv.org/abs/2401.15077
5. Fu et al., "Lookahead Decoding" (2024) - https://lmsys.org/blog/2023-11-21-lookahead-decoding/
6. Lilian Weng, "Large Transformer Model Inference Optimization" (2023) - https://lilianweng.github.io/posts/2023-01-10-inference-optimization/
