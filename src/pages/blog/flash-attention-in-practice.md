---
layout: '../../layouts/PostLayout.astro'
title: 'Flash Attention: Why Memory Access Patterns Matter More Than FLOPs'
description: "Flash Attention doesn't reduce computation—it reduces memory traffic. Understanding why that matters is key to optimizing transformers."
pubDate: '2025-10-22'
tags: ['machine learning', 'optimization', 'transformers']
---

Standard attention at 8K context on a 70B model materializes a 67 million element matrix (8192 × 8192) per head per layer. That's 4.3GB of memory traffic for attention alone—and the GPU spends most of its time waiting on memory, not computing. Flash Attention eliminates this bottleneck by never materializing the full attention matrix. The algorithm does the same math but accesses memory differently—and that difference is transformative.

## The Memory Bandwidth Problem

Modern GPUs are compute monsters. An A100 can do 312 TFLOPS (fp16). But its memory bandwidth is "only" 2 TB/s.

This ratio matters. For every 156 FLOPs, you can transfer 1 byte. If your algorithm needs to read 4 bytes per FLOP, you're memory-bound—the GPU sits idle waiting for data.

Standard attention is severely memory-bound. Here's why:

```
Q, K, V: [seq_len, head_dim] each
S = Q @ K.T                     # Write seq_len × seq_len matrix to HBM
P = softmax(S)                  # Read S, write P to HBM
O = P @ V                       # Read P, write O to HBM
```

The intermediate matrix S is `seq_len × seq_len`:
- 4K context: 16M elements = 32MB (fp16)
- 8K context: 67M elements = 134MB
- 32K context: 1B elements = 2GB
- 128K context: 16B elements = 32GB (per head!)

At long contexts, you're spending all your time moving this matrix to and from GPU memory.

## The Flash Attention Insight

Flash Attention's core insight: **you don't need to store the full attention matrix**.

Standard softmax needs the max value (for numerical stability) before computing. This seems to require seeing all values first. Flash Attention shows you can compute softmax *incrementally*, keeping only running statistics.

The algorithm tiles the computation:

```
For each block of Q:
    For each block of K, V:
        Compute partial attention scores
        Update running max and sum
        Accumulate weighted output
    Rescale final output
```

At no point does the full `seq_len × seq_len` matrix exist. Memory usage is O(seq_len) instead of O(seq_len²).

## Memory Complexity Comparison

| Approach | Attention Memory | 4K context | 32K context | 128K context |
|----------|------------------|------------|-------------|--------------|
| Standard | O(n²) | 32 MB | 2 GB | 32 GB |
| Flash Attention | O(n) | ~4 MB | ~8 MB | ~16 MB |

The memory savings are dramatic at long contexts. This is why 32K+ context models essentially require Flash Attention—without it, you can't fit the attention matrices.

## The Speed Paradox

Flash Attention actually does *more* FLOPs than standard attention. The tiled softmax requires recomputation during the backward pass rather than storing activations.

| Phase | Standard | Flash Attention |
|-------|----------|-----------------|
| Forward FLOPs | 1.0x | 1.0x |
| Backward FLOPs | 1.0x | ~1.15-1.2x |
| Memory I/O | O(n²) | O(n) |

Yet Flash Attention is faster. Why?

**Because memory bandwidth is the bottleneck, not compute.** Reducing memory traffic by 100x while increasing compute by 15% is a massive net win when you're memory-bound.

This is the fundamental lesson: modern ML optimization is often about memory access patterns, not minimizing FLOPs.

## When Flash Attention Helps (And When It Doesn't)

### The crossover point

At short sequence lengths (< 512 tokens), the attention matrix fits in GPU cache. Memory traffic is low, and you're actually compute-bound. Flash Attention's tiling overhead can make it *slower*.

At long sequence lengths (> 2K tokens), you're firmly memory-bound. Flash Attention dominates.

Most implementations use adaptive dispatch: standard attention for short sequences, Flash Attention for long.

### Batch size interaction

Flash Attention's memory savings translate to larger batch sizes. This matters enormously for throughput.

Consider serving a 70B model at 8K context on A100 80GB:
- Standard attention: ~48GB for attention matrices alone. Max batch size ≈ 1-2.
- Flash Attention: ~200MB for attention. Max batch size ≈ 8+.

Larger batches mean better GPU utilization. The throughput gain compounds beyond the raw memory savings.

### Sparse attention patterns

Flash Attention assumes dense attention. Sparse patterns (sliding window, local attention) require different implementations.

However, the Flash Attention *principle*—never materialize large matrices—applies universally. Sliding window attention can use similar tiling strategies.

## Implementation Reality

You're not implementing Flash Attention from scratch. Use one of:

- **`flash-attn`** (Tri Dao's reference implementation): Best performance, CUDA only
- **`xformers`** (Meta): Good integration with PyTorch, multiple backends
- **PyTorch 2.0+ scaled_dot_product_attention**: Built-in, automatically dispatches to optimized kernels

The reason you're not implementing it yourself: Flash Attention requires careful CUDA kernel programming to control memory access patterns. A naive Python implementation wouldn't get the benefits—the whole point is low-level memory orchestration.

## Kernel Fusion: The Broader Lesson

Flash Attention is a specific instance of a general principle: **kernel fusion reduces memory traffic**.

Standard PyTorch attention:
```python
S = Q @ K.T          # Kernel 1: write S to HBM
P = softmax(S)       # Kernel 2: read S, write P to HBM
O = P @ V            # Kernel 3: read P, write O to HBM
```

Each kernel reads/writes to GPU global memory (HBM). Three round trips.

Flash Attention fuses this into one kernel that keeps intermediates in SRAM (fast on-chip memory). One round trip.

The same principle applies elsewhere:
- Fused LayerNorm + activation
- Fused attention + output projection
- Fused embedding lookup + position encoding

Whenever you see separate operations that could share intermediate values, there's potential for kernel fusion.

## Practical Guidance

**For inference:**
- Use Flash Attention for sequences > 1K tokens
- For shorter sequences, measure—the overhead may not be worth it
- Enable through your serving framework (vLLM, TensorRT-LLM, etc.) rather than DIY

**For training:**
- Flash Attention is essentially required for long-context training
- The backward pass recomputation is worth the memory savings
- Most frameworks (Hugging Face, PyTorch) support it out of the box

**For debugging:**
- Flash Attention makes attention patterns opaque (no intermediate matrix to inspect)
- Keep a standard attention path for debugging numeric issues
- Some libraries offer "slow but inspectable" modes

## Beyond Flash Attention

Flash Attention 2 (2023) and Flash Attention 3 (2024) improved on the original:
- Better thread scheduling for modern GPUs
- Optimizations for GQA (grouped-query attention)
- Support for variable-length sequences in a batch

The field continues to evolve. Ring Attention extends the approach to distribute attention across multiple GPUs for extremely long contexts.

The core principle remains: attention's bottleneck is memory, not math. Any optimization that reduces memory traffic while preserving numerical correctness is a win.

---

*For the original algorithm details, see Tri Dao's Flash Attention papers. For broader context on attention mechanisms, see Sebastian Raschka's [The Big LLM Architecture Comparison](https://magazine.sebastianraschka.com/p/the-big-llm-architecture-comparison).*
