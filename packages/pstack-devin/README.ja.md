# pstack-devin

上流 [pstack](https://github.com/cursor/plugins) ワークフローパック
(`harness/pstack/claude-code`) を、固定した上流コミットにピン留めして
Devin CLI 向けに配布するパッケージ。

> 状態: 決定的ビルダー、Devin ランタイムアダプターのオーバーレイを
> 含む生成済み `devin-plugin/` ツリー、および最初の `.apm/`
> プリミティブ(`skills/setup-pstack-devin/`)はコミット済み。
> さらなる APM プリミティブは後続 Issue で追加予定。
> [親Issue](https://github.com/scarecrow173/apm-packages/issues/211)
> 配下の Issue チェーンを参照。

## 成果物と境界

このディレクトリには関連するが役割の異なる 2 つの成果物がある。

| 成果物 | 場所 | 利用者 | 内容 |
| --- | --- | --- | --- |
| APM パッケージ | `packages/pstack-devin/` | `apm install` 利用者 | `.apm/` 配下のアダプター/セットアップ用プリミティブ(`skills/setup-pstack-devin/` を同梱。残りは後続 Issue) |
| Devin Plugin | `packages/pstack-devin/devin-plugin/` | `devin plugins install` | バイト固定した上流 pstack ツリーと薄い Devin オーバーレイ(`scripts/pstack-devin` が生成。コミット済み) |

`apm.yml` の `targets:` は、このパッケージの APM プリミティブを受け取る
AI ランタイムを選択するだけであり、Devin CLI 対応を意味**しない**。
Devin は別途生成・配布される `devin-plugin/` ディレクトリを利用する。

## 上流ピン

`upstream.yml` が上流リポジトリ・パス・コミットの唯一の権威。
`apm.yml` には同じピンを `devDependencies` として記述し、
`apm.lock.yaml` が `resolved_commit` と `content_hash` を保証する。
3 つの値は常に一致しなければならず、不一致は警告ではなくハードエラー。

上流ファイルは、明示された上書き allowlist を除きバイト単位で同一。
検証済みの根拠は `docs/upstream-source-decision.md`、再現ログは
`docs/verification-apm-0.33.0.md` を参照。

## Devin ランタイムアダプター

生成されるプラグインには、Devin 上でのアダプターとして唯一の権威と
なる `docs/harness/devin.md` が同梱される。上流スキルが使う Cursor
のツール名や `Task` フィールド名(`Task` → `run_subagent`、
`AskQuestion` → `ask_user_question`、`subagent_type` → `profile`
など)を Devin ランタイムへ対応付け、上流の
`docs/harness/claude-code.md` アダプターと矛盾する場合はこちらが
優先される。常時有効なルート `AGENTS.md` がこれを指し示すが、
pstack 自体は opt-in — ユーザーが pstack スキルまたは
`/pstack:<name>` コマンドを呼び出さない限り何も有効化されない。

`overlay.yml` が強制し、`provenance.json` が記録するオーバーレイ
方針:

- `agents/poteto-agent.md` は Devin ネイティブな上書き(allowlist
  済み)。上流の `is_background` frontmatter と
  `generalPurpose`/`~/.cursor` 参照は機械解析されるプロファイル内に
  あり、指示レベルの適合では修正できない。
  `agents/comment-sicko.md` はバイト同一のまま — 純粋なペルソナ
  記述であり、そのまま Devin で有効。
- 外部スキル依存の `deslop`、`control-cli`、`control-ui` は
  `.cursor-plugin/` マニフェストのみを持つ `cursor-team-kit` に
  同梱されており、Devin プラグインとしてはインストールできない。
  APM consumer には実スキルが推移的に届く — `apm.yml` が上流と
  同一コミットにピンした仮想 `claude_skill` 依存として宣言し、
  ターゲットのスキルディレクトリ(Devin も読む `.agents/skills/`
  を含む)に展開される。`devin plugins install` 経路は依存を表現
  できないため、プラグイン consumer には引き続きアダプターの平文
  フォールバックが適用される。`docs/devin-adapter-decisions.md` を参照。

この対応付け契約は機械検証される: `audit:compat` スクリプトが生成
ツリーを走査し、未分類のハーネス API 参照があれば失敗する。上流に
新しい Cursor API が登場した場合、静かな破壊ではなく監査エラー
として表面化する。

```bash
mise exec -- pnpm --dir scripts/pstack-devin run audit:compat
```

## モデル設定: `/pstack:setup-pstack`

上流の `setup-pstack` スキルは薄い委譲オーバーライドとして同梱される。
Devin 上で `/pstack:setup-pstack` を呼び出すと
`skills/setup-pstack-devin/SKILL.md` を読み、それに従う。このスキルは
`devin models list` でモデルを検出し、推論バジェットを確認した上で
以下を生成する:

- `~/.devin/rules/pstack-models.md` — 常時有効なルール
  (`trigger: always_on`)。設定したロールごとに
  `role: slug[, slug…]` 行を 1 行ずつ持つ。
- `~/.config/devin/agents/pstack-<slug>.md` と `pstack-<slug>-ro.md` —
  ルールが名指しする各スラッグ用の、モデル固定カスタムサブエージェント
  プロファイル(書き込み用と read-only 意図宣言版)。Windows の
  agents ディレクトリは `%APPDATA%\devin\agents\`。

すべての演算とファイル出力は、スキル内に同梱される依存ゼロの Node
ヘルパー `scripts/setup.mjs` が担う(`node scripts/setup.mjs
parse|plan|apply`)。生成ファイルは `# pstack-generated:` sha256
マーカーを持つため、再実行はバイト安定であり、ユーザーによる編集は
明示的な確認が必要な diff として表示される。不要になった
`pstack-*.md` プロファイルの削除は、候補を一覧した上での明示的な
`--remove` のみで行われる。

ルールとプロファイルはセッション開始時にロードされるため、設定は
**新しい**セッションに適用される — 現在のセッションは現在のモデルの
まま。クラウドセッションはプラグインプロファイルをロードできない:
`pstack-*` プロファイルはローカル専用。

同じスキルが `.apm/skills/setup-pstack-devin/` として APM
利用者にもバイト同一で同梱される。`apm-sync` テストがこのコピーと
オーバーレイ元ソースの同一性を保証する。

## `devin-plugin/` の再生成

Plugin ツリーは Git にコミットされる生成物。リポジトリルートから
再生成・検証する:

```bash
mise exec -- pnpm --dir scripts/pstack-devin run build            # devin-plugin/ を再構築
mise exec -- pnpm --dir scripts/pstack-devin run check-generated  # コミット済みツリー == 再構築結果?
```

`check-generated` はスクラッチディレクトリへ再構築し、全ファイルを
バイト単位で比較する。差異があれば失敗する。記録済みの証跡は
`docs/build-verification.md` を参照。

## 検証

出荷ツリーを守る、決定的・無料・ローカルで完結するチェック群。
すべてリポジトリルートから実行する:

```bash
mise exec -- pnpm --dir scripts/pstack-devin run verify   # L1 + L2 + L3 + ユニットテスト
```

| コマンド | 証明する内容 |
| --- | --- |
| `run verify:l1` | ビルド整合性と配布安全性 — コミット済み `devin-plugin/` がピン留めした上流 + オーバーレイからバイト単位で再現できること、およびシークレット形状トークン・サイズ超過・実行ビット/マニフェストのずれがないこと |
| `run verify:l2` | 上流互換性と参照 — 全ハーネス API トークンが登録語彙に収まること、出荷ドキュメント内の全参照が実在の対象へ解決できること、消費側ロールラベル ⊆ `roles.json` キーであること |
| `run verify:l3` | 配布形状 — `.devin-plugin/plugin.json` スキーマ、`devin-plugin/` レイアウト、`.apm/` と `devin-plugin/` の非混同、`apm pack`/`apm compile` が記録済みの振る舞いを保つこと |
| `run probe:consumer` | **手動のみ** — 実 `apm` でスクラッチコンシューマーへインストールする(`--ref` の git 形式はネットワークが必要)。証跡は `docs/l3-verification.md` に追記される |

チェックごとの保証一覧は `docs/verification-matrix.md` を参照。
これらは静的チェックであり、出荷ツリーの一貫性とインストール可能な
形状を証明するものであって、エージェントの実行時品質を証明するもの
**ではない**。実 Devin CLI セッションの証跡は
`docs/runtime-verification.md`(`#218`)にある: スキルごとの
プローブと判定、および `## 5. Compatibility` の
互換性/サポートマトリクス。

## レイアウト

```text
packages/pstack-devin/
  apm.yml            # マニフェスト。cursor-team-kit の3スキル依存を含む。上流ツリーは `dependencies:` に含めない
  upstream.yml       # ピン留めした上流座標(唯一の権威)
  apm.lock.yaml      # `apm install` が生成。保証としてコミット
  docs/              # 検証ログと設計記録(メンテナー向け)
  overlay/           # 上流へ適用する Devin オーバーレイのソース(編集対象)
  overlay.yml        # オーバーレイの上書き allowlist(権威)
  devin-plugin/      # 生成される Devin Plugin 出力(コミット済み。手編集禁止)
  .apm/              # APM プリミティブ(skills/setup-pstack-devin/ を同梱。残りは後続)
```

## クイックスタート

1. Devin Plugin をインストールする(両導入経路は後述の
   [インストール](#インストール)を参照):

   ```bash
   devin plugins install scarecrow173/apm-packages#packages/pstack-devin/devin-plugin
   ```

2. **新しい** `devin` セッションを開始する — プラグインスキル、
   `pstack:*` エージェントプロファイル、生成済みルールはセッション
   開始時にロードされる。記録済みの全プローブはインストール後に
   開始したセッションで `/pstack:*` を解決した。実行中のセッション
   がインストールを取り込むかは未検証(`docs/runtime-verification.md`、
   `docs/migration.ja.md` §5)。
3. `/pstack:poteto-help` を呼び出す。`devin 3000.12.57`(Windows)
   で検証済み: スキルが解決し、本文がロードされ、適切な pstack
   ファイルへ誘導される(`docs/runtime-verification.md` §2)。

関連ドキュメント:

- `docs/runtime-verification.md` — スキルごとの実 CLI 証跡と
  互換性/サポートマトリクス。
- `docs/migration.ja.md` — 上流 `pstack` とこのディストリビュー
  ション間の切り替え: 名前衝突、バックアップ、ロールバック、
  設定ファイルの場所。
- `docs/verification-matrix.md` — 各決定的 `verify:*` チェックが
  証明する内容。
- `docs/distribution-verification.md` — 両プラグイン経路と APM
  経路のインストール/削除証跡。

## インストール

2 つの成果物に対応する 2 つの導入経路がある — 目的に応じて選ぶ:

| 経路 | コマンド | 得られるもの |
| --- | --- | --- |
| Devin Plugin | `devin plugins install scarecrow173/apm-packages#packages/pstack-devin/devin-plugin` | Devin CLI 上の完全な pstack — 全 `/pstack:*` スキル、`pstack:poteto-agent`/`pstack:comment-sicko` エージェント、常時有効な `AGENTS.md` ルール |
| APM パッケージ | `apm install pstack-devin@apm-packages`(`apm marketplace add scarecrow173/apm-packages` 実行後) | このパッケージの `.apm/` プリミティブのみ — 現時点では `setup-pstack-devin` スキル単体 |

`apm install` がデプロイするのは APM プリミティブだけであり、Devin
Plugin をインストール・有効化することはできない。ローカル
チェックアウトから入れる場合は Plugin ディレクトリを直接渡す —
`--local` はインストールをこのマシンに限定する:

```bash
devin plugins install /path/to/apm-packages/packages/pstack-devin/devin-plugin --local
```

削除は `devin plugins remove pstack`(`--local` で入れた場合は
`--local` を付ける)。上流 `cursor/plugins` にも `pstack` という名前の
Plugin があり、同時に入るのは 1 つだけ —
`devin plugins info pstack` で判別できる: このディストリビューションは
`version:` `0.1.0` と `scarecrow173/apm-packages` 配下の `source:` を
報告する。検証済みの導入証跡は
`docs/distribution-verification.md` を参照。2 つの `pstack`
プラグイン間の切り替えは `docs/migration.ja.md` を参照。
