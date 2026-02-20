---
layout: '../../layouts/PostLayout.astro'
title: 'Pre-Norm vs Post-Norm: Why Normalization Placement Matters'
description: "GPT-2 popularized Pre-Norm. Now models like OLMo 2 and Gemma 3 are switching back to Post-Norm. What changed?"
pubDate: '2025-07-18'
tags: ['machine learning', 'training', 'architecture']
---

The original Transformer used Post-Norm. GPT-2 switched to Pre-Norm for stability and the field followed for five years. Now the pendulum is swinging back—OLMo 2, Gemma 3, and other recent models use Post-Norm variants. The 2019 consensus that "Pre-Norm is better" turns out to be more nuanced.

## The Normalization Options

### Pre-Norm (GPT-2 style)

```
x = x + Attention(LayerNorm(x))
x = x + FFN(LayerNorm(x))
```

Normalize *before* each sublayer. This was the de facto standard from 2019-2023.

### Post-Norm (Original Transformer)

```
x = LayerNorm(x + Attention(x))
x = LayerNorm(x + FFN(x))
```

Normalize *after* each sublayer. Used in BERT and the original "Attention Is All You Need" paper.

### Pre+Post-Norm (Gemma 3 style)

```
x = x + LayerNorm(Attention(LayerNorm(x)))
x = x + LayerNorm(FFN(LayerNorm(x)))
```

Normalize both before AND after each sublayer. Belt and suspenders.

### QK-Norm (OLMo 2 style)

```
Q = LayerNorm(Q_proj(x))
K = LayerNorm(K_proj(x))
# Then apply RoPE and compute attention
```

Additional normalization specifically on query and key vectors before attention.

## Why Pre-Norm Became Standard

Pre-Norm has cleaner gradient flow. The residual connection creates an identity shortcut, and placing normalization in the residual branch (rather than the main path) preserves gradients better:

**Post-Norm gradient path:**
```
Gradient → LayerNorm → Sublayer → Identity
```

**Pre-Norm gradient path:**
```
Gradient → Identity + (LayerNorm → Sublayer)
```

In Pre-Norm, gradients can flow directly through the identity connection without passing through normalization. This:
- Reduces gradient vanishing in deep networks
- Makes training more stable with standard hyperparameters
- Allows training deeper models (GPT-3's 96 layers would be harder with Post-Norm)

This is why nearly every model from GPT-2 (2019) through Llama 2 (2023) used Pre-Norm.

## Why Post-Norm is Returning

OLMo 2's ablations (published with full details) found Post-Norm achieves lower loss—if you can stabilize it.

The key finding: Post-Norm's instability comes from attention logit explosion. Without normalization after the sublayer, attention scores can grow unboundedly, causing training to diverge.

**The fix: QK-Norm.** By normalizing Q and K before computing attention scores, you bound the logit magnitudes. This gives Post-Norm's quality benefits while maintaining Pre-Norm's stability.

| Approach | Training Stability | Final Model Quality |
|----------|-------------------|---------------------|
| Pre-Norm | Stable | Good |
| Post-Norm | Unstable | Better |
| Post-Norm + QK-Norm | Stable | Better |

The quality difference isn't huge—typically 1-2% on benchmarks—but it's consistent across model scales.

## Gemma 3's Approach: Pre+Post-Norm

Gemma 3 takes a different path: normalize at both positions.

```python
# Pre+Post-Norm (Gemma 3)
x_normed = layernorm_pre(x)
attn_out = attention(x_normed)
x = x + layernorm_post(attn_out)
```

This is more compute-intensive (4 norm operations per layer vs 2), but provides:
- The stability of Pre-Norm (gradient identity shortcut)
- The bounded activations of Post-Norm
- No need for QK-Norm (the post-norm handles activation scaling)

## The RMSNorm Standard

Almost no modern LLM uses LayerNorm anymore. RMSNorm (Root Mean Square normalization) is the standard:

```python
# LayerNorm: center + scale
def layernorm(x):
    return (x - x.mean()) / x.std() * gamma + beta

# RMSNorm: scale only
def rmsnorm(x):
    return x / sqrt(mean(x**2)) * gamma
```

RMSNorm removes the mean subtraction ("centering"). Research found this centering is unnecessary for transformer training—the model learns equivalent representations either way.

RMSNorm is ~20% faster (one less reduction operation) with no quality loss. Every modern LLM (Llama, Mistral, DeepSeek, Qwen) uses it.

## QK-Norm Placement: Before or After RoPE?

A subtle but critical detail: QK-Norm must be applied *before* RoPE (Rotary Position Embedding).

```python
# Correct: normalize, then apply position encoding
Q = RoPE(LayerNorm(Q_proj(x)))
K = RoPE(LayerNorm(K_proj(x)))

# Wrong: position encoding, then normalize
Q = LayerNorm(RoPE(Q_proj(x)))  # Breaks positional information
K = LayerNorm(RoPE(K_proj(x)))
```

RoPE encodes position by rotating Q and K vectors. Normalizing after RoPE disrupts these rotations and can destroy positional information. The OLMo 2 paper explicitly notes this.

## Which Architecture to Use

| Scenario | Recommendation |
|----------|----------------|
| New model, optimizing for quality | Post-Norm + QK-Norm (OLMo 2 style) |
| New model, prioritizing simplicity | Pre-Norm (still reliable) |
| Maximum stability, less tuning | Pre+Post-Norm (Gemma 3 style) |
| Fine-tuning existing model | Match the base model architecture |

If you're training from scratch and willing to implement QK-Norm correctly, Post-Norm + QK-Norm is the current best practice. The quality gains are real, and multiple organizations (AI2, Google) have validated the approach.

If you want simplicity or are fine-tuning, Pre-Norm is still perfectly good. The 1-2% quality difference rarely matters more than engineering velocity.

## The Deeper Lesson

This story illustrates how ML best practices evolve:

1. **Original solution** (Post-Norm): Works but has stability issues
2. **Overcorrection** (Pre-Norm): Solves stability, accepts quality loss
3. **Refined solution** (Post-Norm + QK-Norm): Addresses root cause, gets both stability and quality

The 2019-2023 Pre-Norm consensus wasn't wrong—it was the right tradeoff given the understanding at the time. QK-Norm enabled a better tradeoff, so the field updated.

Expect this pattern to continue. Today's "best practices" are tomorrow's "we now know better."

---

*For detailed ablations on normalization choices across modern architectures, see the OLMo 2 paper and Sebastian Raschka's [The Big LLM Architecture Comparison](https://magazine.sebastianraschka.com/p/the-big-llm-architecture-comparison).*
