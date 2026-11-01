# Dictionary page PNG prototypes

Two design concepts based on the existing DictionaryPage and its 405-entry offline catalog. The original prototypes were generated with the built-in image generation tool.

Option 2 has since been implemented in DictionaryPage with responsive category and term browsing, article section navigation, locally saved terms and reading history, formula copying, and the original chart-pattern diagrams. The search shortcut is / because Ctrl+K already opens the app page picker. All double-click launchers announce the update.

Implementation validation commands: npm run typecheck, npm run build, npm run probe:dictionary, npm run probe:dictionary-ui, npm run probe:charts -- --offline, npm run probe:launcher. The UI probe uses isolated temporary application storage, covers widths from 360 to 1600 pixels, and saves screenshots under apps/desktop/out/maintenance. implemented-reading-room.png is an actual screenshot of the implemented page with offline reference content.

- `01-reference-workspace.png`: compact term browser, alias previews, alphabet navigation, clear formula and worked-example cards. Recommended for fast lookup.
- `02-reading-room.png`: category navigation, larger article typography, article outline, related terms and recent history.

Saved terms, copy buttons, the / search shortcut, and recently viewed are implemented for option 2. Alphabet navigation belongs to the unselected option 1. Article examples use the existing offline catalog. The implementation preserves the canonical category names, existing chart-pattern diagrams, and startup readiness.

## Generation prompts

### Concept 1

```text
Use case: ui-mockup.
Asset type: high-fidelity PNG desktop application redesign prototype.
Create a SINGLE full-screen landscape 1920x1080 interface screenshot of the Dictionary page in Budget Terminal 2.0. Straight-on flat application UI, crisp legible text, no device frame or perspective. This is a design concept, with sample content. Direction 01: REFERENCE WORKSPACE. Evolve an existing dark finance terminal rather than a marketing site.
Palette matches actual app: background #080b12, panels #0d1420 and #121b2b, borders #1e2b3f, text #d5dee9, muted text #7d8ea6, blue accent #3b82e8. Modern Segoe UI-like sans serif, monospace only for formulas. Sophisticated compact information density, generous article line height, sharp alignment, 5px radii, understated line icons. Avoid glow, gradients, decorative illustration, oversized empty areas.
Outer shell: compact 42px titlebar with small folded geometric mark and Budget Terminal upper left, Find a page control and simple window controls right. 60px left icon navigation rail. Small page breadcrumb Overview / Dictionary and compact tabs Dashboard, News, Calendar, YouTube, Dictionary; Dictionary is active blue underline. Keep shell subdued.
Main page header Dictionary, subtitle Find the meaning. Understand the context. Small right badge 405 entries / Offline reference. Wide useful search field under header with magnifying glass, placeholder Search terms, aliases, formulas or definitions, and keyboard hint Ctrl K. Below it two columns: 310px browsing pane and broad article pane.
Browsing pane: All categories dropdown, modest All terms and Saved tabs, compact A-Z letter strip, count 405 terms. List rows have a bold term, smaller category and alias preview, small bookmark outline at far right. Visible rows: Market Capitalization, Moving Average, Net Income, Price-to-Book Ratio, Price-to-Earnings Ratio, Return on Equity, Revenue, Volume. Selected Price-to-Earnings Ratio has blue left border, blue-tinted background and P/E alias. Terms fit without text clipping. Quiet bottom control Browse all 14 categories.
Article pane: breadcrumb Valuation & Formulas, large clear heading Price-to-Earnings Ratio, alias line P/E · PE Ratio, bookmark action top right. Definition in prominent clean type: Share price relative to earnings per share. Small horizontal in-page tabs Overview, Formula & example, Related terms. Overview selected. Then Why it matters section text It shows how much investors pay for each unit of current or expected earnings.
Below: a beautiful horizontal blue-tinted formula card with small FORMULA label, P/E = Share price ÷ EPS, and Copy icon. An adjacent or lower worked example card labeled WORKED EXAMPLE, values Share price $60, EPS $3, P/E 20× in three clearly aligned columns. Tiny sentence A $60 stock earning $3 per share trades at 20× earnings.
Lower two compact article sections: Variables with text Use the same share class. Label EPS consistently as trailing, forward, GAAP or adjusted. Interpretation & limitations with restrained amber side rule: Not meaningful with negative earnings. Compare growth, quality and business-cycle context.
A Related terms footer row has three navigable chips Forward P/E, Earnings per Share, PEG Ratio with arrow icons. Small footer Educational reference only. Tiny unobtrusive bottom-right DESIGN PROTOTYPE · 01.
Important: make content readable and polished. No emails, accounts, API keys, private names, file paths, balances, real-time quotes, or personal information. All content is existing offline financial reference material. Bookmark and keyboard controls are proposed UX features. No AI assistant, financial recommendations, charts, or fabricated live information. Entire screen edge-to-edge.
```

