---
layout: '../../layouts/PostLayout.astro'
title: 'Tensor Parallelism: How Large Models Fit Across GPUs'
description: "Data parallelism hits a wall when your model doesn't fit on one GPU. Tensor parallelism solves this by sharding the model itself."
pubDate: '2025-12-28'
tags: ['machine learning', 'infrastructure', 'distributed systems']
---

Data parallelism is simple: replicate the model on every GPU, shard the batch, average gradients. It works until your model exceeds single-GPU memory. A 70B parameter model in fp16 needs ~140GB just for weights. No single GPU holds that.

Tensor parallelism solves this by distributing the model itself across devices. Instead of each GPU holding a complete model, each GPU holds a shard of every layer.

## The Three Parallelism Strategies

**Data Parallelism**: Each device holds the full model, processes different batches. Synchronize gradients once per step. Simple, but limited by single-device memory.

**Tensor Parallelism**: The model is sliced horizontally. Each device holds part of every layer. Requires fast interconnect (NVLink, ~900GB/s) because devices communicate every layer.

**Pipeline Parallelism**: The model is sliced vertically. Each device holds entire layers, but only a subset of them. Device 1 runs layers 1-20, device 2 runs layers 21-40. Communication only at stage boundaries.

In practice, large model training uses all three:
- Tensor parallelism within a node (8 GPUs with NVLink)
- Pipeline parallelism across nodes (slower interconnect)
- Data parallelism across pipeline replicas

## Why Matrix Multiplication Shards Cleanly

The key insight: any matrix multiply can decompose into smaller multiplies.

For C = A × B where A is (n × d) and B is (d × m):

```
C = A × B
  = [A₁ | A₂] × [B₁]    # Split A by columns, B by rows
                [B₂]
  = A₁×B₁ + A₂×B₂       # Sum of partial products
```

Each partial product can happen on a different device. Then sum the results. This is the foundation of tensor parallelism.

## Two Sharding Cases

When you shard matrices for multiplication, two cases emerge based on which axes you partition.

### Case 1: Shard the Inner Dimension

Given C = A × B, the "inner" dimension is the one that gets summed over (columns of A, rows of B).

```
A: (batch, seq, embed)    # embed is inner
B: (embed, hidden)        # embed is inner

If both sharded on embed:
  Device 0: A[:, :, 0:512] × B[0:512, :]  →  C_partial_0
  Device 1: A[:, :, 512:1024] × B[512:1024, :]  →  C_partial_1

  C = AllReduce(C_partial_0, C_partial_1)
```

Each device computes a partial result. AllReduce sums them to get the final output.

**When sharding doesn't align**, devices need to gather data first:

```
A sharded on: batch
B sharded on: embed

Before multiply:
  AllGather B so each device has full B
  Then multiply locally
```

### Case 2: Shard the Outer Dimensions

The "outer" dimensions are batch (rows of A) and output features (columns of B).

```
A: (batch, seq, embed)    # batch is outer
B: (embed, hidden)        # hidden is outer

Shard A on batch, B on hidden:
  Device 0: A[0:16, :, :] × B[:, 0:2048]  →  C[0:16, :, 0:2048]
  Device 1: A[16:32, :, :] × B[:, 2048:4096]  →  C[16:32, :, 2048:4096]
```

No communication needed for the multiply itself. Each device produces a different slice of the output.

## The GSPMD Pattern for Transformers

