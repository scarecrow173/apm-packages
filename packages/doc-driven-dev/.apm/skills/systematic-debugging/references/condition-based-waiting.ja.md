# 条件ベースの待機（Condition-Based Waiting）

信頼性の高い非同期操作のために、任意のタイムアウトを条件ポーリングに置き換える。

## 問題

```typescript
// 悪い例: 任意のタイムアウト — 速いマシンでは動作、遅いマシンでは失敗
await new Promise(resolve => setTimeout(resolve, 2000));
```

任意のタイムアウトは: 遅いマシンでは短すぎ（不安定テスト）、速いマシンでは長すぎる（遅いテスト）。

## 解決策

特定の条件が true になるまで待機し、タイムアウトをセーフティネットとする:

```typescript
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options?: { timeout?: number; interval?: number }
): Promise<void> {
  const timeout = options?.timeout ?? 5000;
  const interval = options?.interval ?? 100;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`Condition not met within ${timeout}ms`);
}
```

## キールール

- **常にタイムアウトを持つ** — 永久にポーリングしない
- **特定の条件をポーリング** — 「待って祈る」のではなく
- **短いポーリング間隔** — 50-100ms が一般的
- **タイムアウト時に記述的エラー** — どの条件が満たされなかったかを含める
- **条件は副作用フリー** — 状態を変更せず確認のみ

## 使用場面

- サーバー/サービスを待つテストセットアップ
- 非同期操作を待つ UI テスト
- 結果整合性を待つ統合テスト
- 同期に使われる `sleep()` や `setTimeout` の置き換え
