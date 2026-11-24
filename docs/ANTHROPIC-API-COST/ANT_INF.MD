# ANTHROPIC API

`$ANTHROPIC_API_KEY`

```bash
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-haiku-5-5",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello, how are you?"}]
  }'
```
