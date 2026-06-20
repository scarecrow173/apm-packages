# plan-doc 委譲型実装ハンドオフ 計画

> **実装担当向け:** 依存関係グラフに独立した作業ストリームがある場合、既定の実装方式は委譲型またはサブエージェント対応です。追加エージェントや別実行コンテキストを起動する前に、必ずユーザー承認を得てください。承認されたら、現在の環境で利用可能な実装・委譲能力を発見し、最適な能力を task ごとに使ってレビュー checkpoint を挟みながら進めてください。ユーザー向け文面では、環境依存の具体的な skill ID を hardcode しないでください。

**目的:** `plan-doc` に、抽象的で環境中立なハンドオフ導線を追加し、生成される plan が委譲型/サブエージェント対応の実装を推奨し、ユーザー承認後のみ現在の環境で利用可能な実装能力へ委譲できるようにする。

**設計方針:** これは runtime の挙動変更ではなく、文書契約とテンプレートの変更として扱う。まず契約を固定する test を追加し、その後に英日両方の `plan-doc` の skill 文書、規約、テンプレートを並行して更新する。利用者ごとに導入済みの skill が異なる可能性があるため、配布される案内に具体的な外部 skill 名は書かない。

**技術スタック:** Markdown、Node.js `node:test`、APM skill アセット、PowerShell による検証コマンド。

---

## ファイル責務表

| File | Responsibility |
| --- | --- |
| `scripts/doc-driven-dev/tests/doc-suite.test.ts` | `plan-doc` が英日双方で抽象的な委譲型実装ハンドオフを案内し、環境依存の具体的な skill ID を hardcode しないことを保証する回帰テストを追加する。 |
| `packages/doc-driven-dev/.apm/skills/plan-doc/SKILL.md` | `plan-doc` がいつ委譲型/サブエージェント対応の実装を推奨し、実行前にユーザー承認をどう求めるかを説明する。 |
| `packages/doc-driven-dev/.apm/skills/plan-doc/SKILL.ja.md` | 上記ハンドオフ契約の日本語同期版。 |
| `packages/doc-driven-dev/.apm/skills/plan-doc/references/plan-conventions.md` | ハンドオフ節を plan 規約と承認準備条件の一部として明記する。 |
| `packages/doc-driven-dev/.apm/skills/plan-doc/references/plan-conventions.ja.md` | 規約更新の日本語同期版。 |
| `packages/doc-driven-dev/.apm/skills/plan-doc/assets/templates/plan.md` | 実装前に埋める生成済み plan の英語節を追加する。 |
| `packages/doc-driven-dev/.apm/skills/plan-doc/assets/templates/plan.ja.md` | 実装前に埋める生成済み plan の日本語節を追加する。 |

## スコープ境界

これは 1 つの実装ストリームです。対象は `plan-doc` の計画ガイダンスと生成される plan テンプレートに限定します。`scripts/doc-driven-dev/src/skills/plan-doc/scripts/new_plan.ts` の runtime 挙動は変更しません。`new_plan.js` はすでにテンプレートを読み込むためです。`implementation-flow` は、この変更が plan から実装へのハンドオフを準備するだけなので、テストで矛盾が見つかった場合を除き編集しません。

## 依存グラフ

| Step | Depends on | Blocks |
| --- | --- | --- |
| A. 契約テスト | 既存の文書とテンプレート | 英日文書の編集 |
| B. 英語文書とテンプレート | A | 日本語同期 |
| C. 日本語文書とテンプレート | B | 検証 |
| D. 検証 | A, B, C | 完了 |

クリティカルパスは A -> B -> C -> D です。

A の後は、ユーザーが委譲型実装を承認していれば、英日編集を別の実行コンテキストに分けられます。

## Task 1: 抽象的なハンドオフ契約の回帰テストを追加する

**Files:**

- Modify: `scripts/doc-driven-dev/tests/doc-suite.test.ts`

- [ ] **Step 1: 既存の doc 規約テストの近くに失敗するテストを追加する**

次の test を `doc conventions cover directory order, filenames, mutability, and subdirectory grouping` の直後に追加します。

