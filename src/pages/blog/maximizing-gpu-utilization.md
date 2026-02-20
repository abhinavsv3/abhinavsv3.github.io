---
layout: '../../layouts/PostLayout.astro'
title: 'Maximizing GPU Utilization: Mixing Online and Offline Inference Workloads'
description: 'How we increased GPU utilization from 23% to 84% by treating offline work as backfill for online traffic gaps.'
pubDate: '2025-12-08'
tags: ['machine learning', 'infrastructure', 'optimization']
---

We were burning $47/hour per GPU on a cluster of 8 A100s (80GB), running a 70B parameter model for real-time inference. Our SM utilization averaged 23%. That's $300/hour in hardware costs for a system that was idle three-quarters of the time.

The problem wasn't the model. It was the traffic pattern.

## The Setup

Our workload had two distinct streams:

| Stream | Volume | SLA | Pattern |
|--------|--------|-----|---------|
| Online (real-time API) | ~2,400 req/hour | p99 < 800ms | Bursty, peaks at 3x average |
| Offline (batch enrichment) | ~1.2M items/week | Best effort | Steady, can be delayed |

Online traffic drove our capacity planning. We sized for peak load plus headroom—which meant during valleys (nights, weekends, between bursts), GPUs sat idle.

The offline work was running on a separate cluster. Also underutilized, but for a different reason: we'd provisioned conservatively to avoid starving if we needed to scale down.

Two clusters. Both underutilized. Combined idle burn: ~$180K/month.

## What We Tried First (And Why It Failed)

### Attempt 1: Time-based partitioning

Run offline during nights and weekends, online during business hours.

**Result**: Failed within two weeks.

The cutover times became coordination nightmares. Online traffic doesn't respect schedules—we had p99 latency spikes above 2s during "offline hours" when real requests arrived. The ops burden of managing switchovers wasn't worth it.

### Attempt 2: Separate priority queues, same cluster

Route both streams to the same cluster with online traffic in a high-priority queue.

**Result**: Partial success, but brittle.

This improved utilization to ~45%, but introduced a new problem: batch fragmentation. The model server would form a batch of 8 offline requests, then an online request would arrive. Options were bad:

1. **Wait for batch to complete**: Online latency blows up (adds 400-600ms)
2. **Preempt the batch**: Wasted compute, KV cache invalidation, GPU memory pressure
3. **Add online request to running batch**: Not possible with our serving framework

We chose option 1 with a shorter batch timeout. Utilization dropped back to 38%.

## The Solution That Worked

The key insight: **don't treat online and offline as separate queues. Treat offline as backfill for incomplete batches.**

Here's the flow:

1. Batcher waits up to 15ms for online requests
2. If batch isn't full (target: 8 requests), fill remaining slots from offline queue
3. All requests in the batch complete together
4. Online and offline responses are routed back to their respective callers

This eliminates the preemption problem entirely. Every batch is full. Every GPU cycle is used.

### The Numbers

After implementing backfill batching:

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| SM Utilization (avg) | 23% | 84% | +61pp |
| SM Utilization (p50) | 18% | 82% | +64pp |
| Online p50 latency | 180ms | 195ms | +15ms |
| Online p99 latency | 620ms | 680ms | +60ms |
| Throughput (req/hour) | 2,400 | 9,200 | +283% |
| Cost per 1M tokens | $4.20 | $1.10 | -74% |

We added 15ms to median latency and 60ms to p99. That was the tradeoff—and it was worth it.

### Why 84% and Not Higher?

Three reasons we couldn't push past 84%:

1. **Batch formation delay**: The 15ms wait window means we're sometimes waiting with a partially-full batch. Reducing this hurt online latency more than it helped utilization.

2. **Token length variance**: Our offline workload had high variance in output token count (p50: 120 tokens, p99: 890 tokens). Long-running requests in a batch hold up the short ones. Continuous batching would help here, but our serving stack didn't support it.

3. **Memory pressure from KV cache**: At batch size 8 with 70B parameters and 4K context, KV cache consumes ~40GB. Pushing to batch size 12 caused OOM under certain token length distributions.

## Exploiting KV Cache Locality

With the basic system working, we looked for additional gains. The attention KV cache was the obvious target.

**Hypothesis**: If offline requests sharing common prefixes are batched together, we can reuse KV cache entries and reduce redundant computation.

**Reality**: Gains were smaller than expected, and the complexity was high.

We sorted our offline queue so items with longest common prefixes were adjacent. The routing layer hashed on prefix to ensure similar requests hit the same model server.

| Metric | Without prefix sorting | With prefix sorting |
|--------|------------------------|---------------------|
| Throughput | 9,200 req/hour | 9,800 req/hour |
| KV cache hit rate | 12% | 34% |
| Routing complexity | Simple | Hash ring + consistent hashing |

6.5% throughput gain. Meaningful, but the operational complexity—prefix extraction, hash ring maintenance, handling hot prefixes—made us question whether it was worth it.

**The scar**: We spent three weeks on prefix optimization. Should have shipped the basic backfill system first and measured whether we even needed more. The 84% utilization was already a win.

## Starvation and Fairness

With online traffic having strict priority, offline work can starve during sustained load.

Our first implementation had no fairness guarantees. During a traffic spike that lasted 6 hours, offline progress dropped to zero. The weekly batch job that usually completed in 4 days took 9.

We added a simple fairness mechanism: every 10th batch slot is reserved for offline, regardless of online queue depth.

| Metric | No fairness | With fairness |
|--------|-------------|---------------|
| Offline starvation events/week | 3-4 | 0 |
| Online p99 latency impact | — | +40ms |
| Weekly batch completion variance | ±3 days | ±0.5 days |

The p99 impact was acceptable. Predictable batch completion was more valuable than squeezing another 40ms.

## What We'd Do Differently

**Start with backfill batching, skip the complex stuff.** Prefix-based routing, weighted fair queuing, and KV cache optimization are all real techniques. But the basic insight—offline as backfill—delivered 80% of the value with 20% of the complexity.

**Measure idle cost explicitly.** We didn't have good visibility into per-GPU utilization until we instrumented it. The $180K/month number was a back-of-envelope estimate that turned out to be conservative.

**Don't underestimate token length variance.** Our offline workload had a long tail of verbose outputs. This caused more batch fragmentation than we expected. If your output distribution has high variance, continuous batching matters more than prefix optimization.

## Conclusion

Mixing online and offline workloads isn't novel, but the specifics matter.

The system we run today:
- 8x A100 80GB cluster (down from 8 + 4 on separate clusters)
- 70B parameter model, 4K context
- Batch size 8, 15ms collection window
- 84% average SM utilization
- p99 online latency: 680ms
- Cost per 1M tokens: $1.10

The key tradeoffs:
- +60ms p99 latency for +61pp utilization
- 10% batch slots reserved for fairness, preventing starvation
- Prefix optimization adds 6.5% throughput but significant complexity

If you're running separate clusters for real-time and batch inference, you're probably leaving money on the table. The backfill pattern is simple to implement and the gains are immediate.
