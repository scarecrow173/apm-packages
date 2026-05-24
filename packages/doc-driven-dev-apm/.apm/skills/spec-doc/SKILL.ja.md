---
name: spec-doc
description: 実装前に、何を作るべきか、なぜ必要か、どの受け入れ基準を満たすべきかを YAML フロントマター + Markdown で定義、整理、承認、監査するときに使います。
license: MIT
---

# Spec Documentation Skill

この skill は、実装計画とタスクの起点になる仕様書を書くために使います。
spec は、何を作るべきか、なぜ必要か、誰のためか、何を範囲に含めるか、
何を含めないか、どの状態なら成功とみなすかを、コードを書く前に明確にします。

## ワークフロー

1. 既存ドキュメントを確認する。
   ディレクトリと命名規約は `references/spec-conventions.ja.md` に従います。
   `docs/specs/`, `docs/adr/`, `docs/plans/`, 関連コードを読み、既存の
   判断や仕様と矛盾しないようにします。
2. 人間と意図を確認する。
   目的、きっかけ、利用者、ユーザー価値、制約、非目標、受け入れ基準、
   出典を確認します。
3. spec を作成または更新する。

   ```bash
   node scripts/new_spec.js --title "Define checkout flow"
   ```

   作成スクリプトは `assets/templates/spec.md` を使います。スクリプトを
   実行できない場合は、このテンプレートをコピーして手動で埋めます。

4. YAML フロントマターに意味付き relation を記録する。
   外部出典や一次情報は `relations.source`、補助資料は
   `relations.references`、上流文書の詳細化は `relations.refines`、
   文脈上の関連は `relations.related` に記録します。
5. 実装計画に進む前に spec をレビューする。
   要件や受け入れ基準が曖昧な `draft` から plan を作らないでください。

## 必須内容

spec は次に答える必要があります。

- 何を作るべきか。
- なぜ今それが必要か。
- 誰が恩恵を受けるか。
- 何を範囲に含めるか。
- 何を明示的に範囲外にするか。
- どの挙動、インターフェース、ワークフロー、文書成果物が必要か。
- どの受け入れ基準で正しさを判断するか。
- どの出典、ADR、discovery note が根拠になったか。

このパッケージでは、spec がプロダクト意図と実装向け挙動を一つの文書で扱います。
プロダクト、ユーザー、価値、挙動、受け入れ基準に関する問いを別の要求文書に
分けず、`spec-doc` にルーティングします。

## フロントマター

生成される spec は YAML フロントマターを持ちます。

```yaml
---
id: "SPEC-0001"
type: "spec"
status: "draft"
title: "Define checkout flow"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
relations:
  source: []
  implements: []
  implemented-by: []
  depends-on: []
  blocks: []
  supersedes: []
  superseded-by: []
  related: []
  refines: []
  refined-by: []
  derives-from: []
  derived-by: []
  verifies: []
  verified-by: []
  references: []
---
```

ステータス値: `draft`, `proposed`, `approved`, `implemented`, `superseded`,
`rejected`。

## レビューチェックリスト

spec を `draft` から `proposed` または `approved` に進める前に、以下の全項目を
確認してください。いずれかのゲートに不合格なら、実装計画の前に修正が必要です。

| # | ゲート | 合格基準 |
|---|--------|----------|
| 1 | **課題が明文化されている** | 「UX 改善」ではなく、計測可能なギャップや痛みが具体的に述べられている。 |
| 2 | **対象者が特定されている** | 少なくとも 1 つの名前付きペルソナ、ロール、またはシステム利用者がある。 |
| 3 | **スコープが限定されている** | in-scope と out-of-scope の両方が明示的かつ非空である。 |
| 4 | **受け入れ基準がテスト可能** | 各基準が主観的判断なしに人間またはテストで検証できる。 |
| 5 | **実装が漏れていない** | spec は *何を* と *なぜ* を述べ、*どうやって* は書かない。技術選定は ADR や plan に記載する。 |
| 6 | **relation がリンクされている** | 関連する ADR、上流 spec、出典がフロントマター `relations` に記録されている。 |
| 7 | **矛盾がない** | 既存の spec や ADR と照合し、暗黙の上書きがない。 |
| 8 | **オーナーが割り当てられている** | `owners` フィールドが非空で、承認責任者が少なくとも 1 名いる。 |
| 9 | **ステータスが正しい** | フロントマター `status` が実際のレビュー状態を反映している。 |

## リソース

- `scripts/new_spec.js`: spec を作成し、索引を更新します。
- `references/spec-conventions.ja.md`: spec のディレクトリ、ファイル名、
  ステータス、relation、必須内容、索引の規約です。
- `assets/templates/spec.md`: 既定の spec 本文テンプレートです。
- `assets/templates/spec.ja.md`: 日本語で手動作成するときの spec 本文テンプレートです。