```js
test("plan-doc recommends abstract delegated implementation handoff", () => {
  const planDocRoot = path.join(skillRoot, "plan-doc");
  const files = [
    "SKILL.md",
    "SKILL.ja.md",
    "references/plan-conventions.md",
    "references/plan-conventions.ja.md",
    "assets/templates/plan.md",
    "assets/templates/plan.ja.md",
  ];
  const disallowed = /REQUIRED SUB-SKILL|superpowers:|writing-plans|subagent-driven-development|executing-plans/i;

  for (const relative of files) {
    const text = fs.readFileSync(path.join(planDocRoot, relative), "utf8");
    assert.doesNotMatch(text, disallowed, `${relative} should not hardcode environment-specific skill IDs`);
  }

  const englishSkill = fs.readFileSync(path.join(planDocRoot, "SKILL.md"), "utf8");
  assert.match(englishSkill, /delegated or subagent-capable implementation/i);
  assert.match(englishSkill, /Ask the user for approval/i);
  assert.match(englishSkill, /discover the implementation and delegation capabilities\s+available in the current environment/i);

  const englishTemplate = fs.readFileSync(path.join(planDocRoot, "assets/templates/plan.md"), "utf8");
  assert.match(englishTemplate, /## Implementation Handoff/);
  assert.match(englishTemplate, /delegated or subagent-capable implementation/i);

  const japaneseSkill = fs.readFileSync(path.join(planDocRoot, "SKILL.ja.md"), "utf8");
  assert.match(japaneseSkill, /委譲型またはサブエージェント対応の実装/);
  assert.match(japaneseSkill, /ユーザー承認/);
  assert.match(japaneseSkill, /現在の環境で利用可能な実装・委譲能力/);

  const japaneseTemplate = fs.readFileSync(path.join(planDocRoot, "assets/templates/plan.ja.md"), "utf8");
  assert.match(japaneseTemplate, /## 実装ハンドオフ/);
  assert.match(japaneseTemplate, /委譲型またはサブエージェント対応の実装/);
});
```

- [ ] **Step 2: 対象テストを実行して失敗を確認する**

実行:

```powershell
pnpm --dir scripts/doc-driven-dev test -- --test-name-pattern "plan-doc recommends abstract delegated implementation handoff"
```

期待結果: 失敗。現在の `plan-doc` 文書とテンプレートには、新しいハンドオフ文言がまだ入っていないためです。

## Task 2: 英語版の plan-doc ガイダンスを更新する

**Files:**

- Modify: `packages/doc-driven-dev/.apm/skills/plan-doc/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/plan-doc/references/plan-conventions.md`
- Modify: `packages/doc-driven-dev/.apm/skills/plan-doc/assets/templates/plan.md`

- [ ] **Step 1: `SKILL.md` に workflow のハンドオフ規則を追加する**

workflow step 9 の後ろに次を追加します。

```markdown
10. Prepare implementation handoff.
    When the dependency graph contains independent work streams, recommend
    delegated or subagent-capable implementation as the default execution mode.
    Ask the user for approval before dispatching additional agents, remote
    automation, or separate execution contexts.

    If the user approves, discover the implementation and delegation capabilities
    available in the current environment, choose the capability that can execute
    plan tasks with review checkpoints, and proceed task-by-task. If no suitable
    capability is available, state that gap and continue inline with the same
    verification matrix.

    Do not hardcode environment-specific skill IDs in the plan. Describe the
    required capability instead: delegated implementation, independent task
    execution, review checkpoints, and verification before completion.
```

- [ ] **Step 2: `plan-conventions.md` に必須内容を追加する**

`## Required Content` に item 11 を追加します。

```markdown
11. An implementation handoff section that recommends delegated or
    subagent-capable implementation when tasks can run independently, asks for
    user approval before dispatch, and routes execution through capabilities
    discovered in the current environment instead of hardcoded skill IDs.
```

その後、`## Review Handoff` の前に次の節を追加します。

