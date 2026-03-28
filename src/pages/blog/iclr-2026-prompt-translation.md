---
layout: '../../layouts/PostLayout.astro'
title: 'Our ICLR 2026 Paper: Automated Prompt Translation Across Foundation Models'
description: "We published a framework for automatically adapting prompts when switching between LLMs. Here's what we learned about prompt portability at scale."
pubDate: '2026-03-27'
tags: ['machine learning', 'prompt-portability', 'research']
---

Foundation models are upgraded faster than production systems can adapt. When you switch from one model to another (migrating from Claude to Llama, or upgrading within the same provider), prompts that worked reliably often break. This isn't a bug. It's inherent to how models differ.

Our paper, ["A Framework for Prompt Optimization and Translation Across Foundation Models"](https://openreview.net/forum?id=gOTCn5uZeE), addresses this problem head-on. It was accepted at the International Conference on Learning Representations (ICLR) 2026, one of the premier venues in machine learning research. I led this work as the first author, collaborating with researchers across Amazon Special Projects and Amazon Catalog AI.

The framework we developed reduces manual prompt engineering effort by 97% while matching expert-level performance. This has significant implications for organizations deploying LLMs at scale.

## The Problem in Detail

When you switch models, prompts break in predictable ways:
- **Chat template mismatches** cause role confusion and ignored instructions
- **Structural convention differences** break JSON outputs and formatting
- **System prompt sensitivity variations** change how strongly models follow constraints

I've written about these issues in [Chat Templates: The Hidden Interface Layer](/blog/chat-templates-hidden-interface/) and [Structural Conventions Across Models](/blog/structural-conventions-across-models/). This paper formalizes the problem and proposes an automated solution.

## The Core Contribution: A Novel Prompt Decomposition Framework

A key contribution of this work is a formal decomposition of prompts into three distinct components. To our knowledge, this framework has not been previously formalized in the literature:

**P = ⟨P_sem, P_struct, P_iface⟩**

| Component | What It Contains | Transfers? |
|-----------|------------------|------------|
| **P_sem** (Semantic) | Task definition, domain logic, labeling rules | ✅ Reliably |
| **P_struct** (Structural) | JSON schemas, output format, field constraints | ⚠️ Requires adaptation |
| **P_iface** (Interface) | Chat template, system role framing, decoding directives | ⚠️ Requires adaptation |

The key finding: **semantic content transfers reliably across models, but structural and interface specifications need targeted adaptation.**

This matches intuition. Telling a model "extract product attributes from this text" works everywhere. But telling it "return JSON with this exact schema using XML tags for structure" depends heavily on which model you're talking to.

## Automated Translation

Instead of manual prompt re-engineering (which we measured at ~60 person-days per model), we built an optimization framework that:

1. **Parses model capabilities** from provider documentation (context window, schema strictness, system sensitivity, etc.)
2. **Generates candidate prompts** by varying structural and interface components while keeping semantics frozen
3. **Evaluates candidates** on a development set with hard feasibility constraints (valid JSON, parseable output, policy compliance)
4. **Selects the best prompt** using a risk-aware objective that penalizes instability under stochastic decoding

The framework treats prompt adaptation as a structured search problem, not a creative writing exercise.

## Results: Large-Scale Empirical Validation

We conducted one of the most comprehensive cross-model prompt translation studies to date: 128K labeled instances across text and multimodal settings, spanning eight foundation models across multiple providers (Nova Lite/Pro/Premier, Claude 3.7/4 Sonnet, Mistral, QwQ-32B, Nemo). All results include 95% bootstrap confidence intervals for statistical rigor.

**Key findings:**

**1. Automated translation matches expert human prompts**

| Model | Human-Authored F1 | Auto-Translated F1 |
|-------|-------------------|-------------------|
| Nova Lite (images) | 77.35% | 77.25% |
| Nova Pro (images) | 76.94% | 77.73% |
| Nova Premier (images) | 77.54% | 79.00% |

Within margin of error, automated prompts perform as well as expert-authored ones. Sometimes better.

The Nova Premier result (79.00% vs 77.54%) is notable: the automated system found prompt configurations that human engineers missed. We attribute this to exhaustive search over structural variations that humans wouldn't try: small changes to schema enforcement wording, JSON field ordering, and constraint phrasing that compound into measurable gains. Human prompt engineers tend to stop iterating once something "works well enough."

**2. 97% reduction in manual effort**

Manual prompt engineering: ~60 person-days per model.
Automated translation: ~2 days of oversight.

The turnaround varies by model (1-6 days depending on schema strictness and system sensitivity), but the human effort is consistently minimal.

**3. Mid-tier models benefit most**

High-capacity models (Nova Premier, Claude) already handle interface mismatches reasonably well. Mid-tier models (Nova Lite, Nova Pro) show the largest gains from proper translation, up to +2.9 F1 points.

**4. Multimodal adaptation improves recall at higher cost**

Adding image inputs consistently improved recall (models could extract attributes from product images that weren't in text), but at 2-4x the inference cost. Whether that tradeoff is worth it depends on your application.

## Industry Impact and Practical Implications

This work has direct implications for any organization deploying LLMs in production. The cost of manual prompt re-engineering (which we measured at approximately 60 person-days per model migration) represents a significant operational burden as model ecosystems diversify and upgrade cycles accelerate.

For practitioners maintaining production LLM systems:

1. **Expect prompts to break on model upgrades.** This isn't a bug; it's inherent to how models differ.

2. **Semantic content is portable; structural formatting isn't.** When migrating, preserve your task definitions and domain logic, but be prepared to rewrite output format specifications.

3. **Test structured outputs first.** JSON extraction and schema compliance are where models diverge most. If those work, simpler outputs usually will too.

4. **Consider automation for multi-model deployments.** If you're supporting multiple model backends or upgrading frequently, manual re-engineering doesn't scale.

## What's Next

The paper focuses on structured prediction (attribute extraction with JSON outputs). The framework should generalize to other prompt-driven applications, but we haven't validated that yet.

Open questions we're exploring:

- **Automated discovery of model-specific conventions.** Currently we parse provider documentation to extract model characteristics. But documentation is often incomplete or outdated. Can we infer these properties empirically, probing a model with diagnostic prompts to learn its schema strictness, system sensitivity, and structural preferences automatically?

- **Tighter integration with constrained decoding.** Grammar-based generation (like Outlines or XGrammar) guarantees valid JSON at decode time, which could replace some of our feasibility constraints. The open question is whether constrained decoding shifts the optimal prompt structure. If the model knows it can't produce invalid JSON, does that change which instructions work best?

- **Continuous adaptation as models evolve.** Providers update models via API without version bumps. A prompt that worked yesterday might degrade today. Can we detect drift and trigger re-optimization automatically, without waiting for production failures?

## Read the Paper

The full paper is available on [OpenReview](https://openreview.net/forum?id=gOTCn5uZeE).

If you're working on similar problems (prompt portability, cross-model evaluation, or production LLM systems), I'd love to hear about your experience.

## Cite This Work

If you find this work useful, please cite:

```bibtex
@inproceedings{venkataraman2026framework,
  title={A Framework for Prompt Optimization and Translation Across Foundation Models},
  author={Venkataraman, Abhinav Shankaranarayanan and Nikolakopoulos, Athanasios N. and Kumaraswamy, Vishwanath and Zhang, Tao and Chander, Sarath and Saboo, Rohit and Khan, Suleiman A.},
  booktitle={International Conference on Learning Representations (ICLR) RSI Workshop},
  year={2026},
  url={https://openreview.net/forum?id=gOTCn5uZeE}
}
```

---

## References

1. Venkataraman, A.S., Nikolakopoulos, A.N., et al., "A Framework for Prompt Optimization and Translation Across Foundation Models" - ICLR 2026 RSI Workshop - https://openreview.net/forum?id=gOTCn5uZeE
2. Related posts: [Chat Templates](/blog/chat-templates-hidden-interface/), [Structural Conventions](/blog/structural-conventions-across-models/)
