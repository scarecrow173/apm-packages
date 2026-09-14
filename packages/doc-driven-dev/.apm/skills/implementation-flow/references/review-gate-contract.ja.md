# レビューゲート契約

## 目的

`implementation-flow` の Phase E レビューゲートは、コードを統合する前に
すべてのタスクが検証を通過することを保証します。この契約は canonical な
レビュースキルを規定し、命名のドリフトを防いで統合の安定性を維持します。

## Canonical レビュースキル

**正式スキル名**: `requesting-code-review`

このスキルは Phase E レビューゲート処理の権威ある実装です。Phase E
レビューワークフローへのすべての参照は、このスキル名に解決されなければ
なりません。

## Canonical な所在

- **Primary**: `packages/doc-driven-dev/.apm/skills/requesting-code-review/SKILL.md`
- **Alternative Context**: 外部環境のスキル（apm_modules や agent-toolkit
  経由など）

## 契約の拘束

1. **不変の名前**: スキル名 `requesting-code-review` は安定した契約です。
   変更には deprecation 通知と移行パスが必要です。
2. **Phase E の責務**: `implementation-flow` の Phase E は、レビューゲート
   適用のために `requesting-code-review` を明示的に呼び出します。
3. **スキル解決**: `skill-discovery-protocol` は、あいまいな探索を試みる
   前に、完全一致によるスキル名でこのスキルを解決します。
4. **失敗時の挙動**: スキルが発見できない場合、Phase E は canonical 名で
   不足スキルを特定する明確なエラーメッセージを出して即座に失敗します。

## 参照

- [implementation-flow SKILL.md](../SKILL.md) - Phase E のドキュメント
- [skill-discovery-protocol SKILL.md](../skill-discovery-protocol/SKILL.md) -
  スキル解決のセマンティクス

## テスト

回帰テストは以下を保証します。

- canonical 名の解決がドリフトしないこと。
- Phase E が曖昧さなくスキルを特定できること。
- 統合失敗が、命名の混乱ではなくスキルの可用性に起因することを追跡できる
  こと。

参照: `scripts/doc-driven-dev/tests/review-gate-contract.test.ts`

## 改正

**最終更新**: （このコミットの日付）
**改正回数**: 0
**ステータス**: Active
