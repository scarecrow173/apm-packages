---
name: adr-doc
description: MADR 4.0.0 を使い、コーディングエージェント向けの Architecture Decision Record を提案、作成、参照、監査、索引更新、移行計画、承認、却下、非推奨化、置き換え、規約適用するときに使います。判断がまだ曖昧なら、先に `deep-dive` を使います。
license: MIT
---

# ADR Documentation Skill

この skill は、コーディングエージェントが実行可能な仕様として
Architecture Decision Record を書くために使います。人間が判断を承認し、
エージェントが実装します。ADR には、エージェントが追加質問なしに正しく
コードを書けるだけの情報が含まれている必要があります。

この skill の中で行うのは、ADR を成立させるための狭い gap-fill 確認までです。
広い意図探索やソクラテス問答は `deep-dive` に切り出します。

## 基本思想

この skill で作成する ADR は、コーディングエージェントのための実行可能な
仕様です。

つまり、次の状態を目指します。

- 制約は明示的で、可能な限り測定可能である。
- 判断は実行可能な粒度で具体的である。例えば「データベースを使う」では
  なく「PostgreSQL 16 と pgvector を使う」と書く。
- 結果や影響は、具体的な後続タスクに結び付く。
- スコープが広がらないように non-goals を明記する。
- 暗黙知を前提にせず、ADR 単体で理解できる。
- ADR には Implementation Plan を含める。どのファイルを触るか、どの
  パターンに従うか、どのパターンを避けるか、どのテストを書くか、判断が
  正しく実装されたことをどう検証するかを書く。
- 判断の履歴を保存する。新しいテンプレートに合わせるためだけに、古い
  根拠を書き換えない。

## ADR を書くタイミング

このパッケージのライフサイクルでは、すべての意思決定を ADR として記録します。
ADR と spec は、プロダクト要件と技術判断の両方が明確になったとき、
同じ discovery output から並列で作成します。

- **brainstorming 中**: cross-cutting な規約、platform 選択。
- **spec 作成中**（並列）: 要件が技術判断を明らかにしたら、spec と並列で
  ADR を書きます。
- **計画中**: 実装アプローチに記録すべき選択が必要なとき。
- **実装中**: エージェントが architectural な分岐に遭遇したとき。

次のような判断では、ADR を書く、または提案します。

- システムの構築、連携、デプロイ、運用、拡張方法を変える。
- 依存関係、アーキテクチャパターン、インフラ選択、API 規約、
  データモデル、横断的なルールを導入する。
- コードを書いた後で戻しにくい。
- 将来このコードベースで作業する人間やエージェントに影響する。
- 検討され却下された現実的な代替案がある。
- 既存の accepted ADR と矛盾する、置き換える、または詳細化する。

次の場合は新しい ADR を作りません。

- 確立済みパターン内の通常の実装判断。
- 小さなバグ修正や誤字修正。
- すでに既存 ADR に記録されている判断。その場合は更新、置き換え、追記を
  検討する。
- linter や formatter で扱うスタイル上の好み。

迷う場合は、将来のコーディングエージェントが安全にコードを変更する前に
「なぜこの選択をしたのか」を知る必要があるなら、ADR に残します。

## 緊急修正シナリオ

緊急修正（本番障害対応、SLA 違反の恐れがあるケース）であっても、
技術判断を含む場合は最低限の ADR を残す。

緊急パスの条件:
- 通常の 4 フェーズを実行する時間がないことが客観的に説明できる。
- 緊急性の理由を ADR 本文に 1 行記載する。

緊急パスの手順:
1. タイトル、判断、理由、影響の 4 項目を含む簡潔な ADR を `status: "draft"` で
   作成する。
2. incident 解決後、Phase 0-3 を完了して `status` を `proposed` 以上に
   更新する。補完期限は incident 解決から 1 週間以内を目安とする。

緊急パスはあくまで例外であり、通常の作業には適用しない。

## エージェントの能動的トリガー

リポジトリでコーディング中に次の状況に出会ったら、作業を続ける前に ADR を
提案します。

- プロジェクトにまだ存在しない依存関係を追加しようとしている。
- エラー処理、データアクセス層、API 規約など、他のコードが従うべき新しい
  アーキテクチャパターンを作ろうとしている。
