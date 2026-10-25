# DeepSeek 0813 TRUE-OFF transport audit

Style evaluation is out of scope. Source Mirror and Completion are not re-run.

## Already known

`thinking={type:"disabled"}` is the current RP outbound. Style Track S1 produced hidden reasoning on 3/4 calls. Treat that form as requested-off only.

## Probe rules

- Inspect CI catalog + OpenAPI before any call.
- Do not send `enable_thinking` unless CI explicitly lists it.
- One transport field change per probe.
- Max 3 calls.
- True-off requires two consecutive calls with reasoning stream events=0 and reasoning chars=0.
