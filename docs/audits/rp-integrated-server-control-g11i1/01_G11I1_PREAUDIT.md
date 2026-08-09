# G11-I1 Preaudit

**LIVE_CALL_READY:** YES

```json
{
  "checks": [
    {
      "id": "A",
      "domain": "true_calm_dyad",
      "expected": 4,
      "resolved": 4,
      "reason": "quiet_dyad",
      "demand": "LOW",
      "mode": "DYAD/HOLD",
      "intimate": false,
      "terminal_owners": 1,
      "expected_terminal": 1,
      "budget_match": true,
      "terminal_match": true,
      "wording_d3": true,
      "length_owner_present": true,
      "scene_pacing": 1,
      "scene_flow": 0
    },
    {
      "id": "B",
      "domain": "relationship_romance_dyad",
      "expected": 4,
      "resolved": 4,
      "reason": "quiet_dyad",
      "demand": "LOW",
      "mode": "DYAD/HOLD",
      "intimate": false,
      "terminal_owners": 1,
      "expected_terminal": 1,
      "budget_match": true,
      "terminal_match": true,
      "wording_d3": true,
      "length_owner_present": true,
      "scene_pacing": 1,
      "scene_flow": 0
    },
    {
      "id": "C",
      "domain": "exploration",
      "expected": 5,
      "resolved": 5,
      "reason": "exploration",
      "demand": "LOW",
      "mode": "EXPLORATION/LOCAL",
      "intimate": false,
      "terminal_owners": 1,
      "expected_terminal": 1,
      "budget_match": true,
      "terminal_match": true,
      "wording_d3": true,
      "length_owner_present": true,
      "scene_pacing": 1,
      "scene_flow": 0
    },
    {
      "id": "D",
      "domain": "operation_radio",
      "expected": 6,
      "resolved": 6,
      "reason": "communication_heavy",
      "demand": "HIGH",
      "mode": "EXPLORATION/LOCAL",
      "intimate": false,
      "terminal_owners": 1,
      "expected_terminal": 1,
      "budget_match": true,
      "terminal_match": true,
      "wording_d3": true,
      "length_owner_present": true,
      "scene_pacing": 1,
      "scene_flow": 0
    },
    {
      "id": "E",
      "domain": "ensemble_multi_cast",
      "expected": null,
      "resolved": null,
      "reason": "ensemble_uncapped",
      "demand": "HIGH",
      "mode": "ENSEMBLE/EXTERNAL",
      "intimate": false,
      "terminal_owners": 0,
      "expected_terminal": 0,
      "budget_match": true,
      "terminal_match": true,
      "wording_d3": true,
      "length_owner_present": true,
      "scene_pacing": 1,
      "scene_flow": 0
    },
    {
      "id": "F",
      "domain": "private_intimate_dyad",
      "expected": 4,
      "resolved": 4,
      "reason": "intimate_dyad",
      "demand": "LOW",
      "mode": "DYAD/HOLD",
      "intimate": true,
      "terminal_owners": 1,
      "expected_terminal": 1,
      "budget_match": true,
      "terminal_match": true,
      "wording_d3": true,
      "length_owner_present": true,
      "scene_pacing": 1,
      "scene_flow": 0
    }
  ],
  "party_probe": {
    "budget": {
      "maxBlocks": null,
      "reason": "ensemble_uncapped",
      "communicationDemand": "LOW"
    },
    "terminal": 0
  },
  "simulation_probe": {
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
    }
  }
}
```
