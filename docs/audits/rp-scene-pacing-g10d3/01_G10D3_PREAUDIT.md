# G10-D3 Preaudit

**LIVE_CALL_READY:** YES

```json
{
  "Q4": {
    "mode": "DYAD/HOLD",
    "budget": {
      "maxBlocks": 4,
      "reason": "quiet_dyad",
      "communicationDemand": "LOW"
    },
    "terminal": 1
  },
  "E5": {
    "mode": "EXPLORATION/LOCAL",
    "budget": {
      "maxBlocks": 5,
      "reason": "exploration",
      "communicationDemand": "LOW"
    },
    "terminal": 1
  },
  "C6": {
    "mode": "EXPLORATION/LOCAL",
    "budget": {
      "maxBlocks": 6,
      "reason": "communication_heavy",
      "communicationDemand": "HIGH"
    },
    "terminal": 1
  },
  "party": {
    "budget": {
      "maxBlocks": null,
      "reason": "ensemble_uncapped",
      "communicationDemand": "LOW"
    },
    "terminal": 0
  },
  "simulation": {
    "budget": {
      "maxBlocks": null,
      "reason": "ensemble_uncapped",
      "communicationDemand": "LOW"
    },
    "terminal": 0
  },
  "false_positive": {
    "mode": "DYAD/HOLD",
    "budget": {
      "maxBlocks": 4,
      "reason": "quiet_dyad",
      "communicationDemand": "NORMAL"
    },
    "terminal": 1
  }
}
```