```markdown
## Implementation Handoff

Before implementation starts, plans should recommend delegated or
subagent-capable implementation when the dependency graph identifies independent
work streams. The recommendation is advisory until the user approves it.

Use this handoff sequence:

1. Identify independent tasks and review checkpoints from the dependency graph.
2. Ask the user whether delegated or subagent-capable implementation may be used.
3. If approved, discover the implementation and delegation capabilities
   available in the current environment.
4. Select the capability that can execute tasks independently, preserve review
   checkpoints, and run the verification matrix.
5. If no suitable capability exists or the user declines, execute inline with
   the same task order and verification requirements.

Do not name environment-specific skill IDs in reusable plans. Name the required
capabilities instead.
```

- [ ] **Step 3: `plan.md` に生成済み節を追加する**

`## Review Handoff` の前に次を追加します。

```markdown
## Implementation Handoff

- Recommended mode: <!-- inline execution or delegated or subagent-capable implementation -->
- Independent work streams: <!-- list task IDs or state none -->
- User approval required before dispatch: yes
- If approved: discover available implementation and delegation capabilities in the current environment, then execute task-by-task with review checkpoints.
- If declined or unavailable: execute inline using the same dependency graph and verification matrix.
```

- [ ] **Step 4: 英語側の更新が通るか確認し、必要なら日本語側はまだ失敗することを確認する**

実行:

```powershell
pnpm --dir scripts/doc-driven-dev test -- --test-name-pattern "plan-doc recommends abstract delegated implementation handoff"
```

期待結果: 英語の更新だけが入った状態なら、日本語の assert で失敗します。英語側で失敗するなら、日本語に進む前に英語文言を修正します。

## Task 3: 日本語版の plan-doc ガイダンスを同期する

**Files:**

- Modify: `packages/doc-driven-dev/.apm/skills/plan-doc/SKILL.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/plan-doc/references/plan-conventions.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/plan-doc/assets/templates/plan.ja.md`

- [ ] **Step 1: `SKILL.ja.md` に workflow のハンドオフ規則を追加する**

workflow step 9 の後ろに日本語版を追加します。

```markdown
10. 実装ハンドオフを準備する。
    依存グラフに独立して進められる作業ストリームがある場合は、
    委譲型またはサブエージェント対応の実装を既定の実行方式として推奨します。
    追加エージェント、リモート自動化、または別の実行コンテキストを起動する前に、
    必ずユーザー承認を得ます。

    ユーザーが承認した場合は、現在の環境で利用可能な実装・委譲能力を発見し、
    plan task をレビュー checkpoint 付きで実行できる能力を選んで、task ごとに
    進めます。適切な能力が見つからない場合は、その gap を明示し、同じ検証
    マトリクスを使って inline で実行します。

    plan には環境固有の skill ID を hardcode しないでください。必要な能力を、
    委譲型実装、独立 task 実行、review checkpoint、完了前検証として記述します。
```

- [ ] **Step 2: `plan-conventions.ja.md` に必須内容を追加する**

`## 必須内容` に item 11 を追加します。

```markdown
11. task を独立に進められる場合に委譲型またはサブエージェント対応の実装を
    推奨し、dispatch 前にユーザー承認を求め、hardcode した skill ID ではなく
    現在の環境で発見した能力へ実行を渡す実装ハンドオフ。
```

その後、`## レビュー用ハンドオフ` の前に次の節を追加します。

```markdown
## 実装ハンドオフ

実装開始前に、依存グラフから独立した作業ストリームを特定できる場合は、
委譲型またはサブエージェント対応の実装を推奨します。この推奨は、
ユーザーが承認するまでは助言に留まります。

ハンドオフは次の順序で行います。

1. 依存グラフから独立 task と review checkpoint を特定する。
2. 委譲型またはサブエージェント対応の実装を使ってよいかユーザーに確認する。
3. 承認された場合は、現在の環境で利用可能な実装・委譲能力を発見する。
4. task を独立に実行し、review checkpoint を保ち、検証マトリクスを実行できる
   能力を選ぶ。
5. 適切な能力がない場合、またはユーザーが承認しない場合は、同じ task 順序と
   検証要件で inline 実行する。

再利用される plan では、環境固有の skill ID を名指ししないでください。
代わりに必要な能力を名前で示します。
```

- [ ] **Step 3: `plan.ja.md` に生成済み節を追加する**

`## レビュー用ハンドオフ` の前に次を追加します。

