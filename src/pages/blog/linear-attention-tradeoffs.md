---
layout: '../../layouts/PostLayout.astro'
title: 'Linear Attention: Is O(n) Worth the Accuracy Tradeoff?'
description: "Standard attention is O(n²). Linear variants promise O(n). Qwen3 and Kimi K2 use hybrid approaches. Here's what you give up."
pubDate: '2025-06-12'
tags: ['machine learning', 'transformers', 'efficiency']
---

Standard attention scales as O(n²) with sequence length. At 128K context, that's 16 billion attention computations per layer—even Flash Attention can't make that fast. Linear attention variants promise O(n) scaling. Models like Qwen3-Next and Kimi K2 use hybrids: some layers with linear attention, others with full attention. The efficiency gains are real, but so are the quality tradeoffs.

## The Quadratic Problem

Attention computes: `softmax(QK^T/√d) × V`

The QK^T term produces an `n × n` matrix where n is sequence length:
- 4K context: 16 million operations
- 32K context: 1 billion operations
- 128K context: 16 billion operations
- 1M context: 1 trillion operations

Quadratic scaling becomes untenable at long contexts. Even with optimizations like Flash Attention (which reduces memory, not compute), you eventually hit compute limits.

## How Linear Attention Works

The key insight: the softmax forces you to compute all n² attention scores. What if you could avoid softmax entirely?

**Standard attention (simplified):**
```
Output = softmax(Q @ K.T) @ V    # O(n²)
```

**Linear attention:**
```
Output = (Q @ (K.T @ V))    # O(n)
```

By computing `K.T @ V` first (a `d × d` matrix where d is head dimension), then multiplying by Q, you avoid the `n × n` intermediate.

The catch: you lose softmax's normalization, which changes what the attention can express.

## The Core Tradeoff

Softmax attention creates a probability distribution over values. Each query "chooses" which keys to attend to, with weights summing to 1.

Linear attention creates a weighted sum without normalization. This means:
- No explicit "competition" between keys
- Can't express "attend to exactly this token"
- More like a compressed memory than selective retrieval

This matters for tasks requiring precise retrieval: "Find the phone number on page 12" needs exact attention to specific tokens. Linear attention's compressed representation struggles here.

## Modern Linear Attention Variants

### Gated DeltaNet (Qwen3-Next, Kimi K2)

The current state-of-the-art hybrid approach. Key components:

```python
# Conceptual structure
memory = gate_α * memory + key @ value.T    # Update memory
output = gate_β * (query @ memory)          # Retrieve from memory
```

- **Learned gates** control information flow (what to remember, what to retrieve)
- **Fast-weight memory** replaces explicit KV cache
- **Small convolutions** capture local patterns that linear attention misses

### Mamba / State Space Models

Different approach: model attention as a recurrence.

```python
# State space formulation
h[t] = A * h[t-1] + B * x[t]    # State update
y[t] = C * h[t]                  # Output
```

O(n) computation, O(1) state per token. Particularly good for streaming applications.

### Sliding Window Attention

Not truly linear, but effectively O(n):

```
# Full attention: attend to all n tokens
# Sliding window: attend to only w tokens
```

With fixed window w (e.g., 4096), compute is O(n × w). Linear in n if w is constant.

Simpler than Gated DeltaNet but with a hard cutoff—tokens beyond the window are completely invisible.

## Where Linear Attention Struggles

### Precise Retrieval

"What was the third item in the list from the beginning of this document?"

Full attention can directly attend to those specific tokens. Linear attention must hope the relevant information was compressed into its memory state. Research consistently shows 10-20% accuracy drops on needle-in-haystack retrieval tasks.

### In-Context Learning

Few-shot prompting works by attending to examples and matching patterns. Linear attention's compressed memory can't preserve the exact structure of examples as well.

The gap widens with more examples:
- 0-shot: Linear attention comparable to full
- 5-shot: Full attention gains more from additional examples
- The "in-context learning curve" is flatter for linear attention

### Multi-Hop Reasoning

"Who is the author of the book that won the award mentioned in paragraph 3?"

Each reasoning step requires attending to the result of the previous step. Errors compound. Linear attention's approximate retrieval causes more compounding errors than full attention's precise retrieval.

## Where Linear Attention Wins

### Long-Context Summarization

Summarizing a 100K token document doesn't require retrieving specific tokens—it requires understanding gist. Linear attention's compression is actually helpful here; it naturally creates summaries.

### Streaming Applications

Continuous input where you need to respond but don't need to reference exact past inputs: live transcription, customer service, monitoring.

Linear attention's O(1) per-token update is ideal:
- Fixed memory regardless of history length
- Constant latency per new token
- No growing KV cache

### Cost-Sensitive Deployment

When you're willing to trade quality for throughput:
- Chat applications where 95% quality at 30% cost is acceptable
- Preprocessing pipelines where rough answers are fine
- High-volume, low-stakes generation

## The Hybrid Approach

Most practical deployments use hybrids: some layers with full attention, others with linear.

**Qwen3-Next's approach:** 3 linear layers per 1 full attention layer (3:1 ratio)

Why this works:
- Linear layers handle "routine" processing (most tokens don't need global attention)
- Full attention layers act as "retrieval checkpoints"
- You get most of the efficiency with limited quality loss

**Layer placement matters:**
- Uniformly distributed full attention layers work best
- Concentrating full attention at the start or end is worse
- The model needs retrieval capability throughout the network

**Sliding window hybrid (Gemma 3):** 5:1 ratio of sliding window to full attention

Simpler to implement than Gated DeltaNet, similar efficiency gains, but hard cutoff on what's visible beyond the window.

## Practical Guidance

| Use Case | Recommendation |
|----------|----------------|
| General-purpose LLM | Full attention (quality matters) |
| Long-context summarization | Hybrid 3:1 linear/full |
| Streaming / real-time | Linear attention (constant memory) |
| RAG with precise retrieval | Full attention (retrieval accuracy critical) |
| Maximum throughput, cost-sensitive | Hybrid or linear depending on quality tolerance |

**If building a new model for long context:**
1. Start with a hybrid approach (3:1 is a reasonable default)
2. Measure retrieval accuracy on your specific tasks
3. Adjust the ratio based on findings

**If deploying existing models:**
- Check if the model already uses hybrid attention (many recent models do)
- For full-attention models at long context, consider chunking + summarization instead of hoping for 128K inference

## The Bigger Picture

Linear attention represents a fundamental tradeoff: **exact computation vs. compressed approximation**.

Full attention asks: "For this query, what should I look at?"
Linear attention asks: "What patterns exist in what I've seen?"

Neither is universally better. The task determines the right choice.

As context lengths grow to 1M+ tokens, even full attention becomes impractical. The future is likely hybrid architectures that use full attention surgically—for retrieval-critical operations—while using linear attention for bulk processing.

---

*For detailed comparisons of attention mechanisms across modern architectures, see Sebastian Raschka's [The Big LLM Architecture Comparison](https://magazine.sebastianraschka.com/p/the-big-llm-architecture-comparison). For the original Gated DeltaNet work, see the papers from the RWKV and Mamba teams.*
