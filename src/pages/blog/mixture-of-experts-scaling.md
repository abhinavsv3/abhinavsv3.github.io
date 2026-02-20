---
layout: '../../layouts/PostLayout.astro'
title: 'Mixture of Experts: The Scaling Strategy Behind Modern LLMs'
description: "DeepSeek uses 256 experts, Llama 4 uses 8,192. Why expert count matters, and what the tradeoffs actually are."
pubDate: '2025-08-28'
tags: ['machine learning', 'architecture', 'scaling']
---

Mixture of Experts (MoE) lets you scale model parameters without scaling compute. DeepSeek V3 has 671B total parameters but only activates 37B per token—5.5% of the model. This is how you get GPT-4 level capability at a fraction of the inference cost. But the design space is enormous: expert counts now range from 8 to 8,192. Here's how to think about the tradeoffs.

## The MoE Concept

In a standard transformer, every token passes through every parameter. In MoE, a router network selects which "experts" (typically FFN blocks) process each token.

```
Standard: Token → FFN (all parameters active)
MoE:      Token → Router → Expert 1, Expert 5 (2 of 8 active)
```

The key insight: different tokens need different processing. Code tokens, math tokens, and natural language tokens have different patterns. Why use the same parameters for all of them?

## The Design Space

| Model | Total Params | Experts | Active per Token | Expert Size | Sparsity |
|-------|--------------|---------|------------------|-------------|----------|
| Mixtral 8x7B | 47B | 8 | 2 | ~7B | 25% |
| DeepSeek V3 | 671B | 256 | 9 | ~2.6B | 5.5% |
| Qwen3 235B | 235B | 128 | 8 | ~1.8B | 9.4% |
| Llama 4 Maverick | 400B | 128 | 1 | ~3B | ~2% |

The trend: expert counts are increasing from single digits to hundreds. But why?

## Why More Experts?

### 1. Finer-Grained Specialization

With 8 experts and top-2 routing, each expert handles ~25% of tokens. That's broad—each expert must be a generalist.

With 256 experts and top-8 routing, each expert handles ~3% of tokens. They can specialize more narrowly: one expert for Python syntax, another for SQL, another for formal mathematical notation.

Research from DeepSeek V3 shows experts naturally cluster by:
- Programming languages (distinct experts for Python, C++, JavaScript)
- Mathematical domains (algebra vs. geometry vs. statistics)
- Language families (Romance languages share experts differently than CJK)

### 2. Better Parameter Efficiency

Here's the unintuitive part: many small experts outperform few large experts at the same total parameter count.

Consider two designs with 64B total expert parameters:
- 8 experts × 8B each
- 64 experts × 1B each

The 64-expert design typically achieves lower perplexity. Why? Each token only uses a fraction of parameters, so you want the "right" parameters for that token. More experts = more precise matching.

The research literature calls this "capacity utilization"—with more experts, fewer parameters are wasted on tokens they're poorly suited for.

### 3. Routing Flexibility

With 8 experts and top-2 routing, you have C(8,2) = 28 possible expert combinations per token.

With 128 experts and top-2 routing, you have C(128,2) = 8,128 combinations.

More combinations means the model can learn more nuanced routing strategies. In practice, models learn complex patterns: "Python code inside a docstring" routes differently than "Python code in a function body."

## The Tradeoffs

### 1. Load Balancing Becomes Critical

The router learns which experts to use. Without intervention, it often converges to using a small subset of experts while others go unused—"expert collapse."

With 8 experts, if one gets 20% of traffic instead of 12.5%, you're 1.6x over capacity. Annoying but manageable.

With 256 experts, uniform distribution means ~0.4% per expert. If one gets 2%, you're 5x over capacity. Training becomes unstable or inefficient.

The solution: auxiliary loss terms that penalize unbalanced routing. DeepSeek V3 uses a load balancing loss that encourages uniform expert utilization. The tradeoff is that this loss can conflict with quality—the "optimal" routing might be unbalanced.

### 2. Communication Overhead

In distributed training, experts live on different GPUs. Token-to-expert routing requires all-to-all communication.

With 8 experts across 8 GPUs: simple 1:1 mapping.

With 256 experts across 64 GPUs: complex routing with multiple experts per GPU, tokens crossing node boundaries.

DeepSeek and others use "expert parallelism"—a specific communication strategy for MoE that minimizes cross-node traffic. But even optimized, communication can consume 20-40% of step time at high expert counts.

### 3. Inference Complexity

Dense models: load weights, run forward pass.

MoE models: load router, compute routing, load relevant expert weights (or keep all resident), run forward pass, gather outputs.

Memory consideration: 256 experts at 2.6B parameters each = 665B total parameters. Even if only 9 are active per token, you need memory capacity for all experts (unless you're willing to swap from disk, which adds latency).

This is why MoE inference typically requires more GPUs than a dense model of equivalent "active" size.

## The Shared Expert Pattern

DeepSeek V3 introduced "shared experts"—experts that process every token regardless of routing.

```
Standard MoE:  Router → Top-K experts
DeepSeek V3:   Router → Top-K experts + 1 shared expert (always on)
```

Why this helps:

1. **Common patterns**: Some computations apply to all tokens (basic syntax, attention patterns). Shared expert learns these, freeing routed experts for specialization.

2. **Training stability**: Shared expert provides consistent gradient signal. Routed experts have sparse gradients (only see their assigned tokens), which can cause training instability.

3. **Fallback capacity**: If routing fails or is uncertain, shared expert handles the token.

## Dense Layers Before MoE

Both DeepSeek V3 and GLaM-style models use dense (non-MoE) layers at the start of the network.

Why: early layers extract basic features—tokenization patterns, positional information. These computations are similar across all tokens. Routing them to specialized experts is wasteful.

The pattern: 3-4 dense layers, then MoE layers for the rest of the network. This reduces routing overhead and often improves training stability.

## Practical Guidance

**If training from scratch:**
- Start with 64-256 experts (the current sweet spot)
- Include 1-2 shared experts
- Use 3 dense initial layers before MoE
- Implement load balancing loss (DeepSeek V3's approach is well-documented)
- Monitor for expert collapse (measure expert utilization variance)

**If fine-tuning an existing MoE:**
- Be careful—routing patterns can shift dramatically
- Consider freezing the router and only fine-tuning expert weights
- Small datasets can cause expert collapse (experts forget their specialization)

**If serving MoE models:**
- Expert placement matters more than expert count for latency
- Profile your traffic to identify hot experts (frequently co-activated)
- Expert quantization (INT4/INT8) works well and is critical for fitting models in memory

## What's Next

The field is exploring:

- **Expert merging**: Identifying and combining redundant experts post-training
- **Learned routing depth**: Not all tokens need all layers' experts
- **Extreme sparsity**: Llama 4's 128 experts with top-1 routing (only 1 expert per token)

The direction is toward more experts with lower activation ratios. The operational complexity is real, but the efficiency gains are too significant to ignore.

---

*For comprehensive architectural comparisons across modern LLMs including MoE details, see Sebastian Raschka's [The Big LLM Architecture Comparison](https://magazine.sebastianraschka.com/p/the-big-llm-architecture-comparison).*
