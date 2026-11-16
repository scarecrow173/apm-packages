# pstack-devin

上流 [pstack](https://github.com/cursor/plugins) ワークフローパック
(`harness/pstack/claude-code`) を、固定した上流コミットにピン留めして
Devin CLI 向けに配布するパッケージ。

> 状態: 決定的ビルダーは実装済みで、Devin ランタイムアダプターの
> オーバーレイを含む生成済み `devin-plugin/` ツリーはコミット済み。
> APM `.apm/` プリミティブは後続 Issue で追加予定。
> [親Issue](https://github.com/scarecrow173/apm-packages/issues/211)
> 配下の Issue チェーンを参照。

## 成果物と境界

このディレクトリには関連するが役割の異なる 2 つの成果物がある。

| 成果物 | 場所 | 利用者 | 内容 |
| --- | --- | --- | --- |
| APM パッケージ | `packages/pstack-devin/` | `apm install` 利用者 | `.apm/` 配下のアダプター/セットアップ用プリミティブ(後続 Issue で追加) |
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
  アダプターはバンドルせず、平文による同等パスのフォールバックを
  規定する。`docs/devin-adapter-decisions.md` を参照。

この対応付け契約は機械検証される: `audit:compat` スクリプトが生成
ツリーを走査し、未分類のハーネス API 参照があれば失敗する。上流に
新しい Cursor API が登場した場合、静かな破壊ではなく監査エラー
として表面化する。

```bash
mise exec -- pnpm --dir scripts/pstack-devin run audit:compat
```

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

## レイアウト

```text
packages/pstack-devin/
  apm.yml            # マニフェスト。上流を `dependencies:` には含めない
  upstream.yml       # ピン留めした上流座標(唯一の権威)
  apm.lock.yaml      # `apm install` が生成。保証としてコミット
  docs/              # 検証ログと設計記録(メンテナー向け)
  overlay/           # 上流へ適用する Devin オーバーレイのソース(編集対象)
  overlay.yml        # オーバーレイの上書き allowlist(権威)
  devin-plugin/      # 生成される Devin Plugin 出力(コミット済み。手編集禁止)
  .apm/              # APM プリミティブ(後続 Issue で追加)
```

## インストール

未公開。APM と Devin の各導入経路と既知の制限は、Issue チェーンの
後続 Issue で検証・文書化される。