- 複数の現実的な代替案があり、トレードオフが自明ではない。
- accepted ADR と矛盾する変更をしようとしている。
- 局所的な実装説明ではなく、アーキテクチャ上の「なぜ」を長いコード
  コメントに書こうとしている。

提案するときは、どの判断に出会ったのか、なぜ重要なのか、それを ADR として
記録したいかを人間に確認します。

承認されたら、4 フェーズのワークフロー全体を実行します。承認されなかった
場合は、必要に応じて軽量なコードコメントや PR メモに残して作業を続けます。

## ADR 作成: 4 フェーズワークフロー

緊急修正シナリオ（上記）に該当する場合を除き、すべての ADR は
4 つのフェーズを通ります。フェーズを飛ばしてはいけません。

### Phase 0: コードベースを調査する

質問を始める前に、リポジトリから文脈を集めます。

1. 既存 ADR を探す。
   `references/adr-conventions.ja.md` のディレクトリ規約に従い、既存の
   ADR を読みます。次を確認します。
   - 既存規約: ディレクトリ、命名、テンプレート、索引の形式。
   - 新しい判断に関係する、または制約を与える判断。
   - 新しい ADR が置き換える、詳細化する、または関連付ける可能性がある
     ADR。
2. 技術スタックを確認する。
   `package.json`、`pnpm-lock.yaml`、`go.mod`、`requirements.txt`、
   `pyproject.toml`、`Cargo.toml`、または同等のファイルを読み、関連する
   依存関係とバージョンを確認します。
3. 関連するコードパターンを探す。
   判断が認証、ストレージ、ジョブ処理、API 形状、デプロイなど特定領域に
   関わる場合、既存実装を調査します。影響を受けるファイル、ディレクトリ、
   インターフェイス、テスト、パターンを特定します。
4. コードやドキュメント内の ADR 参照を確認する。
   コメント、ドキュメント、PR メモ、issue テンプレートから `ADR-NNNN`、
   ADR ファイル名、ADR ディレクトリへのリンクを探します。どの既存判断が
   どの領域を支配しているかを把握します。
5. 見つけたことを記録する。
   この文脈を Phase 1 に持ち込みます。質問の精度を上げ、新しい ADR が
   既存判断と矛盾しないようにします。

リポジトリに具体的な証拠がある場合、抽象的な要求だけから ADR を書いては
いけません。

### Phase 1: 意図を確認する

Phase 1 には 2 つのモードがあります。上流コンテキストの有無で選択します。

#### モード選択

```text
IF discovery artifact (docs/discovery/) OR spec (docs/specs/) がこの判断の
   コンテキストを既に含んでいる場合:
  -> Mode A: 上流から抽出する
ELSE (実装中にトリガーされた場合、横断的判断、または安全に文章化するには
   判断がまだ曖昧すぎる場合):
  -> Mode B: deep-dive または不足入力をリクエストする
```

#### Mode A: 上流から抽出する

brainstorming の discovery artifact または spec が既に存在する場合に使います。

1. **上流の artifact を全文読む。**
   判断に関連する部分を特定します: intent、constraints、options、
   recommendation、non-goals、open questions。

2. **上流の内容を ADR 構造にマッピングする:**
   - Title <- 上流の recommendation + 判断の説明
   - Trigger <- 上流の intent / "why now" / problem signals
   - Constraints <- 上流の constraints セクション
   - Options <- 上流の options セクション（トレードオフ付き）
   - Lean <- 上流の recommendation
   - Non-goals <- 上流のスコープ除外 / "Not Doing" リスト

3. **不足分だけを質問する**。上流に含まれていない情報だけを埋めます。
   典型的な gap-fill 質問:

   - この判断を知る、または承認する必要があるのは誰ですか。
     （MADR/RACI フロントマターのためのガバナンス情報。）
   - エージェントがこれを実装するには何が必要ですか。
     （影響するファイル、ディレクトリ、インターフェイス、依存関係、設定、
     テスト、従うパターン、避けるパターン、検証基準。）
   - brainstorming 作成後に浮上した制約やトレードオフはありますか。
   - 判断が正しく実装されたとどうやって証明しますか。

   gap-fill 質問は 1 つずつ行います。上流または Phase 0 で既に回答済みの
   ものは省略します。

4. **Intent Summary Gate へ進む**（下記）。

