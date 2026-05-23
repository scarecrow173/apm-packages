---
name: adr-doc
description: MADR 4.0.0 を使い、コーディングエージェント向けの Architecture Decision Record を提案、作成、参照、監査、索引更新、移行計画、承認、却下、非推奨化、置き換え、規約適用するときに使う。
license: MIT
---

# ADR Documentation Skill

この skill は、コーディングエージェントが実行可能な仕様として
Architecture Decision Record を書くために使います。人間が判断を承認し、
エージェントが実装します。ADR には、エージェントが追加質問なしに正しく
コードを書けるだけの情報が含まれている必要があります。

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

すべての ADR は 4 つのフェーズを通ります。フェーズを飛ばしてはいけません。

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

### Phase 1: 意図を確認する (Socratic)

人間にインタビューして判断空間を理解します。質問は一度に 1 つずつ行い、
前の回答を踏まえて深掘りします。質問リストを一括で投げてはいけません。

基本質問はおおむね次の順序です。文脈や Phase 0 ですでに明らかなものは
省略します。

1. 何を決めていますか。
   短く具体的なタイトルを得ます。「X を選ぶ」「Y を採用する」「Z を W に
   置き換える」のような動詞句を促します。
2. なぜ今ですか。
   何が壊れたのか、何が変わったのか、何もしないと何が壊れるのかを確認
   します。これが判断のトリガーです。
3. どの制約がありますか。
   技術スタック、期限、予算、チーム規模、既存コード、運用、コンプライ
   アンス、移植性、保守性などを具体的に確認します。Phase 0 で見つけた
   ことを参照し、「このリポジトリではすでに X を使っていますが、これは
   制約になりますか」のように質問します。
4. 成功はどのように見えますか。
   測定可能な結果を確認します。「動く」を超えて、レイテンシ、スループット、
   開発者体験、保守負荷、運用安全性、移行完了条件などを具体化します。
5. どの選択肢を検討しましたか。
   可能な限り、少なくとも 2 つの現実的な選択肢を確認します。各選択肢の
   主要なトレードオフを記録します。選択肢が 1 つしかない場合は、なぜ他の
   代替案が却下されたのかを言語化します。
6. 現時点ではどれに傾いていますか。
   推奨案と理由を確認します。ここで暗黙の優先順位が明らかになることが
   よくあります。
7. 誰が知る、または承認する必要がありますか。
   MADR/RACI フロントマターのために、decision-makers、consulted、
   informed を確認します。
8. エージェントがこれを実装するには何が必要ですか。
   影響するファイル、ディレクトリ、インターフェイス、依存関係、設定、
   テスト、パターンを確認します。従うべき既存パターン、避けるべきこと、
   判断に従って実装されたと証明する検証方法も確認します。

適応的な追加質問: 回答に応じて曖昧な部分を深掘りします。よく使う質問:

- この判断が間違っていた場合、最悪の結果は何ですか。
- 6 か月後に何が起きたら再検討しますか。
- 明示的にやらないと決めていることはありますか。
- どの既存パターン、先行事例、accepted ADR と関係しますか。
- 既存 ADR またはコードパターンを見つけました。この新しい判断はそれと
  関係しますか。
- どのテストコマンド、手動レビュー、観測可能な挙動で正しく実装されたと
  証明できますか。

止めどき: Implementation Plan と Verification を含む ADR の全セクションを
推測なしに埋められる状態になったら十分です。どこかで推測しているなら、
追加質問をします。

Intent Summary Gate: Phase 2 に進む前に、確認した内容を構造化して要約し、
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
   `references/adr-conventions.ja.md` に従い、`relations.supersedes`、
   `relations.superseded-by`、`relations.related`、`relations.refines` を
   使います。
8. ファイルを生成する。
   推奨は `scripts/new_adr.ts` です。ディレクトリ検出、命名、
   テンプレート、メタデータ既定値、索引更新を扱います。スクリプトを実行
   できない場合は、`assets/templates/` からテンプレートをコピーして手動で
   埋めます。

推奨スクリプト例:

```bash
node scripts/new_adr.ts --title "Adopt ADRs"
node scripts/new_adr.ts --title "Use PostgreSQL" --template full --dir docs/decisions
node scripts/new_adr.ts --title "Use local cache" --template minimal
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
node scripts/review_adr.ts --dir docs/adr
node scripts/audit_adr.ts --dir docs/adr
node scripts/check_code_links.ts --dir docs/adr
```

