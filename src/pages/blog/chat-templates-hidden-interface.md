---
layout: '../../layouts/PostLayout.astro'
title: 'Chat Templates: The Hidden Interface Layer'
description: "The same prompt behaves differently across models. The reason isn't the model weights - it's the chat template. Here's what you need to know."
pubDate: '2026-03-08'
tags: ['machine learning', 'prompt-portability', 'llm']
---

You copy a prompt from ChatGPT to Claude and it works differently. You migrate from GPT-4 to Llama and your structured outputs break. The model weights get all the attention, but the real culprit is often the chat template: the invisible formatting layer that transforms your messages into the token sequence the model actually sees.

Understanding chat templates is essential for anyone building production LLM systems, especially when migrating between providers or running open-source models.

## What Is a Chat Template?

When you send a message to an LLM API, you typically send structured data:

```python
messages = [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is 2+2?"},
]
```

But the model doesn't see this JSON. It sees a flat string of tokens. The chat template defines how to convert the structured messages into that string.

For example, Llama 3 produces something like:

```
<|begin_of_text|><|start_header_id|>system<|end_header_id|>
You are a helpful assistant.<|eot_id|><|start_header_id|>user<|end_header_id|>
What is 2+2?<|eot_id|><|start_header_id|>assistant<|end_header_id|>
```

While ChatML (used by many models) produces:

```
<|im_start|>system
You are a helpful assistant.<|im_end|>
<|im_start|>user
What is 2+2?<|im_end|>
<|im_start|>assistant
```

Same semantic content. Different token sequences. The model was trained on one format and expects that exact structure.

## Why Template Mismatch Breaks Things

When you use the wrong template, several things can go wrong:

**1. Role confusion**: The model doesn't recognize where user input ends and where it should respond. It may continue the user's message instead of responding.

**2. System prompt ignored**: Some templates treat system messages specially. Using the wrong format may cause your system prompt to be treated as user input.

**3. Output format degradation**: Models trained with specific templates learn associations between template structure and output behavior. JSON mode, for instance, often depends on template-specific training.

## System Role Sensitivity

Not all models treat system messages equally, and this varies more than most people expect.

In my experience working across model families, Claude tends to follow system prompt instructions most strictly—if you tell it to always respond in JSON, it will. GPT-4 respects system prompts but can be nudged by user messages. Llama 3 generally follows system instructions but is more susceptible to user-side overrides. Mistral treats system prompts more as suggestions than rules.

This matters for production systems. If your application relies on system prompt instructions (output format, persona, constraints), switching models may require reinforcing those instructions differently—sometimes by repeating key constraints in the user message, sometimes by using stronger language in the system prompt.

## Practical Implications

### When Using APIs

Most API providers handle templating for you. When you send:

```python
client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "system", "content": "..."},
        {"role": "user", "content": "..."}
    ]
)
```

The provider applies the correct template. You don't see it, but it's happening.

### When Running Open-Source Models

If you're running Llama, Mistral, or other open models locally, you must apply the correct template. HuggingFace transformers provides `apply_chat_template()`:

```python
from transformers import AutoTokenizer

tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3-8b-instruct")
prompt = tokenizer.apply_chat_template(messages, tokenize=False)
```

Using the wrong template (or no template) is a common source of poor performance with local models.

### When Migrating Between Providers

This is where template differences cause the most pain. A prompt optimized for Claude's XML conventions may underperform on Llama's INST format. The semantic content is the same, but the structural cues the model learned to follow are different.

Common migration issues:
- **JSON schema instructions** that worked on GPT-4 fail on Claude (different structured output conventions)
- **Role-playing prompts** that worked on Claude feel flat on Llama (different system prompt handling)
- **Chain-of-thought prompts** that worked on one model produce excessive verbosity on another (different reasoning training)

## What Transfers vs What Doesn't

From my experience migrating prompts across model families:

**Transfers well:**
- Core task description ("Extract product attributes from this text")
- Domain-specific terminology and definitions
- Examples and few-shot demonstrations (content, not format)

**Requires adaptation:**
- Output format instructions (JSON schema, markdown structure)
- System prompt framing and emphasis
- Verbosity and reasoning style directives
- Error handling instructions ("[NO]" vs "null" vs omitting fields)

This asymmetry is important: you can often reuse the semantic core of a prompt while adapting the structural wrapper for each model.

## Key Takeaways

1. **Chat templates are the hidden layer** between your API call and what the model sees
2. **Template mismatch causes silent failures** - the model runs but behaves unexpectedly  
3. **System prompt sensitivity varies** - don't assume behavior transfers across models
4. **Semantic content transfers better than structural formatting**
5. **When migrating models, adapt the wrapper, preserve the core**

Understanding templates won't solve all prompt portability problems, but it explains why the "same" prompt behaves differently across models and points toward what needs adaptation.

**Where to start**: If you're running open-source models locally, audit whether your serving code uses `apply_chat_template()`. If it doesn't, that's likely the first thing to fix. If you're using hosted APIs and migrating between providers, start by testing your most structured outputs (JSON schemas, specific formats) first—these break most visibly when template handling differs.

---

## References

1. HuggingFace, "Chat Templating" — https://huggingface.co/docs/transformers/main/chat_templating
2. Meta, "Llama 3 Model Card" — https://github.com/meta-llama/llama3/blob/main/MODEL_CARD.md
3. Anthropic, "Messages API" — https://docs.anthropic.com/en/api/messages