The [GSPMD paper](https://arxiv.org/abs/2105.04663) established a standard sharding pattern for transformer feedforward blocks.

Consider a feedforward layer: `hidden = Linear(embed → 4×embed)` then `output = Linear(4×embed → embed)`.

**First Linear (expand):**
```
Input X:      (batch, seq, embed)     sharded on batch
Weights W_up: (embed, 4×embed)        sharded on output dim

# Sharding mismatch on inner dim → AllGather weights first
X_full × W_up = hidden
# hidden: (batch, seq, 4×embed) sharded on hidden dim
```

**Second Linear (contract):**
```
hidden:       (batch, seq, 4×embed)   sharded on hidden
Weights W_down: (4×embed, embed)      sharded on input dim

# Inner dims match → multiply directly, then ReduceScatter
hidden × W_down → ReduceScatter → output
# output: (batch, seq, embed) sharded on batch
```

The pattern alternates: AllGather before expand, ReduceScatter after contract. This keeps the batch dimension sharded on input/output while parallelizing the computation in between.

## The Device Mesh

Tensor parallelism organizes GPUs into a mesh, typically 2D.

```
8 GPUs as 2×4 mesh:

       TP dimension (4-way)
       ──────────────────►
    ┌──────┬──────┬──────┬──────┐
 DP │ GPU0 │ GPU1 │ GPU2 │ GPU3 │  ◄─ Same data shard
    ├──────┼──────┼──────┼──────┤
    │ GPU4 │ GPU5 │ GPU6 │ GPU7 │  ◄─ Different data shard
    └──────┴──────┴──────┴──────┘
```

- **TP dimension (horizontal)**: GPUs that shard the model. Must communicate every layer.
- **DP dimension (vertical)**: GPUs that shard data. Only communicate at gradient sync.

For a 70B model on 8 GPUs:
- 4-way tensor parallelism: each GPU holds ~17.5B parameters
- 2-way data parallelism: double the throughput

## Communication Costs

Tensor parallelism's overhead comes from collective operations every layer:

| Operation | When Used | Cost |
|-----------|-----------|------|
| AllGather | Before multiply when inner dims don't match | O(data_size × num_devices) |
| AllReduce | After multiply when summing partial products | O(data_size × 2) |
| ReduceScatter | After multiply to distribute results | O(data_size) |

On TPU v2-8, roughly **20% of forward pass time** is spent on these collectives. On GPUs with NVLink, it's similar.

This is why interconnect bandwidth matters:
- **NVLink (within node)**: ~900 GB/s → tensor parallelism works well
- **InfiniBand (across nodes)**: ~100 GB/s → tensor parallelism becomes a bottleneck

## Practical Limits

**Tensor parallelism scales within a node.** 8-way TP across 8 GPUs with NVLink is common. Beyond that, communication overhead dominates.

**Pipeline parallelism scales across nodes.** Slice the model into stages, pipeline micro-batches through stages. Communication only at stage boundaries.

**Typical large model setup:**
```
Llama 70B on 64 GPUs (8 nodes × 8 GPUs):
  - 8-way tensor parallelism within each node
  - 8-way pipeline parallelism across nodes

Each GPU holds: 70B / 64 ≈ 1.1B parameters
Plus optimizer states, activations, gradients...
```

## Inference vs Training

Training needs more memory per device:
- Weights
- Gradients (same size as weights)
- Optimizer states (2× weights for Adam)
- Activations (for backward pass)

Inference only needs:
- Weights
- KV cache
- Current activations

This is why inference can often use less parallelism than training for the same model. A 70B model that needs 8 GPUs for training might serve on 2 GPUs for inference (with quantization).

## The Compiler's Job

Modern frameworks (Megatron, FSDP, DeepSpeed) handle the complexity:

1. You specify the mesh topology and sharding strategy
2. The framework determines where to insert AllGather/AllReduce/ReduceScatter
3. Communication is overlapped with computation where possible

The mental model: think about which dimensions of your tensors are sharded, and the communication pattern follows from the math.

---

## References

1. Humayun, Irfan, "A Primer on Parallelism with pjit" - https://irhum.github.io/blog/pjit/
2. Xu et al., "GSPMD: General and Scalable Parallelization for ML Computation Graphs" (2021) - https://arxiv.org/abs/2105.04663
3. Shoeybi et al., "Megatron-LM: Training Multi-Billion Parameter Language Models Using Model Parallelism" (2019) - https://arxiv.org/abs/1909.08053
4. Narayanan et al., "Efficient Large-Scale Language Model Training on GPU Clusters Using Megatron-LM" (2021) - https://arxiv.org/abs/2104.04473
5. Huang et al., "GPipe: Efficient Training of Giant Neural Networks using Pipeline Parallelism" (2019) - https://arxiv.org/abs/1811.06965
