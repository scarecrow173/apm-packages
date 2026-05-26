# TODO: 外部スキルのクローンと doc-driven-dev 統合

## Phase 1: 方針確定

- [ ] Task 1: 適応方針の確定（命名・配置・リマッピング・日本語化ルール） (S)

## Checkpoint: 方針確定

- [ ] AGENTS.md にワークフロースキルの位置付けが明記されている
- [ ] 外部参照リマッピング表が確定し plan に記載済み
- [ ] 人間レビューで方針が承認された

---

## Phase 2: addyosmani/agent-skills からの移植

- [ ] Task 2: `source-driven-development` 移植・改変 (S)
- [ ] Task 3: `incremental-implementation` 移植・改変 (S–M)
- [ ] Task 4: `doubt-driven-development` 移植・改変 (M)

## Phase 3: obra/superpowers からの移植

- [ ] Task 5: `test-driven-development` 移植・改変 (M)
- [ ] Task 6: `systematic-debugging` 移植・改変 (L)
- [ ] Task 7: `subagent-driven-development` 移植・改変 (L)
- [ ] Task 8: `dispatching-parallel-agents` 移植・改変 (S)
- [ ] Task 9: `requesting-code-review` 移植・改変 (S–M)
- [ ] Task 10: `receiving-code-review` 移植・改変 (S)

## Checkpoint: 全スキル移植完了

- [ ] `.apm/skills/` 配下に 9 つの新規ワークフロースキルが存在する
- [ ] 全スキルに SKILL.md と SKILL.ja.md が揃っている
- [ ] supporting files (references, templates) が AD-3 の配置規約に従っている
- [ ] `pnpm run lint:md` pass
- [ ] `pnpm test` pass（既存テスト regression なし）

---

## Phase 4: 統合とリリース準備

- [ ] Task 11: `doc-driven-dev-flow` に実装フェーズスキル群を統合 (M)
- [ ] Task 12: AGENTS.md / README 更新と最終検証 (M)

## Checkpoint: リリース準備完了

- [ ] `pnpm test` pass
- [ ] `pnpm run lint:md` pass
- [ ] `pnpm run build:scripts` 成功（既存スキルに影響なし）
- [ ] `apm compile --dry-run` 成功
- [ ] ライセンス帰属が README に明記されている
- [ ] 人間レビューで統合が承認された

---

## Notes

- Phase 2 (Tasks 2–4) と Phase 3 (Tasks 5–10) は完全並行実行可能
- 各 Phase 内のタスクも互いに独立のため並行実行可能
- スコープ: S=Small, M=Medium, L=Large
