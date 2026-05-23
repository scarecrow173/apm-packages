# MADR 4.0.0 リファレンス

この skill は MADR 4.0.0 を ADR テンプレートの基準として使います。

## 出典

- ホームページ: <https://adr.github.io/madr/>
- リポジトリ: <https://github.com/adr/madr>
- 4.0.0 テンプレートディレクトリ: <https://github.com/adr/madr/tree/4.0.0/template>
- 4.0.0 リリース: <https://github.com/adr/madr/releases/tag/4.0.0>

## バージョン

- MADR version: 4.0.0
- リリース日: 2024-09-17

## ライセンス

MADR プロジェクトは、成果物が以下のデュアルライセンスであると示しています。

- MIT
- CC0-1.0

SPDX expression: `MIT OR CC0-1.0`

このパッケージは MIT ライセンスです。MADR 由来のテンプレート内容には、
利用者がテンプレートの由来を追跡できるように、この出典とライセンスの注記を
保持します。

## テンプレート対応

- `assets/templates/madr-4-full.md` は `adr-template.md` をベースにしています。
- `assets/templates/madr-4-minimal.md` は `adr-template-minimal.md` をベースにしています。
- `assets/templates/madr-4-bare.md` は `adr-template-bare.md` をベースにしています。
- `assets/templates/madr-4-bare-minimal.md` は `adr-template-bare-minimal.md` をベースにしています。

このパッケージのテンプレートでは、元のプレースホルダー形式を
`{{title}}`, `{{number}}`, `{{date}}`, `{{status}}` などの
スクリプト向けトークンに置き換えています。

## パッケージ拡張: ADR Relations

このパッケージは YAML フロントマターに任意の `relations` ブロックを
追加します。これは upstream の MADR 4.0.0 仕様そのものではなく、
ADR 同士の関係を機械的に扱うためのパッケージ独自拡張です。

フィールド構造と利用ルールは `adr-conventions.ja.md` で定義します。
