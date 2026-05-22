# MCP Notes for Web Research

This package does not require a specific MCP server, but it benefits from retrieval tools.

Useful categories:

- General web search MCP
- Web page fetch/read MCP
- Academic search MCP
- GitHub MCP
- Internal document/file search MCP
- Database/NL2SQL MCP
- Browser automation MCP, only where allowed by policy and site terms

## Tool Boundary Rules

- Do not bypass authentication.
- Do not scrape protected content.
- Do not exfiltrate secrets or private files.
- Use official APIs where available.
- Treat private enterprise files as higher-priority only when the user explicitly asks about them.
- Public web evidence and internal evidence should be distinguished in the evidence ledger.

## Recommended Evidence Fields

```markdown
| Source ID | Tool | Query | URL/Location | Title | Date | Source type | Reliability | Extracted evidence | Limitations |
|---|---|---|---|---|---|---|---|---|---|
```

## Suggested MCP Setup Pattern

Keep MCP server configuration outside this package when it contains secrets.

Examples of possible environment variables:

```text
TAVILY_API_KEY=
BRAVE_API_KEY=
EXA_API_KEY=
GITHUB_TOKEN=
```

Never commit API keys.
