# ekip-renkleri (Claude team colors)

A Claude Code mod that shows who is doing the work in a session, with small coloured keycap avatars: the main
Claude session in orange, subagents by model (Opus violet, Sonnet blue, Haiku green, Fable yellow, others grey) and
Codex runs in teal.

- **Team pane** (`/ekip`): who is working now, who finished (time, tool calls, last action) and a colour-coded feed.
- **Band** above the prompt: the subagents and Codex runs working right now, with their avatars.
- **Status line**: `Ekip: Claude · 2 alt ajan · Codex`.

A Codex run is recognised as a Bash call to `codex.mjs`, `codex.exe` or `codex exec`. A Codex run started in the
background closes as done or failed when its completion notice reaches the main session. The interface text is Turkish.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install ekip-renkleri --marketplace ArdaYMC/claude-team-colors
```

From a shell:

```bash
claude plugin install ekip-renkleri --marketplace ArdaYMC/claude-team-colors
```

In the Claude desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace
with `ArdaYMC/claude-team-colors`, then Add plugin.

Needs a Claude Code version that loads mods (2.1.287 or later).

---

## Türkçe

Bir Claude Code oturumunda işi kimin yaptığını renkli, küçük klavye tuşu avatarlarıyla gösterir. Ana oturumdaki
Claude turuncu, alt ajanlar modeline göre (Opus mor, Sonnet mavi, Haiku yeşil, Fable sarı, diğerleri gri), Codex
çalıştırmaları turkuaz görünür. `/ekip` paneli şu an çalışanları, bitenleri ve renkli bir akışı gösterir; komut
satırının üstündeki bant çalışan alt ajan ve Codex işlerini listeler; durum satırı ekibi özetler.

Made by ArdaYMC with Claude. MIT licence.
