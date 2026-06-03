# Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| flow ごとの差異を吸収できず共通化が形骸化する | High | プロトコル本体は抽象契約のみ、flow 固有差分は adapter 設定に限定する |
| 冪等性が崩れ差分ノイズが発生する | High | deterministic gate を必須化し、安定ソートと固定レンダリングを強制する |
| 手動編集が混入して再現不能になる | High | script-only 規約 + gate failure code でブロックする |
| 既存 flow との互換性が壊れる | Medium | 置換を flow 単位で段階実施し、各段階で回帰テストを必須化する |
| 英日文書の差分が乖離する | Medium | 同一タスクで英日同時更新し、lint とレビューで照合する |
