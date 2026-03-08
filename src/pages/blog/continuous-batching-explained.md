---
layout: '../../layouts/PostLayout.astro'
title: 'Continuous Batching: Why LLM Serving Is Not Like Traditional Inference'
description: "Static batching wastes GPU cycles waiting for the slowest request. Continuous batching fixes this by adding and removing requests at every iteration. Here's how it works."
pubDate: '2026-02-27'
tags: ['machine learning', 'inference', 'infrastructure']
---

Traditional ML serving batches requests together and processes them as a unit. This works because most models have predictable output sizes: an image classifier returns one label per image, a recommender returns N items per user. LLMs break this assumption. A request might generate 10 tokens or 1000 tokens. If you batch a short response with a long one, the GPU sits idle after the short response finishes, waiting for the long one.

Continuous batching solves this by treating each token generation step as a scheduling opportunity. Requests enter and exit the batch at every iteration, not just at batch boundaries.

*This post builds on concepts from [Scaling Foundation Model Inference](/blog/scaling-foundation-model-inference/) and [Maximizing GPU Utilization](/blog/maximizing-gpu-utilization/).*

## The Static Batching Problem

In static batching, you collect N requests, process them together, and return results when all N are done.

```
Batch of 4 requests:
  Request A: "Hi" → generates 5 tokens
  Request B: "Write a poem" → generates 200 tokens
  Request C: "What's 2+2?" → generates 3 tokens
  Request D: "Summarize this article..." → generates 150 tokens

Timeline with static batching:
  Iteration 1:  [A, B, C, D] all active
  Iteration 3:  [A, B, _, D] C finished, slot wasted
  Iteration 5:  [_, B, _, D] A finished, slot wasted
  Iteration 150: [_, B, _, _] D finished, slot wasted
  Iteration 200: [_, _, _, _] B finally finishes
```

For iterations 3-200, you're paying for 4 slots but using fewer. The GPU loads the same weights regardless of how many active requests exist in the batch. You're wasting memory bandwidth on empty slots.

**The math**: If average output length is 100 tokens but variance is high (some requests are 10 tokens, some are 500), static batching utilization can drop below 50%.

## How Continuous Batching Works

Continuous batching makes one simple change: check for completed requests after every iteration, and fill empty slots immediately.

```
Timeline with continuous batching:
  Iteration 1:  [A, B, C, D] all active
  Iteration 3:  [A, B, E, D] C finished → E enters immediately
  Iteration 5:  [F, B, E, D] A finished → F enters immediately
  ...
```

The batch stays full. New requests don't wait for the entire batch to complete. Finished requests don't hold slots hostage.

**Result**: Benchmarks show 8-23x throughput improvement over static batching, depending on workload variance.

## Iteration-Level Scheduling

The key mechanism is **iteration-level scheduling**: at every decode step, the scheduler:

1. Checks which requests have finished (hit EOS token or max length)
2. Removes finished requests from the batch
3. Adds waiting requests to fill empty slots
4. Runs one forward pass
5. Repeats

```python
# Simplified scheduler loop
while True:
    # Remove finished requests
    for req in batch:
        if req.is_done():
            batch.remove(req)
            return_result(req)

    # Add new requests
    while len(batch) < max_batch_size and waiting_queue:
        batch.add(waiting_queue.pop())

    # Run one decode step
    if batch:
        next_tokens = model.decode_step(batch)
        for req, token in zip(batch, next_tokens):
            req.append_token(token)
```

This is fundamentally different from traditional batching where the batch is fixed for the entire inference.

## Prefill vs Decode Scheduling

There's a complication: new requests need **prefill** (processing the input prompt) before they can **decode** (generate tokens). Prefill is compute-heavy; decode is memory-heavy. Mixing them naively can hurt performance.

Modern schedulers handle this in different ways:

**Chunked prefill**: Break long prompts into chunks, interleave prefill chunks with decode steps. Keeps decode latency consistent.

```
Without chunking:
  Decode [A,B,C] → Prefill [D] (1000 tokens, blocks decode) → Decode [A,B,C,D]

With chunking:
  Decode [A,B,C] + Prefill [D chunk 1] → Decode [A,B,C] + Prefill [D chunk 2] → ...
```

**Prefill prioritization**: Run prefill immediately to minimize time-to-first-token, even if it briefly stalls decodes.

**Disaggregated serving**: Separate prefill and decode to different GPU pools entirely. (This is a larger architectural choice, beyond basic continuous batching.)

## Memory Management: Why PagedAttention Matters

Continuous batching creates a memory management challenge. With static batching, you can pre-allocate fixed buffers for each slot. With continuous batching, requests come and go, and each has a different KV cache size.

