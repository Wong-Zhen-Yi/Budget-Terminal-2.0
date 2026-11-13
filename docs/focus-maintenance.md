# Focus page maintenance

Run `npm run probe:maintenance-live -- --focus` from the repository root to fetch every page in the Focus workspace using a temporary, isolated data profile. PLTR checks both its stock and fundamental endpoints; Semiconductors checks the entire catalog. All Yahoo requests share one process and its rate gate.

The command derives coverage from workspace navigation and fails if a Focus page lacks a live check. It rejects unavailable, partial or stale lanes, missing stock charts and statements, missing semiconductor prices/history/profiles, and nonfinite numbers. Source warnings and complete envelopes are saved under the ignored `apps/desktop/out/maintenance/` directory. A passing fetch verifies the current provider response and structural checks; it does not guarantee future provider availability or audit every reported figure.

Run deterministic calculation/parser/cache checks with:

```sh
npm run probe:maintenance -- --only=bitcoin,bmnr,pltr,hood,hims,sofi,mu,amzn,avgo,semiconductors,vst,loading
```

After building, run renderer checks with:

```sh
npm run probe:maintenance -- --ui --only=bitcoin-ui,pltr-ui,hood-ui,hims-ui,sofi-ui,mu-ui,amzn-ui,avgo-ui,semiconductors-ui,vst-ui
```

Renderer probes exercise the existing explicit refresh hooks, retained snapshots, diagnostics, chart/layout behavior and warmed revisits. They must not restore removed refresh controls or global diagnostics banners.

The Vistra operations parser supports the third solar region first disclosed in its September 2026 filing and treats a disclosed production dash as zero. Unrecognized or missing production values still fail validation. HOOD propagates underlying stale financial statements to its lane and envelope freshness.
