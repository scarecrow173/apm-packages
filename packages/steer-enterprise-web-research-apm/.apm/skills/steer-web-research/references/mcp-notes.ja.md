# Web 調査用 MCP メモ

このパッケージは特定の MCP server を必須としないが、取得ツールがあると有効である。

有用なカテゴリ:

- 一般 Web 検索 MCP
- Web ページ取得 / 読解 MCP
- 学術検索 MCP
- GitHub MCP
- 内部ドキュメント / ファイル検索 MCP
- Database / NL2SQL MCP
- ブラウザ自動化 MCP。ただしポリシーとサイト利用規約で許可される場合に限る。

## ツール境界ルール

- 認証を迂回しない。
- 保護されたコンテンツをスクレイピングしない。
- secrets や private files を外部に漏らさない。
- 公式 API がある場合はそれを使う。
- private enterprise files は、ユーザーが明示的に求めた場合だけ高優先度として扱う。
- 公開 Web の証拠と内部証拠は、証拠台帳で区別する。

## 推奨される証拠フィールド

```markdown
| Source ID | Tool | Query | URL/Location | Title | Date | Source type | Reliability | Extracted evidence | Limitations |
|---|---|---|---|---|---|---|---|---|---|
```

## 推奨 MCP セットアップパターン

secrets を含む MCP server 設定は、このパッケージの外に置く。

考えられる環境変数の例:

```text
TAVILY_API_KEY=
BRAVE_API_KEY=
EXA_API_KEY=
GITHUB_TOKEN=
```

API キーをコミットしてはならない。