Naive approaches pre-allocate for worst case (max sequence length per slot), wasting memory. Most requests don't use the full context window.

**PagedAttention** (introduced by vLLM) solves this by borrowing from operating system virtual memory:

- KV cache is allocated in fixed-size **blocks** (like memory pages)
- Blocks are allocated on-demand as the sequence grows
- When a request finishes, its blocks return to a free pool
- No fragmentation, no wasted pre-allocation

```
Without PagedAttention:
  Request A: allocated 8K tokens, uses 500 → 7500 tokens wasted
  Request B: allocated 8K tokens, uses 50 → 7950 tokens wasted

With PagedAttention:
  Request A: allocated 500 tokens in blocks → 0 waste
  Request B: allocated 50 tokens in blocks → 0 waste
```

This is what enables high batch sizes with continuous batching. Without efficient memory management, you'd run out of GPU memory before you could fill the batch.

For more on KV cache memory, see [Attention Mechanisms Compared](/blog/attention-mechanisms-compared/).

## Batching and GPU Utilization

As covered in [Maximizing GPU Utilization](/blog/maximizing-gpu-utilization/), LLM decode is memory-bound. You load the entire model's weights for each forward pass. Higher batch sizes amortize this cost across more tokens.

| Batch Size | Relative Throughput | Why |
|------------|---------------------|-----|
| 1 | 1x | Load weights, generate 1 token |
| 8 | ~6x | Load weights, generate 8 tokens |
| 32 | ~15x | Load weights, generate 32 tokens |

Static batching limits effective batch size because slots go empty as requests finish. Continuous batching keeps slots full, maintaining high effective batch size throughout.

**The compounding effect**: Continuous batching improves utilization, which allows higher throughput, which means shorter queue times, which improves overall latency. It's not just about throughput.

## When Continuous Batching Helps Most

**High variance in output length**: If some requests generate 10 tokens and others generate 1000, continuous batching provides massive gains.

**High request volume**: With many requests in the queue, empty slots get filled immediately. Low volume means empty slots might stay empty anyway.

**Long outputs**: More iterations per request means more opportunities for slots to go empty with static batching.

**Where it matters less:**

- Fixed-length outputs (rare in LLMs)
- Very low traffic (not enough requests to fill slots)
- Prefill-dominated workloads (short outputs, long inputs)

## Implementation: vLLM, TensorRT-LLM, and Others

All modern LLM serving frameworks implement continuous batching:

**vLLM**: Continuous batching + PagedAttention. The reference implementation.

```bash
python -m vllm.entrypoints.openai.api_server \
    --model meta-llama/Llama-2-70b-hf
# Continuous batching is the default
```

**TensorRT-LLM**: NVIDIA's implementation with "in-flight batching" (their term for continuous batching) + paged KV cache.

**Text Generation Inference (TGI)**: HuggingFace's serving solution, also uses continuous batching.

**Triton Inference Server**: Supports continuous batching for LLM backends.

The concepts are the same across frameworks. Implementation details differ (scheduling policies, memory management, prefill handling).

## Combining with Other Optimizations

Continuous batching stacks with everything:

- [Quantization](/blog/quantization-for-llm-inference/): Smaller weights + continuous batching = even higher batch sizes
- [Tensor Parallelism](/blog/tensor-parallelism-fundamentals/): Split model across GPUs, continuous batch within each
- [Speculative Decoding](/blog/speculative-decoding-explained/): Verify multiple tokens per iteration, still with continuous batching
- [Flash Attention](/blog/flash-attention-in-practice/): Faster attention computation per iteration

A production stack uses all of these together.

## Key Takeaways

1. **Static batching wastes GPU cycles** when requests have variable output lengths
2. **Continuous batching fills slots immediately** when requests finish
3. **Iteration-level scheduling** is the core mechanism
4. **PagedAttention** solves the memory management challenge
5. **All modern serving frameworks** implement this by default

If you're running an LLM serving framework from the last two years, you're already using continuous batching. Understanding how it works helps you tune batch sizes, understand latency/throughput tradeoffs, and debug serving issues.

---

## References

1. Kwon et al., "Efficient Memory Management for Large Language Model Serving with PagedAttention" (2023) - https://arxiv.org/abs/2309.06180
2. Yu et al., "ORCA: A Distributed Serving System for Transformer-Based Generative Models" (2022) - https://www.usenix.org/conference/osdi22/presentation/yu
3. Anyscale, "How continuous batching enables 23x throughput in LLM inference" - https://www.anyscale.com/blog/continuous-batching-llm-inference
4. vLLM documentation - https://docs.vllm.ai/
