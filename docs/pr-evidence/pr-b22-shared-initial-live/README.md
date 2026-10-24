# B22 Shared Initial live extract

One Cheaper Inference call of production `runPostTurnSharedInitial` on a synthetic SAFE scene.

- Model: `gpt-6-luna`
- Temperature: 0.4
- Credential: `CHEAPER_INFERENCE_BENCHMARK_API_KEY` (distinct from the production key). Production key and OpenRouter key were unset for the process.
- Result file: `live.json` (system prompt, user block, JSON schema, provider text, parse, reconcile).
- Classification: valid fact, `content_route=safe`, insert 1.
- Billed: 0.000342 USD. Not a production user RP sample.
- Private character card and persona body were not included.
