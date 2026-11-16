# AGENTS.ja.md

`packages/pstack-devin` を保守するエージェント向けガイド。

## パッケージの役割

`pstack-devin` は上流 `cursor/plugins` の
`harness/pstack/claude-code` ツリーを、フォークせずに Devin CLI へ配布
する。[apm.yml](./apm.yml) と [upstream.yml](./upstream.yml) を契約面
として扱い、`docs/` は利用者向けではなくメンテナー向けの証跡とする。

## 成果物の境界

- `.apm/` プリミティブ(後続 Issue で追加)は APM 利用者向け。
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
- `apm.lock.yaml` の再生成はこのディレクトリ内での `apm install` のみ。
  手編集禁止。
- `apm_modules/`、`.github/`、`.claude-plugin/`、`build/` はローカルの
  インストール/pack 副作用であり、ignore を維持する。
- 上流ファイルは上書き allowlist(現時点では
  `skills/setup-pstack/SKILL.md` のみ。`docs/upstream-source-decision.md`
  参照)を除きバイト単位で同一。

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
- `apm install` がこのディレクトリの `.gitignore` に `apm_modules/` を
  追記することがあるが、それは想定内。

## 検証

このディレクトリから:

```bash
mise exec -- apm install --frozen   # lockfile/manifest の一致必須
mise exec -- apm compile --dry-run  # 消費者コンテキストのプレビュー
```

`apm compile --validate` には導入済みまたはローカルの APM プリミティブ
が必要。このパッケージが `.apm/` プリミティブを持たない間は、検証不能を
パッケージの不具合ではなく「適用外」として報告する。

リポジトリルートから:

```bash
mise exec -- pnpm --dir scripts/pstack-devin test
mise exec -- pnpm --dir scripts/pstack-devin run lint:md
mise exec -- pnpm --dir scripts/pstack-devin run check-generated
```
