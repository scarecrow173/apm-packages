# TODO: doc-driven-dev 設計フェーズ追加

## Phase 1: Foundation

- [ ] Task 1: 設計フェーズ方針（flow/status/relation）を定義する (M)
- [ ] Task 2: `design-doc` skill 骨格を追加する (M)

## Checkpoint: Foundation

- [ ] README/README.ja の新フロー表記が一致している
- [ ] `pnpm test` が pass
- [ ] `pnpm run lint:md` が pass
- [ ] 人間レビューで導入方針が承認された

## Phase 2: Core Vertical Slices

- [ ] Task 3: Vertical Slice A - `new_design` + index 更新を実装する (M)
- [ ] Task 3a: `docs/designs/overview.md` 自動生成と維持ルールを実装する (S)
- [ ] Task 4: Vertical Slice B - `brainstorming` routing に `design-doc` を追加する (S)
- [ ] Task 5: Vertical Slice C - `plan-doc` が `design-doc` を参照できるようにする (M)

## Checkpoint: Core Flow

- [ ] `brainstorming -> design-doc -> plan-doc` の最短経路が確認できる
- [ ] `spec + ADR -> design-doc -> plan-doc` の必須経路が適用される
- [ ] `pnpm test` が pass

## Phase 3: Hardening and Rollout

- [ ] Task 6: `doc-status` に `design` type を統合する (M)
- [ ] Task 7: 導入ガイドと移行メモを更新する (S)

## Checkpoint: Release Readiness

- [ ] `pnpm run build:scripts` 完了
- [ ] `pnpm test` pass
- [ ] `pnpm run lint:md` pass
- [ ] `apm compile --dry-run` 成功
- [ ] 互換性影響と移行方針が承認済み

---

## Review Questions

- [ ] 保存先を `docs/designs/` に固定してよいか
