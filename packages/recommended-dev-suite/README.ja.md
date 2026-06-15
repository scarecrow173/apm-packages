# recommended-dev-suite

`recommended-dev-suite` は、より厚い AI 支援開発 workflow をまとめる推奨 APM aggregator です。

この package は、basic foundation が既に利用できるか、別途管理されている前提で扱います。planning、refinement、debugging、review、TDD、source-grounded implementation、CI/CD、simplification、context engineering など、意見を持った workflow skill を追加します。

## 対象範囲

この package は、agent を development により積極的に参加させたい team 向けの recommended workflow capability を対象にします。

agent が intent clarification、planning、implementation、verification、debugging、code simplification、subagent usage、review loop を進める力を高める dependency はここに追加します。広く使えるが意見の少ない development utility は `basic-dev-foundation` に残してください。

## Dependencies

正本は [apm.yml](./apm.yml) です。現在の dependencies は以下です。

- `obra/superpowers/skills/brainstorming`
- `obra/superpowers/skills/dispatching-parallel-agents`
- `obra/superpowers/skills/subagent-driven-development`
- `obra/superpowers/skills/requesting-code-review`
- `obra/superpowers/skills/receiving-code-review`
- `obra/superpowers/skills/systematic-debugging`
- `addyosmani/agent-skills/skills/idea-refine`
- `addyosmani/agent-skills/skills/interview-me`
- `addyosmani/agent-skills/skills/doubt-driven-development`
- `addyosmani/agent-skills/skills/test-driven-development`
- `addyosmani/agent-skills/skills/source-driven-development`
- `addyosmani/agent-skills/skills/incremental-implementation`
- `addyosmani/agent-skills/skills/ci-cd-and-automation`
- `addyosmani/agent-skills/skills/code-simplification`
- `addyosmani/agent-skills/skills/context-engineering`

## Maintenance

この package は、baseline availability ではなく recommended workflow の深さに集中して保守してください。ここに入れる dependencies は `basic-dev-foundation` より意見が強くても構いませんが、開発リポジトリで広く使えるものに絞ります。
