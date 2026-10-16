### Header height (CSS px, `header.site-header`)

| viewport | BEFORE (guest/user) | AFTER (guest/user) | rows AFTER | `--site-header-height` AFTER |
|---|---|---|---|---|
| 360 | 110 / 110 | 98 / 98 | [52, 45] | 98 |
| 390 | 110 / 110 | 98 / 98 | [52, 45] | 98 |
| 575 | 110 / 110 | 98 / 98 | [52, 45] | 98 |
| 576 | 110 / 110 | 98 / 98 | [52, 45] | 98 |
| 768 | 110 / 110 | 98 / 98 | [52, 45] | 98 |
| 1023 | 110 / 110 | 98 / 98 | [52, 45] | 98 |
| 1024 | 65 / 65 | 65 / 65 | [64] | 65 |
| 1440 | 65 / 65 | 65 / 65 | [64] | 65 |

### Title (h1) left edge minus `main` left edge (0 = on the shared start line)

| page | 360px B→A | 390px B→A | 768px B→A | 1023px B→A | 1024px B→A | 1440px B→A |
|---|---|---|---|---|---|---|
| search-user | 0→0 | 0→0 | 0→0 | 0→0 | 0→0 | 0→0 |
| ranking-user | 0→0 | 0→0 | 0→0 | 0→0 | 0→0 | 0→0 |
| new-guest | 0→0 | 0→0 | 0→0 | 0→0 | 0→0 | 0→0 |
| chats | 0→0 | 0→0 | 0→0 | 0→0 | 0→0 | 0→0 |
| my-characters | 0→0 | 0→0 | 0→0 | 0→0 | 0→0 | 0→0 |
| studio | 16→0 **fixed** | 16→0 **fixed** | 16→0 **fixed** | 16→0 **fixed** | 16→0 **fixed** | 16→0 **fixed** |
| creator-dash | 0→0 | 0→0 | 0→0 | 51→0 **fixed** | 0→0 | 0→0 |
| creator-public | 0→0 | 0→0 | 0→0 | 0→0 | 0→0 | 12→0 **fixed** |
| settings | 0→0 | 0→0 | 0→0 | 52→0 **fixed** | 0→0 | 12→0 **fixed** |
| persona | 0→0 | 0→0 | 0→0 | 52→0 **fixed** | 0→0 | 12→0 **fixed** |
| points | 17→17 | 17→17 | 21→21 | 25→25 | 25.5→25.5 | 161→161 |

### Absolute main.left / title.left at 1440 and 390 (AFTER)

| page | 390 main.l | 390 title.l | 1440 main.l | 1440 title.l | 1440 content width |
|---|---|---|---|---|---|
| search-user | 16 | 16 | 288.5 | 288.5 | 1048 |
| ranking-user | 16 | 16 | 288.5 | 288.5 | 1048 |
| new-guest | 16 | 16 | 288.5 | 288.5 | 1048 |
| chats | 16 | 16 | 288.5 | 288.5 | 1048 |
| my-characters | 16 | 16 | 288.5 | 288.5 | 1048 |
| studio | 16 | 16 | 288.5 | 288.5 | 1049 |
| creator-dash | 16 | 16 | 288.5 | 288.5 | 1048 |
| creator-public | 16 | 16 | 288.5 | 288.5 | 1024 |
| settings | 16 | 16 | 288.5 | 288.5 | 1024 |
| persona | 16 | 16 | 288.5 | 288.5 | 1024 |
| points | 16 | 33 | 288.5 | 449.5 | 768 |

AFTER scenes with header-control overlap / horizontal overflow / error: none (144 scenes: 18 pages x 8 widths)
BEFORE: none
Active menu tab outside strip viewport AFTER: none; clipped tab labels AFTER: none