#### Mode B: deep-dive または不足入力をリクエストする

上流の brainstorming や spec が存在しない場合、または Phase 0 の証拠を
見ても判断がまだ曖昧で安全に ADR を書けない場合に使います。

`adr-doc` の中で広いソクラテス問答は行いません。代わりに、足りない判断材料を
要求するか、コードベースを踏まえた対話で判断自体を固める必要があるなら
`deep-dive` へ委譲します。

返す request の形式:

```markdown
ADR Missing Inputs

- Missing: <item>
  Why needed: <reason>
  Request from: <user | another agent | repository evidence>

Recommendation:
- Run `deep-dive`
- Ask the user directly
- Gather repository evidence from <path or area>
```

不足入力または `deep-dive` の要約が戻ったら、`adr-doc` に戻って通常の
ワークフローを再開します。

#### 適応的な追加質問（Mode A または deep-dive 後）

回答に応じて、ADR 本文としてまだ曖昧な部分だけを深掘りします。
よく使う質問:

- この判断が間違っていた場合、最悪の結果は何ですか。
- 6 か月後に何が起きたら再検討しますか。
- 明示的にやらないと決めていることはありますか。
- どの既存パターン、先行事例、accepted ADR と関係しますか。
- 既存 ADR またはコードパターンを見つけました。この新しい判断はそれと
  関係しますか。
- どのテストコマンド、手動レビュー、観測可能な挙動で正しく実装されたと
  証明できますか。

止めどき: Implementation Plan と Verification を含む ADR の全セクションを
推測なしに埋められる状態になったら十分です。まだ推測が残るなら、本文を
捏造せず不足入力を要求します。

#### Intent Summary Gate

Phase 2 に進む前に、確認した内容を構造化して要約し、
人間に確認または修正してもらいます。

```markdown
ADR に記録する内容は次の理解です。

- Title: {title}
- Trigger: {why now}
- Constraints: {list}
- Options: {option 1} vs {option 2} [vs ...]
- Lean: {which option and why}
- Non-goals: {what is explicitly out of scope}
- Related ADRs/code: {what exists that this interacts with}
- Affected files/areas: {where in the codebase this lands}
- Verification: {how we will know it is implemented correctly}

この理解で合っていますか。追加または修正する点はありますか。
```

人間がこの要約を確認するまで、Phase 2 に進んではいけません。

### Phase 2: ADR を作成する

1. ADR ディレクトリを選ぶ。
   `references/adr-conventions.ja.md` に従います。既存ディレクトリがある
   場合はそれを使います。ない場合、このパッケージでは既定で `docs/adr/`
   を作成します。
2. ファイル名戦略を選ぶ。
   既存 ADR が数字接頭辞を使っている場合は継続します。slug-only が既存
   規約ならそれに従います。
3. テンプレートを選ぶ。
   `references/template-variants.ja.md` に従います。
   - 既定では `full` を使います。
   - `minimal` は、単純、低リスク、局所的で、保存すべき意味ある
     トレードオフが少ない判断にだけ使います。
   - `bare` または `bare-minimal` は、既存リポジトリ規約がすでに本文の
     ガイダンスを提供している場合にだけ使います。
4. 確認済みの意図要約から各セクションを埋める。
   プレースホルダーを残してはいけません。必須セクションには実内容を
   書きます。任意セクションは有用な内容を書くか、テンプレート上許される
   場合にのみ削除します。
5. Implementation Plan を書く。
   これは agent-first ADR で最も重要なセクションです。次のエージェントに
   何をすべきかを正確に伝えます。関連する場合は、影響パス、依存関係、
   設定、従うパターン、避けるパターン、移行手順、互換性上の懸念、
   期待されるテストを書きます。
6. Verification をチェックボックスで書く。
   各項目は、エージェントがプログラムまたは手動で確認できる粒度にします。
7. 関連 ADR をフロントマターで接続する。
   `references/adr-conventions.ja.md` に従い、意味で選ぶ共通 `relations`
   field を使います。
8. ファイルを生成する。
   推奨は `scripts/new_adr.js` です。ディレクトリ検出、命名、
   テンプレート、メタデータ既定値、索引更新を扱います。スクリプトを実行
   できない場合は、`assets/templates/` からテンプレートをコピーして手動で
   埋めます。

推奨スクリプト例:

