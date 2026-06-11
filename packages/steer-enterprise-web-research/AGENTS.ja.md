# AGENTS.md

このファイルは、`packages/steer-enterprise-web-research` を変更する AI エージェント向けの実務ガイドです。

## 1. スコープ

- この文書中のパスは、コマンドブロックで別記しない限りリポジトリルート基準です。
- 配布用パッケージ資産は `packages/steer-enterprise-web-research/` 配下にあります。
- build workspace のコードとテストは `scripts/steer-enterprise-web-research/` 配下にあります。

## 2. 責務分離

- 配布用パッケージファイルの編集先:
  - `packages/steer-enterprise-web-research/.apm/**`
  - `packages/steer-enterprise-web-research/README.md`
  - `packages/steer-enterprise-web-research/README.ja.md`
  - `packages/steer-enterprise-web-research/apm.yml`
- 監査スクリプトのソースとテストの編集先:
  - `scripts/steer-enterprise-web-research/src/**`
  - `scripts/steer-enterprise-web-research/build/**`
  - `scripts/steer-enterprise-web-research/tests/**`
- 生成される監査スクリプト出力先:
  - `packages/steer-enterprise-web-research/scripts/research_audit.js`

## 3. 作業フロー

1. 先に package README と配布用 `.apm/` ファイルを読む。
2. 挙動変更がある場合は、まず `scripts/steer-enterprise-web-research/src` を編集する。
3. `pnpm --dir scripts/steer-enterprise-web-research build` で配布用監査スクリプトを再生成する。
4. `pnpm --dir scripts/steer-enterprise-web-research test` を実行する。
5. package 向けの挙動や使い方が変わる場合は、同じ変更で `packages/steer-enterprise-web-research/README.md` と `README.ja.md` も更新する。

## 4. コマンド

リポジトリルートから実行:

```bash
pnpm --dir scripts/steer-enterprise-web-research build
pnpm --dir scripts/steer-enterprise-web-research test
```

APM パッケージ自体の検証は `packages/steer-enterprise-web-research/` で実行:

```bash
apm compile --dry-run
apm compile --validate
apm pack --archive -o dist
```

## 5. チェックリスト

- ユーザー向け挙動が変わった場合、配布用 `.apm/` ドキュメントを更新したか。
- ソース変更後に `packages/steer-enterprise-web-research/scripts/research_audit.js` を再生成したか。
- `pnpm --dir scripts/steer-enterprise-web-research test` を実行したか。
- `README.md` と `README.ja.md` の意味と構成を揃えたか。
