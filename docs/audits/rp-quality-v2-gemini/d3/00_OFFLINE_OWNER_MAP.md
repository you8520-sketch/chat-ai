# D3-0 Offline Owner Map (API=0)

## Authority answers

```json
{
  "1_length_owner": {
    "location": "USER_TAIL (after current user input)",
    "constant": "USER_TAIL_LENGTH_OWNER_SENTENCE",
    "file": "src/lib/responseLength.ts",
    "in_system_for_openrouter": false,
    "present_on_final_user_message": true
  },
  "2_scene_continue_owner": {
    "note": "No single dedicated 'continue scene' system section; scene continuity is implied by history + prose/layout. Layout owner = rule-output-layout-recency.",
    "primary_execution_owner": "rule-output-layout-recency → [OUTPUT LAYOUT]",
    "order_index": 6
  },
  "3_terminal_user_instruction_after_input": {
    "present": true,
    "layout_tail": true,
    "length_tail": true,
    "excerpt_tail": "ep narrating the user.\n[유저 지문/행동 — 캐릭터가 관찰 가능]\n멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.\n[유저 대사]\n저쪽이에요.같이 가요?\n\n레이아웃: 지문과 \"…\" 대사 사이 빈 줄(\\n\\n) 필수 — 지문 줄 끝에 대사 붙이지 말 것.\n\n이번 응답은 한국어 3,200~4,200자 범위의 하나의 밀도 있는 장면으로 전개한다. 현재 상호작용을 요약하거나 성급히 닫지 말고, 관찰·행동·대사·감각·심리가 서로 다음 변화를 일으키도록 충분히 전개한다."
  },
  "4_d2_continuity_vs_owners": {
    "d2_placement": "SYSTEM_TAIL (after narrative-pov-owner / final system sections)",
    "relative_to_output_layout": "AFTER [OUTPUT LAYOUT]",
    "relative_to_user_length_owner": "BEFORE user-tail length (system vs user role)"
  },
  "5_system_last_section": {
    "id": "narrative-pov-owner",
    "label": "Narrative POV owner (current-response terminal lock)",
    "marker": "[NARRATIVE POV OWNER: THIRD PERSON]",
    "order_index": 8
  },
  "6_content_vs_prose_boundary": {
    "note": "Production OpenRouter places prose-style-xml-bundle BEFORE volatile memory. Content-interpretation boundary for D3 C is therefore defined as immediately before [OUTPUT LAYOUT] (after active canon / private secret / status / speech), not before early prose.",
    "prose_order_index": 5,
    "persona_order_index": 4,
    "memory_order_indices": [],
    "output_layout_order_index": 6,
    "d3_c_insert": "immediately before [OUTPUT LAYOUT] (section rule-output-layout-recency)"
  }
}
```

## System section order (Gemini 3.1 Pro / OpenRouter MAIN RP)

| idx | id | marker | est_tok | semantic_owner |
|----:|----|--------|--------:|----------------|
| 0 | `openrouter-korean-prose-top` | [CANON / SCOPE / KNOWLEDGE] | 738 | CANON_SCOPE_RULES |
| 1 | `runtime-prompt-contamination-guard` | [PRIVATE OUTPUT HYGIENE] | 799 | OTHER_SYSTEM |
| 2 | `no-godmodding` | [USER CONTROL — COLLABORATIVE INTERACTIVE] | 409 | AGENCY |
| 3 | `character-core-identity` | [CHARACTER CANON — 에녹 MAY KNOW & ROLEPLAY] | 363 | CANON_SCOPE_RULES |
| 4 | `identity-and-rules` | [IDENTITY_AND_RULES] | 262 | PERSONA |
| 5 | `prose-style-xml-bundle` | [WEBNOVEL OUTPUT FORMAT] | 1572 | COMMON_PROSE |
| 6 | `rule-output-layout-recency` | [OUTPUT LAYOUT] | 670 | OUTPUT_LAYOUT |
| 7 | `user-persona-reference-owner` | [USER PERSONA REFERENCE OWNER — CURRENT TURN] | 545 | PERSONA |
| 8 | `narrative-pov-owner` | [NARRATIVE POV OWNER: THIRD PERSON] | 543 | DYNAMIC_TAIL_OWNER |

## Fingerprints

```json
{
  "absent": {
    "system_sha256": "4cd7b89abca4598b622ec4c6bd425f4e60d7401d0905987c722f229e1af45359",
    "messages_sha256": "7762181d1bc715ae09e32dd9c757171272e410ce1bb1e5b18297ace5d30672d6",
    "system_token_estimate": 5912,
    "user_tail_sha256": "5da99c515e0dcc6c86854f65c595c0dcf038578670b154deb8bc35ea44631443",
    "injected": false,
    "insert_marker": null,
    "continuity_index": -1,
    "output_layout_index": 4612
  },
  "terminal_system": {
    "system_sha256": "a46ec85d16d1389b8560975f1063c6d39c576f18bf47045c1879cd9ac7a6c355",
    "messages_sha256": "c898320339a8c8f2225110e70bacf39b54ea9d600b259a58c8ab341a8963f13b",
    "system_token_estimate": 6210,
    "user_tail_sha256": "5da99c515e0dcc6c86854f65c595c0dcf038578670b154deb8bc35ea44631443",
    "injected": true,
    "insert_marker": "SYSTEM_TAIL",
    "continuity_index": 6570,
    "output_layout_index": 4612
  },
  "context_boundary": {
    "system_sha256": "feb9851d8754ad9ddb432d0cd1e20ed85d2a3ec27e53bc5bce364fa4ebcabc30",
    "messages_sha256": "c28d675d61a3a16c0dfa61e052ecdc47e1422c9e597636d14c5b369c30f1c344",
    "system_token_estimate": 6210,
    "user_tail_sha256": "5da99c515e0dcc6c86854f65c595c0dcf038578670b154deb8bc35ea44631443",
    "injected": true,
    "insert_marker": "[OUTPUT LAYOUT]",
    "continuity_index": 4612,
    "output_layout_index": 4943
  }
}
```

context_boundary_preserves_other_sections: **true**
