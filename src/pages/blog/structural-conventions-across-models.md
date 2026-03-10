---
layout: '../../layouts/PostLayout.astro'
title: 'Structural Conventions: Why Claude Loves XML and GPT Loves JSON'
description: "Different models respond better to different formatting conventions. Here's what actually works across Claude, GPT, Llama, and others."
pubDate: '2026-03-10'
tags: ['machine learning', 'prompt-portability', 'llm']
---

You've probably noticed that prompts formatted one way work great on Claude but poorly on OpenAI models, or vice versa. Each model family has developed different formatting conventions, and they've learned to associate certain structures with certain behaviors.

*This post continues the prompt portability series. See [Chat Templates: The Hidden Interface Layer](/blog/chat-templates-hidden-interface/) for the related topic of how messages get formatted into tokens.*

## The Core Observation

When I ask Claude to extract data, specifying output format with XML tags works reliably:

```
Extract the product details from the following review.

Review: "Great laptop, 16GB RAM, got it for $999 on sale."

Return the result in this format:
<product>
  <name>...</name>
  <specs>...</specs>
  <price>...</price>
</product>
```

The same task on OpenAI models works better with JSON:

```
Extract the product details from the following review.

Review: "Great laptop, 16GB RAM, got it for $999 on sale."

Return JSON with this schema:
{
  "name": "string",
  "specs": "string",
  "price": "string"
}
```

Both prompts ask for the same thing with identical input framing. Only the output format specification differs—and that difference matters.

## Why Conventions Differ

Model providers make deliberate choices about training data, RLHF, and documentation. Anthropic's guides explicitly recommend XML tags for structured prompts. OpenAI's function calling and structured outputs use JSON schemas. These patterns likely reflect what each team optimized for during training and post-training.

The result: models develop learned defaults for certain patterns.

| Model Family | Preferred Structure | Notes |
|-------|--------------------|----|
| Claude | XML tags | Anthropic docs recommend XML; models follow it reliably |
| OpenAI (GPT-4o, o1) | JSON schemas | Function calling, structured outputs built around JSON |
| Llama 3 Instruct | Markdown/plaintext | More flexible but less consistent; see notes below |
| Gemini | Mixed | Supports both JSON and flexible formatting |

This isn't about capability—all these models can parse XML or JSON. It's about what triggers the most reliable behavior.

**A note on convergence**: Newer models across all families are getting better at following arbitrary format specifications. The gaps described in this post have narrowed compared to a year ago. Still, when a format fails unexpectedly, checking whether you're fighting the model's default conventions is a good first diagnostic.

## Structural Elements That Matter

### Output Format Specification

How you tell the model what format to return matters as much as the format itself.

**Claude** responds well to XML output templates:
```
<output_format>
<answer>Your answer here</answer>
<confidence>high/medium/low</confidence>
</output_format>
```

**OpenAI models** prefer JSON with explicit schemas:
```
Respond with JSON matching this schema:
{"answer": "string", "confidence": "high|medium|low"}
```

**Llama 3 Instruct** often works with simple markdown or bullet conventions:
```
Format your response as:
- Answer: [your answer]
- Confidence: [high/medium/low]
```

For Llama specifically: the base instruct models are more flexible than Claude or OpenAI models about format, which sounds good but means less predictable defaults. If you need strict formatting, consider constrained generation (grammar-based decoding) rather than relying on prompt instructions alone.

### Input Demarcation

How you separate user-provided content from instructions affects how reliably the model treats each part.

