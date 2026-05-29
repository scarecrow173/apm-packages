# Phase 3: Hardening and Rollout

## Task 7: 回帰テストと CI 相当の検証導線を整備する

**Description:**
共通プロトコル導入後の回帰を防ぐため、生成・更新・検証・置換後フローの統合テストを追加し、
通常コマンドで再現できる検証導線を確立する。

**Acceptance criteria:**

- [ ] プロトコル関連の正常系/異常系テストが追加される
- [ ] 2 つの flow 置換後シナリオをテストで再現できる
- [ ] ドキュメント lint と script build を含む検証手順が記録される
- [ ] `sdp query` の CLI 回帰テスト（正常系/該当なし/入力不正）が追加される
- [ ] query サブコマンド拡張手順がドキュメント化される

**Verification:**

- [ ] `pnpm run build:scripts` が通る
- [ ] `pnpm test` が通る
- [ ] `pnpm run lint:md` が通る

**Dependencies:** Task 5, Task 6

**Files likely touched:**

- `tests/skills/skill-discovery-protocol/*.test.ts`
- `package.json`
- `README.md` / `README.ja.md`

---

## Task 8: 旧プロトコルの整理と移行ガイドを提供する

**Description:**
旧 protocol 文書を deprecated 扱いにし、共通プロトコルへの移行方針・将来拡張方法を記述する。
他スキルが再利用しやすい導入テンプレートも追加する。

**Acceptance criteria:**

- [ ] 旧 protocol の位置づけが「即時 deprecated」で明記される
- [ ] 新規スキルが共通プロトコルを採用する手順が記載される
- [ ] 英日ドキュメントの記述が整合する

**Verification:**

- [ ] 移行ガイドのコマンド例が script-only で統一されている
- [ ] `pnpm run lint:md` が通る

**Dependencies:** Task 7

**Files likely touched:**

- `README.md` / `README.ja.md`
- `.apm/skills/skill-discovery-protocol/docs/migration.md`

---

## Checkpoint: Release Readiness

- [ ] `pnpm run build:scripts` 実行済み
- [ ] `pnpm test` 全 pass
- [ ] `pnpm run lint:md` 全 pass
- [ ] `implementation-flow` と `briefing-flow` の置換完了を人間レビューで承認
