---
name: apm-mcp-component-judge
description: MCP server、tool、resource、prompt 宣言を、自然言語 tool description quality、trust boundaries、capability disclosure、argument clarity、error semantics、production-safety assumptions の観点で評価する。モジュール式 APM パッケージ評価の専門 reviewer として使用する。
license: MIT
metadata:
  version: 0.2.0
  category: apm-semantic-review
  locale: ja
  localized_from: SKILL.md
---

# APM MCP 構成物 Judge

MCP 関連の構成物を意味論的に評価する。

## スコープ

以下をレビューする。

- MCP server declarations
- MCP tool descriptions
- MCP resource descriptions
- MCP prompt descriptions
- MCP capability を説明する package documentation
- agent-scoped MCP declarations

## ルーブリック: 100点

| 評価軸 | 最大 | 意味 |
|---|---:|---|
| M1 Capability Disclosure | 15 | MCP component が何をできるかを明確に述べている。 |
| M2 Tool Description Quality | 15 | purpose、arguments、constraints、side effects が明確である。 |
| M3 Trust Boundary | 15 | user/data/service trust assumptions が明示されている。 |
| M4 Least Capability | 10 | 必要最小限の operations だけを公開している。 |
| M5 Error & Failure Semantics | 10 | failures が理解可能で回復可能である。 |
| M6 Safety Against Misuse | 15 | prompt-injection、exfiltration、意図しない write risk を減らしている。 |
| M7 Operational Readiness | 10 | authentication、env vars、latency、availability が文書化されている。 |
| M8 Context Efficiency | 10 | tool descriptions が有用であり、肥大化していない。 |

## 検出すべき所見

- 曖昧な tool descriptions
- 不明確な side effects
- argument constraints の欠落
- 開示されていない write operations
- secret/env var の曖昧さ
- unsafe broad access
- error semantics の欠如
- model を誤誘導する tool names
- transitive capability surprise

## 出力

標準の component report format を使い、Type は `MCP` とする。
