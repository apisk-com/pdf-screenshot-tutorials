```markdown
## Retry plan for the payment webhook

Retry with exponential backoff and jitter. 🚀

| Attempt | Delay | Note |
|---|---|---|
| 1 | 1 s | First retry<br>No jitter |
| 2 | 2 to 4 s | Jitter on |
| 3 | 4 to 8 s | Last try, then send an alert |

```python
def backoff(attempt, base=1.0, cap=30.0): return min(cap, base * 2 ** attempt) * random.uniform(0.5, 1.0)  # full jitter: clients do not retry at the same moment
```

Do not retry a `400` response. <b>Fix the payload first.</b>
```
