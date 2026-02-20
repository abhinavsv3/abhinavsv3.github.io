---
layout: '../../layouts/PostLayout.astro'
title: 'MHA vs GQA vs MLA: A Visual Guide to Attention Mechanisms'
description: "Multi-Head, Grouped-Query, and Multi-Head Latent Attention explained with memory calculations you can verify yourself."
pubDate: '2025-09-15'
tags: ['machine learning', 'transformers', 'architecture']
---

Every transformer uses attention, but the way models store and compute key-value pairs has evolved significantly. This post breaks down the three main approaches: MHA, GQA, and MLA—with actual memory calculations so you can reason about the tradeoffs yourself.

## The Memory Problem

Attention computes `softmax(QK^T/√d) × V`. During autoregressive generation, we cache the K and V tensors to avoid recomputation. This is called the KV cache.

For a model with:
- `L` layers
- `H` attention heads
- `d` head dimension
- `n` sequence length

The KV cache size per token is:

```
KV cache = 2 × L × H × d × bytes_per_element
```

Let's make this concrete with Llama 2 70B numbers:
- 80 layers, 64 heads, 128 head dimension, fp16 (2 bytes)
- KV cache per token: `2 × 80 × 64 × 128 × 2 = 2.6 MB`
- At 8K context: **20.5 GB just for KV cache**

This is why attention mechanism design matters—at long contexts, KV cache dominates memory.

## Multi-Head Attention (MHA)

The original transformer attention. Each head has independent Q, K, V projections.

```
Q = W_q × X    # [n, d_model] → [n, H, d_head]
K = W_k × X    # [n, d_model] → [n, H, d_head]
V = W_v × X    # [n, d_model] → [n, H, d_head]
```

**Memory**: Each head stores its own K and V. Full expressiveness, full cost.

**Used by**: GPT-2, GPT-3, BERT, original Llama

## Grouped-Query Attention (GQA)

The key insight: maybe we don't need independent KV for every query head.

GQA groups query heads to share KV pairs. If you have 64 query heads and 8 KV heads, each KV head serves 8 query heads.

```
Q = W_q × X    # [n, d_model] → [n, 64, d_head]  (64 heads)
K = W_k × X    # [n, d_model] → [n, 8, d_head]   (8 heads, shared)
V = W_v × X    # [n, d_model] → [n, 8, d_head]   (8 heads, shared)
```

**Memory reduction**: 8x in the example above

Llama 2 70B with GQA (8 KV heads instead of 64):
- KV cache per token: `2 × 80 × 8 × 128 × 2 = 328 KB`
- At 8K context: **2.6 GB** (down from 20.5 GB)

**The tradeoff**: Shared KV means heads can't attend to completely independent information. The original GQA paper reports minimal quality loss with 8 KV heads, but the impact depends on your task.

**Used by**: Llama 2, Llama 3, Mistral, Gemma

## Multi-Head Latent Attention (MLA)

DeepSeek's innovation: compress KV into a smaller latent space before caching.

```
# Compression
C_kv = W_down × [K; V]  # Compress to lower dimension

# Cache C_kv instead of K, V

# Decompression at inference
K, V = W_up × C_kv      # Decompress back
```

**Memory reduction**: Depends on latent dimension. DeepSeek V3 achieves ~20x reduction.

**The tradeoff**:
- Compression/decompression adds compute
- Need to learn good compression during training
- More complex implementation

**Used by**: DeepSeek V2, DeepSeek V3, Kimi K2

## Quick Comparison

| Mechanism | KV Heads (70B example) | KV Cache @ 8K | Quality Impact |
|-----------|------------------------|---------------|----------------|
| MHA | 64 | 20.5 GB | Baseline |
| GQA (8 heads) | 8 | 2.6 GB | Minimal on most tasks |
| GQA (4 heads) | 4 | 1.3 GB | Measurable on retrieval |
| MLA | N/A (latent) | ~1 GB | Comparable to MHA |

## When to Use What

**MHA**: When you need maximum expressiveness and memory isn't constrained. Fine-tuning scenarios where you want full attention capacity.

**GQA**: The practical default for most deployments. 8 KV heads is a common sweet spot—significant memory savings with minimal quality impact.

**MLA**: When you're training from scratch at scale and can invest in the architecture complexity. Currently mostly used by DeepSeek and derivatives.

## The Deeper Question

These mechanisms represent different points on the memory-quality tradeoff curve. GQA asks "do all heads need independent KV?" MLA asks "can we learn a compressed representation?"

The trend is toward more aggressive compression as context lengths grow. At 128K+ tokens, even GQA's savings aren't enough—which is why MLA and other approaches are gaining attention.

---

*For the full architectural comparison across modern LLMs, see Sebastian Raschka's excellent [The Big LLM Architecture Comparison](https://magazine.sebastianraschka.com/p/the-big-llm-architecture-comparison).*