```bash
node scripts/new_adr.js --title "Adopt ADRs"
node scripts/new_adr.js --title "Use PostgreSQL" --template full --dir docs/decisions
node scripts/new_adr.js --title "Use local cache" --template minimal
```

### Phase 3: チェックリストでレビューする

ADR を作成したら、`references/review-checklist.ja.md` の agent-readiness
チェックリストでレビューします。

レビュー結果は、生チェックリストではなく要約として提示します。

```markdown
ADR Review

Passes:
- {文脈が自己完結している、Implementation Plan が影響ファイルを挙げている、
  Verification が確認可能である、など}

Gaps found:
- {具体的な不足。例: Implementation Plan がテストファイルに触れていない}
- {具体的な不足}

Recommendation:
{確定する / 不足を直す / 曖昧な部分について Phase 1 に戻る}
```

失敗点と注目すべき強みだけを出します。通過した全チェック項目を読み上げては
いけません。

不足がある場合は具体的な修正案を出します。問題を指摘するだけでなく、解決案を
提示して人間に承認を求めます。ADR がチェックリストを通るか、人間が明示的に
不足を受け入れるまで、確定してはいけません。

便利なレビューコマンド:

```bash
node scripts/review_adr.js --dir docs/adr
node scripts/audit_adr.js --dir docs/adr
node scripts/check_code_links.js --dir docs/adr
```

## Operational References

この entry skill は、ADR が必要かどうかを判断し、Phase 0-3 で作成または
レビューする部分に集中させます。拡張的な運用ガイダンスは次を参照します。

- `references/adr-maintenance.ja.md`: 既存 ADR の参照、accepted ADR の更新、
  index 保守、bootstrap、カテゴリ構成、script example。
- `references/template-variants.ja.md`: テンプレート選択の詳細。
- `references/review-checklist.ja.md`: agent-readiness のレビュー観点と
  review summary の期待形。

## 保守ルール

- ADR 規約の正本として `references/adr-conventions.ja.md` を扱う。
- ツール固有の安全な挙動とレビュー観点は `references/adr-maintenance.ja.md`
  を参照する。
- この skill では MADR 4.0.0 を ADR 専用の基準として扱う。
- 将来追加される ADR 以外の document skill には MADR ルールを適用しない。
- 既存 ADR があるリポジトリで `--write` を使う前に、明示的なユーザー確認を
  優先する。
- 履歴を保存する。古い根拠を書き換えず、文脈を追記する。

## Resources

### scripts

- `scripts/new_adr.js`: リポジトリ規約に従い、MADR テンプレートから新しい
  ADR を作成する。
- `scripts/list_adrs.js`: ADR メタデータ、ステータス、relations を一覧する。
- `scripts/audit_adr.js`: フロントマター、必須セクション、プレースホルダー、
  ローカルリンク、relation リンク、索引を検証する。
- `scripts/review_adr.js`: agent-readiness をレビューする。
- `scripts/check_code_links.js`: Implementation Plan のコード参照を確認する。
- `scripts/update_index.js`: ADR 索引を更新する。既定では dry-run。
- `scripts/relate_adr.js`: ADR relations を双方向に追加する。
- `scripts/migrate_report.js`: ファイルを書き換えず、MADR 4.0.0 へ寄せる移行
  アクションを報告する。

### references

- `references/adr-conventions.ja.md`: ディレクトリ、ファイル名、ステータス、
  relations、mutability、索引、カテゴリの規約。
- `references/template-variants.ja.md`: `full`、`minimal`、`bare`、
  `bare-minimal` の選択基準。
- `references/review-checklist.ja.md`: Phase 3 の agent-readiness チェック
  リスト。
- `references/adr-maintenance.ja.md`: 安全な既定動作と監査観点。
- `references/madr-4.ja.md`: MADR 4.0.0 の出典、ライセンス、テンプレート
  注記。

### assets

- `assets/templates/madr-4-full.md`: agent-first セクションを含む既定の full
  MADR テンプレート。
- `assets/templates/madr-4-minimal.md`: 単純で低リスクな判断向けの minimal
  MADR テンプレート。
- `assets/templates/madr-4-bare.md`: ガイダンス本文なしの full セクション構造。
- `assets/templates/madr-4-bare-minimal.md`: ガイダンス本文なしの minimal
  セクション構造。