**Delimiters that work broadly:**
- Triple backticks (```) — universal, clear boundary
- Explicit labels ("User input:", "Document:") — simple and effective

**Delimiters that are model-specific:**
- `<user_input>` tags — strong on Claude, weaker elsewhere
- JSON objects for input — strong on OpenAI models

In my experience, triple backticks are the safest default when you need a prompt to work across models without modification.

### Reasoning Structure

How you ask for reasoning affects both quality and format of the response.

**Claude** follows explicit thinking tags:
```
<thinking>
Work through the problem step by step here.
</thinking>

<answer>
Final answer here.
</answer>
```

**OpenAI models** respond to natural language reasoning requests:
```
Think through this step by step, then provide your final answer on a new line starting with "Answer:".
```

**Llama 3 Instruct** responds to "Let's think step by step" but formatted reasoning output is less predictable than Claude or OpenAI. If you need structured reasoning (separate thinking and answer sections), explicit delimiters help but aren't as reliable.

## Common Migration Failures

### XML Tags Ignored on Non-Claude Models

A prompt like this works on Claude:

```
<instructions>
Classify the sentiment as positive, negative, or neutral.
</instructions>

<text>
I love this product!
</text>
```

On OpenAI models or Llama, the XML tags may be treated as literal text or partially ignored. The model understands the task but doesn't get the same structural cues.

**Fix**: Replace XML with explicit labels or JSON structure.

### JSON Schema Partially Followed

A prompt specifying exact JSON output:

```
Return exactly: {"sentiment": "positive|negative|neutral", "confidence": 0.0-1.0}
```

Works reliably on OpenAI models with structured outputs enabled. On Claude, it usually works but occasionally adds explanation around the JSON. On Llama, you might get the JSON embedded in prose.

**Fix**: On Claude, add "Return only the JSON, no explanation." On Llama, consider post-processing or use constrained generation if available.

### Nested Structure Depth

Complex nested outputs are harder to maintain across models:

```json
{
  "analysis": {
    "entities": [{"name": "...", "type": "...", "relations": [...]}],
    "summary": {"key_points": [...], "sentiment": {...}}
  }
}
```

OpenAI models handle deep nesting well with structured outputs. Claude handles it but may need reinforcement. Llama and other open-source models often struggle past 2-3 levels of nesting.

**Fix**: Flatten structures when possible, or break into multiple calls.

## What Transfers Well

Despite the differences, some structural patterns work across most models:

**Numbered lists for sequential tasks:**
```
1. First, identify the main topic
2. Then, extract key entities
3. Finally, summarize in one sentence
```

**Explicit section headers:**
```
## Task
Classify this text.

## Input
[text here]

## Output Format
One word: positive, negative, or neutral
```

**Clear examples (few-shot):**
```
Example 1:
Input: "Great product!"
Output: positive

Example 2:
Input: "Terrible experience."
Output: negative

Now classify:
Input: "It was okay, nothing special."
Output:
```

These work because they're structural patterns common in training data across all major models—they're not provider-specific conventions.

## Practical Approach to Migration

When moving a prompt from one model to another:

1. **Keep the semantic core unchanged** — The actual task description, domain terms, and examples transfer well. This is usually the easy part.

2. **Adapt the structural wrapper** — Replace XML tags with JSON schemas or vice versa based on target model. If you're moving from Claude to OpenAI, this is where the "XML Tags Ignored" failure above shows up.

3. **Test structured outputs first** — JSON extraction and formatted outputs break most visibly. If your structured output works, simpler text outputs usually will too. This catches the "JSON Schema Partially Followed" failure early.

4. **Simplify nesting** — If the original prompt has deeply nested output structure, consider flattening for better portability. Deep nesting is where the model family differences are most pronounced.

5. **Add format reinforcement** — "Return only JSON" or "No explanation needed" helps prevent format drift, especially on Claude (which tends to explain) and Llama (which may embed structured output in prose).

## Key Takeaways

1. **Structural conventions are model-specific** — Claude/XML, OpenAI/JSON, Llama/markdown reflect different training choices
2. **The same semantic task needs different structural wrappers** — This is expected, not a bug
3. **Some patterns are universal** — Numbered steps, clear examples, explicit headers work broadly
4. **Output format specification is the most fragile part** — Test this first when migrating
5. **Simpler structures port better** — Deep nesting is where models diverge most

Understanding these conventions lets you write prompts that migrate more easily—or at least tells you which parts need adaptation when they don't.

---

## References

1. Anthropic, "Prompt Engineering Guide" — https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering
2. OpenAI, "Structured Outputs" — https://platform.openai.com/docs/guides/structured-outputs
3. Meta, "Llama 3 Prompting Guide" — https://llama.meta.com/docs/how-to-guides/prompting
