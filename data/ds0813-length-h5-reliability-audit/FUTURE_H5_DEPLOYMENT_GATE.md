# 12. Future H5 deployment gate (design only)

No fourth H5 sample in this task.

Before **each** future quality sample, and immediately after **each** sample, the sampler must record:

- `origin/main` SHA
- deployed SHA
- deployment id
- deployment status

Compare the before/after tuples.

If deployment id, SHA, or status changes:

```
INFRA_CONTAMINATED=true
STOP remaining samples
NO retry
```

Do not classify that slot as model quality. Do not treat HTTP 200 / empty generating / Railway 502 during a replace as a model result.

This is the H5 A/B contamination rule, written as a hard gate rather than a post-hoc note.
