# AGENTS.ja.md

`packages/pstack-devin` を保守するエージェント向けガイド。

## パッケージの役割

`pstack-devin` は上流 `cursor/plugins` の
`harness/pstack/claude-code` ツリーを、フォークせずに Devin CLI へ配布
する。[apm.yml](./apm.yml) と [upstream.yml](./upstream.yml) を契約面
として扱い、`docs/` は利用者向けではなくメンテナー向けの証跡とする。

## 成果物の境界

- `.apm/` プリミティブ(現在は `skills/setup-pstack-devin/`、`#215` で
  追加)は APM 利用者向け。
- `devin-plugin/` は `scripts/pstack-devin` が生成する Git 追跡済みの
  Devin Plugin。手編集禁止。必ずビルドで再生成する。
- `apm.yml` の `targets:` は APM ランタイムのみを対象とする。`copilot`
  を必ず含めること: provenance 用の `devDependencies` エントリは
  `copilot` が有効ターゲットのときだけ解決される `agent_plugin`
  パッケージである。`copilot` の記載はピン確保以上の Copilot 対応を
  意味せず、Devin 対応を意味することもない。

## 上流ピンのルール

- `upstream.yml.upstream.commit` が上流スナップショットの唯一の権威。
  `apm.yml` の `devDependencies.apm[0].ref` と `apm.lock.yaml` の
  `resolved_commit` は常にこれと一致しなければならない。
- ピンの更新は `pnpm --dir scripts/pstack-devin run apply:update <sha>`
  (参照・ロックファイル・生成ツリー・verify をアトミックに1コミット)
  か週次 upstream-watch ワークフロー経由のみ — 詳細は
  `docs/upstream-updates.md`。ピンファイルだけを単独で書き換えては
  ならない。
- `apm.lock.yaml` の再生成はこのディレクトリ内での `apm install` のみ。
  手編集禁止。
- `apm_modules/`、`.github/`、`.claude-plugin/`、`build/` はローカルの
  インストール/pack 副作用であり、ignore を維持する。
- 上流ファイルは上書き allowlist(`skills/setup-pstack/SKILL.md` は
  `#215` で Devin 委譲エントリとして上書き済み、
  `agents/poteto-agent.md` は `#214` で Devin
  ネイティブプロファイルとして上書き済み。
  `docs/upstream-source-decision.md` と
  `docs/devin-adapter-decisions.md` 参照)を除きバイト単位で同一。

## 生成 `devin-plugin/` のルール

- `devin-plugin/` の再生成はリポジトリルートからの
  `pnpm --dir scripts/pstack-devin run build` のみ。
  `devin-plugin/` は生成物であり、手編集禁止。
- `overlay/` は編集対象のオーバーレイソース、`overlay.yml` は上書きの
  唯一の権威。オーバーレイパスが上流ファイルを置き換えられるのは
  `allow_overwrite:` に列挙された場合のみ。それ以外のパスは全て
  追加でなければならない。allowlist の拡張はポリシー変更であり、
  ついでに行わない。
- `provenance.json` は意図的にタイムスタンプを持たない。同一入力は
  バイト同一の出力を生まなければならず、時刻依存のフィールドを
  追加しない。
- 実行ビットは `git update-index --chmod=+x` でステージされる
  (build と `check` が自動で行う)。Windows 上で
  `core.fileMode=false` のままコミットされるためである。
  インデックスのモード集合は `provenance.executables` と
  一致しなければならない。
- `.markdownlint-cli2.jsonc` の `ignores` が `devin-plugin/**` を
  カバーする状態を維持する。生成バイトは作成ドキュメントではない。
- 現在のコミット済みツリーの証跡は `docs/build-verification.md` に
  記録済み。ピンやオーバーレイ契約を変更したら更新する。

## 編集ルール

- `README.md`/`README.ja.md` と `AGENTS.md`/`AGENTS.ja.md` の構造と意味を
  同期させる。
- 上流ツリーを `dependencies:` に追加しない。利用者は copilot 専用の
  `agent_plugin` 解決を継承し、他ターゲットで失敗する。
- ルートの `apm.yml`、`apm.lock.yaml`、marketplace ブロックを編集しない。
  登録は Marketplace Issue(`#217`)で扱う。
- `docs/` はメンテナー向けで英語のみ可。README と AGENTS は日英必須。
  例外は `docs/migration.md`: 利用者向けで日英両方 —
  `migration.ja.md` との同期を維持する。
- `apm install` がこのディレクトリの `.gitignore` に `apm_modules/` を
  追記することがあるが、それは想定内。

## 実行時の振る舞い(セッション開始時)

- プラグインスキル、`pstack:*` エージェントプロファイル、
  `~/.devin/rules/` ルールはセッション開始時にロードされる:
  インストールや `/pstack:setup-pstack` の実行は新しいセッションに
  適用される。記録済みの全プローブは `--local` インストール後に
  開始したセッションで実行した。実行中のセッションが
  インストールを取り込むかは未検証。
- pstack は opt-in: プラグインの常時有効 `AGENTS.md` はアダプター
  ドキュメントを指し示すだけで、`/pstack:<skill>` の呼び出しが
  あるまで何も有効化しない。非干渉コントロール実行
  (`docs/runtime-verification.md` §3.7)で実証済み: プラグイン
  導入済みでも通常プロンプトは通常の回答を返し、`pstack` の
  活動はゼロだった。
- 証跡マップ: 実 CLI プローブと判定は
  `docs/runtime-verification.md`(`## 5. Compatibility` が
  サポートマトリクス)。決定的チェックは
  `docs/verification-matrix.md`。利用者向け切り替え手順は
  `docs/migration.md`(日本語は `docs/migration.ja.md`)。

## 検証

このディレクトリから:

```bash
mise exec -- apm install --frozen   # lockfile/manifest の一致必須
mise exec -- apm compile --dry-run  # 消費者コンテキストのプレビュー
```

`apm compile --validate` が対象とするのは instruction/agent
プリミティブのみ。このパッケージはスキル
(`.apm/skills/setup-pstack-devin/`)を同梱するため、コマンドは "No
instruction files found" を報告して非ゼロ終了する —
リポジトリ内の他のスキルのみのパッケージと同じ結果であり、
パッケージの不具合ではなく「適用外」として報告する。

リポジトリルートから:

```bash
mise exec -- pnpm --dir scripts/pstack-devin test
mise exec -- pnpm --dir scripts/pstack-devin run lint:md
mise exec -- pnpm --dir scripts/pstack-devin run check-generated
mise exec -- pnpm --dir scripts/pstack-devin run audit:compat
```