## 既存 ADR を参照するワークフロー

エージェントは、ADR があるコードベースで実装変更を始める前に既存 ADR を
読みます。これは ADR 作成ワークフローの一部ではなく、独立して実行すべき
参照操作です。

### ADR を参照するタイミング

- アーキテクチャ、データフロー、API 設計、インフラ、依存関係、横断的規約に
  触れる機能作業を始める前。
- コード内のパターンを見て「なぜこの方法なのか」と思ったとき。
- 既存判断と矛盾する可能性がある変更を提案する前。
- 人間が「ADR を確認して」「これに関する判断がある」と言ったとき。
- コードコメント、PR、issue、ドキュメントで ADR 参照を見つけたとき。

### ADR を参照する方法

1. ADR ディレクトリと索引を見つける。
   `scripts/list_adrs.ts` または `references/adr-conventions.ja.md` の
   ディレクトリ規約を使います。
2. タイトル、ステータス、relations を見る。
   active な判断である `accepted` ADR を中心に読みます。`superseded`、
   `deprecated`、`related`、`refines` の関係も確認します。
3. 関連 ADR を全文読む。
   タイトルだけで判断してはいけません。context、decision、consequences、
   non-goals、relations、Implementation Plan、Verification を読みます。
4. accepted decision に従う。
   accepted ADR が PostgreSQL を使うと定めているなら、それを置き換える
   ADR なしに MongoDB への変更を提案してはいけません。
5. Implementation Plan に従う。
   ADR が支配する領域でコードを実装するときは、Implementation Plan に
   書かれたパターンに従います。
6. 矛盾を報告する。
   コードと ADR が食い違う場合、勝手に片方を選ばず人間に報告します。
7. 作業内で ADR を参照する。
   発見性が上がる場合、コードコメントや PR 説明に軽量な ADR 参照を追加
   します。

便利なコマンド:

```bash
node scripts/list_adrs.ts --dir docs/adr
node scripts/audit_adr.ts --dir docs/adr
node scripts/review_adr.ts --dir docs/adr
node scripts/check_code_links.ts --dir docs/adr
```

## コードと ADR のリンク

ADR は、それが支配するコードと双方向にリンクされるべきです。

### ADR からコードへ

Implementation Plan セクションで、具体的なファイル、ディレクトリ、
パターンを挙げます。

```markdown
## Implementation Plan

- Affected paths: `src/db/`, `src/config/database.ts`, `tests/integration/`
- Pattern to follow: all database queries go through `src/db/client.ts`
- Pattern to avoid: direct database clients in route handlers
```

### コードから ADR へ

ADR に従ってコードを実装するときは、その判断の主要な入口に軽量なコメントを
追加します。

```typescript
// ADR-0004: Use SQLite for test database.
// See: docs/adr/0004-use-sqlite-for-test-database.md
import Database from "better-sqlite3";
```

参照は少なく保ちます。すべての行ではなく、入口に 1 つ置きます。目的は将来の
エージェントが判断を見つけられることです。

### なぜ重要か

- 支配される領域で作業するエージェントが、どの ADR が適用されるかを見つけ
  られる。
- ADR を読むエージェントが、それを実装するコードを見つけられる。
- ADR が置き換えられたとき、更新が必要なコードを見つけやすい。

## その他の操作

### 既存 ADR を更新する

1. 意図を特定する。
   - Accept / reject: status を変更し、必要なら最終文脈を追加する。
   - Deprecate: status を `deprecated` にし、置き換え先を説明する。
   - Supersede: 新しい ADR を作り、`relations` で双方向にリンクする。
   - Refine: 関連 ADR を作成または更新し、`relations.refines` を使う。
   - Add learnings: `## More Information` に日付付きで追記する。履歴は
     書き換えない。
2. 変更は狭くする。
   status 変更、relations 更新、日付付きメモは in-place 編集してよいです。
   古い根拠を現在風に書き換えてはいけません。
3. 編集後に検証する。

```bash
node scripts/audit_adr.ts --dir docs/adr
node scripts/review_adr.ts --dir docs/adr
node scripts/update_index.ts --dir docs/adr --write
```

relations 更新には `scripts/relate_adr.ts` を使います。

