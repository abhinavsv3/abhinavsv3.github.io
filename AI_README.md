# AI Writing Principles & Anti-Patterns

## Scaling Thoughts — Technical Writing Standard

This document defines the bar for any technical post published under this brand.

The goal is not to write content.
The goal is to write signal.

---

# Core Writing Principles

Every post must include the following:

## 1. Executive Summary First

The first paragraph is the entire post compressed.

Include:
- The problem (with numbers)
- The result (with numbers)
- The key insight (one sentence)

Bad:
- "In this post, we'll explore GPU utilization strategies..."
- "GPUs are expensive and scarce..."

Good:
- "We were burning $47/hour per GPU on a cluster of 8 A100s. SM utilization averaged 23%. We increased it to 84% by treating offline work as backfill for online traffic gaps."

A senior engineer should be able to read the first paragraph and decide if the rest is worth their time.

If the first paragraph could be deleted without losing information, it's not an executive summary.

---

## 2. Concrete Numbers

No vague claims.

Bad:
- "We significantly improved performance."
- "Utilization increased dramatically."

Good:
- "GPU utilization increased from 42% → 88%."
- "p99 latency dropped from 1.8s → 240ms."
- "Cost per 1M tokens reduced by 37%."

Anchor claims to:
- Hardware type (H100, A100, etc.)
- Model size (7B, 70B, etc.)
- Context length (8k, 32k, etc.)
- Baseline comparison

If there are no numbers, there is no credibility.

---

## 3. Tradeoffs

Every optimization has a cost.

State explicitly:
- What improved?
- What got worse?
- What constraint tightened?

Examples:
- Lower latency → higher memory usage
- Larger batches → worse tail latency
- Prefix clustering → SLA risk
- KV reuse → memory fragmentation

If tradeoffs are not discussed, depth is missing.

---

## 4. Failure Cases

Real systems break.

Include:
- What didn't work
- What assumptions were wrong
- What caused instability
- What was reverted

Failure adds credibility.

If everything worked perfectly, it feels theoretical.

---

## 5. Benchmarks

Always define the baseline.

Bad:
- "2x throughput improvement."

Good:
- "2x throughput compared to FIFO scheduling with fixed 50ms batch window."

Clarify:
- What was compared?
- Under what load?
- On what hardware?
- With what batch size?

Benchmarks without context are meaningless.

---

## 6. Scars

Posts must reflect lived experience.

Include:
- Surprises
- Unexpected bottlenecks
- Scheduler complexity
- Memory pressure
- Tail latency issues
- Token distribution variance

If the post could have been written without running a real system, it is not ready.

---

# Anti-Patterns To Avoid

## 1. Architectural Handwaving

Avoid:
- "We optimized performance."
- "We scaled efficiently."
- "Near 100% utilization."

Replace with measurable deltas.

---

## 2. Obviously Correct Advice

If the idea sounds like textbook knowledge:
- Priority queues
- Batching improves throughput
- Caching helps performance

Then either:
- Show non-obvious implementation details
- Show unexpected results
- Show when it fails

Otherwise it adds no value.

---

## 3. Perfect Systems

If your architecture looks clean and frictionless:
It is not believable.

Include:
- Coordination overhead
- Preemption cost
- Fragmented batches
- Memory pressure
- KV eviction behavior

Mess = credibility.

---

## 4. Missing Cost Framing

GPU infrastructure is economic infrastructure.

Include:
- Per-hour GPU cost
- Idle burn estimate
- Cost per million tokens
- Savings from optimization

Engineers care about performance.
Leaders care about cost.

Signal includes both.

---

## 5. Benchmark Without Context

Always define:
- Baseline system
- Load conditions
- Traffic pattern
- Token distribution
- Batch size
- Scheduling policy

Without this, improvements are ambiguous.

---

## 6. Ignoring Variance

Averages are insufficient.

Include:
- p50
- p95
- p99
- Token length distribution
- Burst patterns

Real systems are shaped by tail behavior.

---

## 7. Over-Abstraction

Avoid writing at a level that hides operational reality.

Mention:
- Model size
- Context window
- GPU class
- Memory constraints
- Batch sizes
- Queue behavior

Even anonymized systems need grounding.

---

## 8. Claiming 100% Utilization

Be precise about what utilization means:
- SM utilization?
- Memory bandwidth?
- GPU occupancy?
- Wall-clock saturation?

Precision matters.

---

## 9. Publishing Too Early

Before publishing:
- At least 3–5 strong posts exist
- About page is polished
- Positioning is clear
- The post includes numbers, tradeoffs, and scars

Your domain is your permanent record.

First impressions compound.

---

# Pre-Publish Checklist

Before publishing, verify:

- [ ] Does the first paragraph summarize the entire post?
- [ ] Are there at least 3 concrete numbers?
- [ ] Is the baseline clearly defined?
- [ ] Are tradeoffs explicitly stated?
- [ ] Is at least one failure or mistake included?
- [ ] Is cost impact discussed?
- [ ] Would a senior infra engineer learn something new?
- [ ] Could this have been written without running a real system?
      If yes → deepen it.

---

# Writing Standard

The bar is:

Not "informative."
Not "clear."

The bar is:

**Credible.**
**Grounded.**
**Battle-tested.**

If it doesn't feel earned, it's not ready.
