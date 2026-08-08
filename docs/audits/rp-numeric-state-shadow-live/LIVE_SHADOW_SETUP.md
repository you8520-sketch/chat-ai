# LIVE_SHADOW_SETUP

```text
admin_user_id = 5
character_id = 19
visibility = private
production_character_modified = false
definition_roundtrip = PASS
```

## Env (local pilot only)

```text
RP_NUMERIC_STATE_SHADOW_ENABLED=1
RP_NUMERIC_STATE_SHADOW_USER_IDS=5
RP_NUMERIC_STATE_SHADOW_CHARACTER_IDS=19
```

## Definitions

```json
{
  "affection": {
    "exists": true,
    "definition": {
      "version": 1,
      "mode": "server_meter",
      "min": 0,
      "max": 100,
      "initial": 20,
      "integer": true,
      "maxIncreasePerTurn": 5,
      "maxDecreasePerTurn": 5
    }
  },
  "trust": {
    "exists": true,
    "definition": {
      "version": 1,
      "mode": "server_meter",
      "min": 0,
      "max": 100,
      "initial": 30,
      "integer": true,
      "maxIncreasePerTurn": 5,
      "maxDecreasePerTurn": 5
    }
  },
  "corruption": {
    "exists": true,
    "definition": {
      "version": 1,
      "mode": "server_meter",
      "min": 0,
      "max": 100,
      "initial": 0,
      "integer": true,
      "maxIncreasePerTurn": 10,
      "maxDecreasePerTurn": 5
    }
  }
}
```

## Post-test

```text
RP_NUMERIC_STATE_SHADOW_ENABLED=0
Railway shadow enable = NEVER (local pilot only)
```
