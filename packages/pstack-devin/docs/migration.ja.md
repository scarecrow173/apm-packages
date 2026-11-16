# 移行ガイド — 上流 `pstack` ↔ `pstack-devin`

上流 `cursor/plugins` とこのパッケージは、どちらも `pstack` という
名前の Devin Plugin を提供する。同時にインストールできるのは 1 つ
だけで、2 つ目は名前で衝突する。`/pstack:` スキル接頭辞は
インストールされている側に属する。このガイドは、導入済み側の
識別、切り替え前のバックアップ、切り替え、ロールバックを扱う。

証跡: インストール/削除/来歴確認のコマンドと出力は
`distribution-verification.md` に記録済み(§2 ソース構文、
§3 ローカルパス、§4 GitHub パス、§5 APM パス、§6 名前衝突)。
実行時の振る舞いは `runtime-verification.md` に記録済み。これらの
ログで実測していない事項は本文でその旨を明記する — 記録のない
振る舞いは主張しない。

範囲メモ: このガイドが扱うのは **Devin Plugin** のみ。`apm install`
がデプロイするのはこのパッケージの `.apm/` プリミティブ(現時点では
`setup-pstack-devin` スキル単体)であり、Devin Plugin の
インストール/削除は一切行わない — `distribution-verification.md`
§5 を参照。

## 1. 導入済みの `pstack` を識別する

```bash
devin plugins list
devin plugins info pstack
```

同名を判別するのは `info` の来歴フィールド
(`distribution-verification.md` §6 に記録):

| フィールド | `pstack-devin`(このパッケージ) | 上流 `cursor/plugins` |
| --- | --- | --- |
| `version:` | `0.1.0` | `0.15.42` |
| `source:` | `https://github.com/scarecrow173/apm-packages#packages/pstack-devin/devin-plugin`、または `--local` インストール時に使ったローカルパス | `https://github.com/cursor/plugins#…` |
| スキルマーカー | `/pstack:setup-pstack-devin` が存在 | `setup-pstack-devin` スキルなし |

複数のインストール済みプラグインが同名を共有する場合、
`devin plugins remove` は `owner/repo` による曖昧性解消ラベルを
受け付ける(`remove --help` より。
`distribution-verification.md` §6 に記録)。

## 2. 切り替え前のバックアップ

1. `devin plugins list` と `devin plugins info pstack` を実行し、
   `version:`/`source:` の出力を保存する — 復元すべき状態の記録。
2. `/pstack:setup-pstack` を実行したことがあれば、プラグイン
   ツリー外に生成されたファイル(場所は §4)を確認し、別の場所へ
   コピーする — 上流へのロールバックでは再利用されず、保持するか
   削除するかは利用者の判断となる(§4)。
3. 切り替えはセッション境界で行う: 実行中の `devin` セッションは
   先に完了させるか破棄する(§5 参照)。

## 3. `pstack-devin` への切り替え

1. 現在の `pstack` を、インストール時と同じスコープで削除する —
   パーソナルプラグインへのインストールなら
   `devin plugins remove pstack -y`、`--local` インストールなら
   `devin plugins remove pstack --local -y`。スコープの対応は強制
   される: `remove --local` はパーソナルプラグインに登録された
   プラグインには失敗する(`distribution-verification.md` §2)。
2. このディストリビューションをインストールする:

   ```bash
   # パーソナルプラグインスコープ(クラウドセッションや他デバイスへ同期対象)
   devin plugins install scarecrow173/apm-packages#packages/pstack-devin/devin-plugin -y

   # またはローカルチェックアウトから、このマシン限定で
   devin plugins install /path/to/apm-packages/packages/pstack-devin/devin-plugin --local -y
   ```

3. **新しい** `devin` セッションを開始する(§5)。
4. 確認: `devin plugins info pstack` が `version:` `0.1.0` を報告し、
   新しいセッションで `/pstack:poteto-help` が解決できる —
   この呼び出しは `runtime-verification.md` §2 で端から端まで
   検証済み。

## 4. プラグインの外に配置される設定ファイル

`/pstack:setup-pstack`(`setup-pstack-devin` スキル)が書き込むのは
プラグインのファイルではなくユーザー設定。記録済みの
`devin plugins remove` が削除するのはプラグインの登録であり、
以下のファイルはプラグインの管理範囲外にあるため、削除や
切り替えの後に保持するか削除するかは利用者が決める:

| 対象 | 場所 |
| --- | --- |
| モデルルール | `~/.devin/rules/pstack-models.md` — 常時有効ルール(`trigger: always_on`)。設定したロールごとに `role: slug[, slug…]` 行を 1 行ずつ持つ |
| モデル固定サブエージェントプロファイル | Devin 設定ルート配下の `agents/` 内の `pstack-<slug>.md` と `pstack-<slug>-ro.md` — `~/.config/devin/agents/`(Linux/macOS)。Windows では `%APPDATA%\devin\agents\` |
| インストール済みプラグインツリー | `%APPDATA%\devin\cli\plugins\`(Windows。他 OS では設定ルートの慣例として `~/.config/devin/cli/plugins/`)。CLI 管理領域のため手編集しない |

生成ファイルは `# pstack-generated:` sha256 マーカーを持つため、
後続の `/pstack:setup-pstack` 実行は自身の出力とユーザー編集を
区別でき、不要になった `pstack-*.md` プロファイルの削除は明示的な
`--remove` 経由のみで行われる。上流へロールバックする際、残したく
なければ `pstack-models.md` と `pstack-*.md` プロファイルを手動で
削除する — これらは不活性なファイルだが、このディストリビューション
の生成物である。

## 5. 新規セッションに関する注意

- プラグインスキル、`pstack:*` エージェントプロファイル、
  `~/.devin/rules/` ルールはセッション開始時にロードされる。
  検証済みの形: `runtime-verification.md` の全プローブは
  `--local` インストール**後に**開始したセッションで実行され、
  `/pstack:*` とプラグインのプロファイルを解決した。
- 未検証: 実行中のセッションがプラグインの
  インストール/削除や書き換えられた `pstack-models.md` を
  取り込むかどうか。確実なのは新しいセッションを開始すること —
  インストール後、ロールバック後、`/pstack:setup-pstack` でモデル
  設定を変更した後のいずれも同様。生成設定についても README の
  モデル設定セクションが同じ境界を明記している: 設定は新しい
  セッションに適用され、現在のセッションは現在のモデルのまま。

## 6. 上流 `pstack` へのロールバック

1. `devin plugins remove pstack -y`(`--local` の場合あり —
   スコープの規則は §3 と同じ)。
2. 上流のプラグインを再インストールする。ドキュメント上の上流
   インストールソースは
   `devin plugins install cursor/plugins#harness/pstack/claude-code`
   (`devin-adapter-decisions.md` §4 参照 — 上流のルート
   `plugin.json` は Agent Plugins マニフェスト)。記録済みの実行で
   上流インストールは実測していないため、この形式は検証済みでは
   なくドキュメント記載として扱う。
3. 信頼する前に来歴を確認する: `devin plugins info pstack` が
   `version:` `0.15.42` と `cursor/plugins` の `source:` を
   示すこと(§1)。
4. 新しいセッションを開始する。上流のスキルが同じ `/pstack:`
   接頭辞で戻る。モデル設定はこのディストリビューションの
   `~/.devin/rules/pstack-models.md` を再利用せず、上流の
   `setup-pstack` を通じて再生成する — Devin 用ルールパスは
   このディストリビューションのマッピング。
