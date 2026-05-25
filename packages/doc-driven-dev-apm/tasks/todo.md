# TODO: 既存スキルのオーケストレーション責務削減

## Phase 1: Parallel Simplification

- [ ] Task 1: brainstorming — ルーティングセクション削除 (S)
- [ ] Task 2: idea-refine — ルーティング・フェーズ警告削除 (S)
- [ ] Task 3: design-doc — ライフサイクル文簡素化 (XS)
- [ ] Task 4: plan-doc — ライフサイクル文簡素化 (XS)

## Checkpoint: After Phase 1

- [ ] pnpm test 全 pass
- [ ] pnpm run lint:md pass
- [ ] 各スキルが自身のアーティファクト生成に集中している
- [ ] 人間レビューで削除範囲の妥当性確認

## Phase 2: Verification

- [ ] Task 5: 回帰テストと整合確認 (XS)

## Checkpoint: Complete

- [ ] pnpm test pass
- [ ] pnpm run lint:md pass
- [ ] apm compile --dry-run pass

---

## Review Questions

- [ ] Discovery テンプレート内 "Document Routing" チェックリストも削除するか
- [ ] spec-doc の軽微なライフサイクル言及も削除するか
- [ ] 参照文の表現（"see `doc-driven-dev-flow`"）を英日でどう統一するか