```bash
node scripts/relate_adr.ts --from 0002-new.md --to 0001-old.md --relation supersedes --write
```

### 承認後のライフサイクル

ADR が accepted になった後:

1. 実装タスクを作る。
   Implementation Plan の各項目と Consequences の follow-up は、issue、
   ticket、TODO など追跡可能なタスクにします。
2. PR で ADR を参照する。
   PR 説明に "Implements ADR-0004" のように ADR へのリンクを書きます。
3. コード参照を追加する。
   主要な実装ポイントに少数の ADR コメントを追加します。
4. Verification を確認する。
   実装完了後、Verification のチェックボックスを確認します。必要なら
   `## More Information` に結果を追記します。
5. 再検討トリガーを監視する。
   ADR に再検討条件が書かれている場合、その条件を監視します。

### 索引

リポジトリに ADR 索引ファイルがある場合、通常は `README.md` または
`index.md` なので更新します。推奨:

```bash
node scripts/update_index.ts --dir docs/adr --write
```

手動で更新する場合は、新しい ADR の bullet entry を追加し、リポジトリ規約に
沿った順序を保ちます。

### Bootstrap

ADR がないリポジトリに導入する場合、最初の ADR として、プロジェクトが ADR を
採用する理由を記録します。

```bash
node scripts/new_adr.ts --title "Adopt architecture decision records" --dir docs/adr
```

生成された ADR は、汎用的な boilerplate のままにせず、そのリポジトリ固有の
実際の文脈で編集します。手動編集後に索引を更新する必要があれば
`scripts/update_index.ts --write` を使います。

### Categories

ADR が多いリポジトリでは、サブディレクトリで整理できます。

```text
docs/adr/
  backend/
    0001-use-postgresql.md
  frontend/
    0001-use-react.md
  infrastructure/
    0001-use-terraform.md
```

番号はカテゴリごとにローカルです。分類方式は早めに選び、索引に記録します。
flat なディレクトリが見通しにくくなってきた場合だけ、アーキテクチャ層、
ドメイン、チームなどで分類します。

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

- `scripts/new_adr.ts`: リポジトリ規約に従い、MADR テンプレートから新しい
  ADR を作成する。
- `scripts/list_adrs.ts`: ADR メタデータ、ステータス、relations を一覧する。
- `scripts/audit_adr.ts`: フロントマター、必須セクション、プレースホルダー、
  ローカルリンク、relation リンク、索引を検証する。
- `scripts/review_adr.ts`: agent-readiness をレビューする。
- `scripts/check_code_links.ts`: Implementation Plan のコード参照を確認する。
- `scripts/update_index.ts`: ADR 索引を更新する。既定では dry-run。
- `scripts/relate_adr.ts`: ADR relations を双方向に追加する。
- `scripts/migrate_report.ts`: ファイルを書き換えず、MADR 4.0.0 へ寄せる移行
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

## Script Usage

対象リポジトリの root から実行します。

```bash
# Full ADR, default template
node /path/to/adr-doc/scripts/new_adr.ts --title "Choose database" --status proposed

# Minimal ADR for a simple local decision
node /path/to/adr-doc/scripts/new_adr.ts --title "Use local cache" --template minimal

# Explicit directory
node /path/to/adr-doc/scripts/new_adr.ts --title "Choose database" --template full --dir docs/decisions

# List and audit
node /path/to/adr-doc/scripts/list_adrs.ts --dir docs/adr
node /path/to/adr-doc/scripts/audit_adr.ts --dir docs/adr

# Review agent-readiness and code references
node /path/to/adr-doc/scripts/review_adr.ts --dir docs/adr
node /path/to/adr-doc/scripts/check_code_links.ts --dir docs/adr

# Update index
node /path/to/adr-doc/scripts/update_index.ts --dir docs/adr --write

# Relate ADRs
node /path/to/adr-doc/scripts/relate_adr.ts --from 0002-new.md --to 0001-old.md --relation supersedes --write

# Migration report only
node /path/to/adr-doc/scripts/migrate_report.ts --dir docs/adr
```

Notes:

- スクリプトは ADR ディレクトリとファイル名戦略を自動検出します。
- `--dir` でディレクトリ検出を上書きできます。
- 機械可読な出力が必要な場合は、reporting scripts で `--json` を使います。
- reporting scripts は既定ではファイルを書き換えません。