### Concept 2

```text
Use case: ui-mockup.
Asset type: high-fidelity PNG desktop application redesign prototype.
Create a SINGLE full-screen landscape 1920x1080 interface screenshot of a redesigned Dictionary page in Budget Terminal 2.0. Straight-on crisp flat application UI, no perspective or laptop mockup, no surrounding background. Direction 02: READING ROOM. A meaningfully different layout from a dense three-column reference app: topic navigation on left, large readable article center, concise navigable article outline on right.
Retain finance terminal style and app palette #080b12 background, #0d1420 panels, #121b2b raised panels, #1e2b3f dividers, #d5dee9 text, #7d8ea6 muted text, #3b82e8 blue. Restrained amber #d6b25e only for caveats. Use modern sans serif, readable 16-18px article text, generous line height, 8px corners, minimal borders around prose. Carefully designed useful white space. No gradients, glow, generic marketing hero, or giant logos.
Subdued outer application shell: 42px top titlebar with folded geometric mark Budget Terminal left, Find a page and window controls right. A 60px navigation icon rail. Slim secondary breadcrumb Overview / Dictionary and compact tabs Dashboard, News, Calendar, YouTube, Dictionary with Dictionary selected.
Inside main page: left header Dictionary with subtitle 405 entries · Available offline. A prominent wide search bar Search terms, aliases or formulas and keyboard hint Ctrl K toward upper center. Right compact Saved terms control.
Below, a 260px left topic browser with understated CATEGORIES label. All terms, Market Basics, Instruments, Trading & Execution, Portfolio Management, Risk & Performance, Financial Statements, Fundamental Analysis, Valuation & Formulas, Technical Indicators, Chart & Candlestick Patterns, Options, Corporate Actions, Macroeconomics, Behavioral Finance. Technical Indicators selected blue. Category labels wrap cleanly if needed. Below divider, TERMS IN THIS TOPIC: Bollinger Bands, MACD, Moving Average, Relative Strength Index, Stochastic Oscillator, VWAP; Relative Strength Index highlighted. No invented category counts.
Main article area uses approx 820px width. Small breadcrumb Technical Indicators / Momentum. Large heading Relative Strength Index with small outlined RSI badge and bookmark icon on right. One-line summary A bounded momentum oscillator comparing average gains with average losses. Slim divider.
Section heading Why it matters and text It helps describe momentum, extension and divergence.
Clean prominent formula surface labeled THE FORMULA with exact formula RSI = 100 − 100 / (1 + RS). Under it: RS = Average gain ÷ Average loss. Copy formula icon aligned at right.
Below a worked example with spacious inline flow: Average gain 2 / Average loss 1 → RSI 66.7. Text An average gain twice the average loss produces an RSI near 66.7. This is hypothetical educational arithmetic, no market data.
Then Definitions section with two neat label/value rows: Lookback / Commonly 14 periods; Inputs / Smoothed positive and negative price changes.
A low-contrast amber caveat block titled Keep in mind: Overbought is not automatically bearish. Oversold is not automatically bullish.
Right narrow sidebar separated by a thin vertical line labeled ON THIS PAGE, links Overview, Why it matters, Formula, Worked example, Limitations, Related terms. Overview has thin blue active line. Beneath, RELATED TERMS with clickable tidy rows Momentum, Divergence, MACD and right arrows. Bottom a quiet RECENTLY VIEWED list Price-to-Earnings Ratio and Market Capitalization.
Footer Educational reference only. Bottom-right tiny DESIGN PROTOTYPE · 02. Design every panel as implementable local offline UX. Proposed Saved and recently viewed controls are concept features.
No personal names, private information, accounts, email addresses, balances, API keys, file paths, AI summaries, buy/sell advice, live quotes, or charts. All text crisp, correctly spelled, aligned and readable. Fill screen edge-to-edge.
```