```markdown
## 実装ハンドオフ

- 推奨方式: <!-- inline 実行、または委譲型またはサブエージェント対応の実装 -->
- 独立して進められる作業ストリーム: <!-- task ID を列挙する、または無しと書く -->
- dispatch 前のユーザー承認: 必須
- 承認された場合: 現在の環境で利用可能な実装・委譲能力を発見し、review checkpoint 付きで task ごとに実行する。
- 承認されない、または利用可能な能力がない場合: 同じ依存グラフと検証マトリクスを使って inline 実行する。
```

- [ ] **Step 4: UTF-8 の内容を明示的に確認する**

実行:

```powershell
Get-Content -Encoding utf8 packages/doc-driven-dev/.apm/skills/plan-doc/SKILL.ja.md | Select-String "委譲型またはサブエージェント対応の実装"
Get-Content -Encoding utf8 packages/doc-driven-dev/.apm/skills/plan-doc/references/plan-conventions.ja.md | Select-String "現在の環境で利用可能な実装・委譲能力"
Get-Content -Encoding utf8 packages/doc-driven-dev/.apm/skills/plan-doc/assets/templates/plan.ja.md | Select-String "## 実装ハンドオフ"
```

期待結果: それぞれ 1 行ずつ、読める日本語が表示されること。

## Task 4: フォーカスした検証と package-level 検証を実行する

**Files:**

- Verify: `scripts/doc-driven-dev/tests/doc-suite.test.ts`
- Verify: `packages/doc-driven-dev/.apm/skills/plan-doc/**`

- [ ] **Step 1: フォーカスした回帰テストを実行する**

実行:

```powershell
pnpm --dir scripts/doc-driven-dev test -- --test-name-pattern "plan-doc recommends abstract delegated implementation handoff"
```

期待結果: PASS。

- [ ] **Step 2: package の test suite を実行する**

実行:

```powershell
pnpm --dir scripts/doc-driven-dev test
```

期待結果: PASS。

- [ ] **Step 3: Markdown lint を実行する**

実行:

```powershell
pnpm --dir scripts/doc-driven-dev run lint:md
```

期待結果: PASS、または `plan-doc` に無関係な既存の baseline 指摘のみ。編集したファイルに起因する新規指摘があれば修正します。

- [ ] **Step 4: package compile dry-run を実行する**

実行:

```powershell
Push-Location packages/doc-driven-dev
apm compile --dry-run
Pop-Location
```

期待結果: 新しいエラーは出ないこと。package root 由来の既知の orphan warning が出る場合は、それは別件として報告します。

## リスク登録簿

| # | リスク | 発生可能性 | 影響度 | 緩和策 |
| --- | --- | --- | --- | --- |
| 1 | 案内文に、利用者の環境に存在しない外部 skill ID を誤って hardcode する。 | 中 | 高 | 具体名を避ける回帰テストを追加し、文書は capability ベースで表現する。 |
| 2 | 英日文書の意味がずれる。 | 中 | 中 | 対応する英日ファイルを同じ task で更新し、日本語は UTF-8 明示読みで確認する。 |
| 3 | テンプレートがユーザー承認なしの dispatch を促してしまう。 | 低 | 高 | 両テンプレートにユーザー承認必須の行を入れ、承認文言を test で固定する。 |
| 4 | plan 作成者が、委譲型実装の推奨を強制実行だと誤解する。 | 中 | 中 | ユーザーが拒否した場合、または適切な能力がない場合は inline 実行に戻すことを明記する。 |

## ロールバック戦略

移行や生成 JavaScript の変更はありません。ロールバックは、編集した 7 ファイルと test 更新を通常の git revert で戻す形です。ロールバック後の検証は `pnpm --dir scripts/doc-driven-dev test` です。

## レビュー用ハンドオフ

レビューで注目してほしい点:

- ユーザー向けガイダンスに、環境依存の具体的な実装 skill ID が一切書かれていないこと。
- 流れが承認ベースであること。まず委譲型/サブエージェント対応の実装を推奨し、次にユーザーに確認し、その後で利用可能な能力を発見すること。
- 日本語の文言が英語と意味的に揃っており、UTF-8 として正常に読めること。
- `implementation-flow` は後段の実行上の関心として残し、計画契約のために不要な編集をしていないこと。
