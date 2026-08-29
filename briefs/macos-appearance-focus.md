# Decision brief: desktop appearance and focus stability

## Status

**READY for implementation.** Owner-observed timing now matches the code's exact 10,000 ms sustained-blur branch closely enough to implement the root-level terminal fix. Measuring the human-visible boundary and capturing the affected region remain characterization/QA tasks, not product blockers.

Tab cosmetics retain a verification gate: current `origin/main` already assigns the flat-chrome token to both tab-row implementations, so implementation should change CSS only if computed-style evidence identifies a real mismatch.

Baseline: `HEAD` and `origin/main` at `169f8aa3` (`v2.4.87`), including flat chrome at `97aaa1a8` and Electron `41.10.3`.

## Problem and intended outcome

- Tab rows use the neutral chrome plane established by flat chrome.
- macOS application UI uses one sans-serif system stack; terminal and code surfaces retain their intended monospace fonts.
- System appearance on macOS, Windows, and Linux follows the OS light/dark preference while remembering a separately selected light palette and dark palette.
- Fixed appearance pins one named palette and ignores OS changes without erasing either System slot.
- Returning to Pane after sustained inactivity does not trigger a visible terminal replay or opaque recovery mask.

## Current-state evidence

- Flat chrome defines an edge-to-edge frame with tonal separation and a hairline (`frontend/src/index.css:204-213`). Both top and split-group tab rows already request `bg-bg-chrome` (`frontend/src/components/panels/PanelTabBar.tsx:523-528`, `frontend/src/components/panels/PanelGroupView.tsx:200-205`), backed by per-theme `--color-bg-chrome` values (`frontend/src/styles/tokens/colors.css:473-492`, plus theme overrides).
- `body` inherits `--font-family-sans` (`frontend/src/index.css:29-45`), whose token is a macOS-first system stack (`frontend/src/styles/tokens/typography.css:19-22`). Xterm separately uses the configured monospace family plus Nerd Font symbols, terminal settings expose it, and Monaco remains the code editor (`frontend/src/components/panels/TerminalPanel.tsx:96-100`, `frontend/src/components/settings/categories/TerminalSettings.tsx:41-79`, `frontend/src/components/panels/editor/FileEditorView.tsx:312-325`).
- Theme state is currently one concrete `Theme`, initialized from legacy `localStorage.theme` with `light-rounded` fallback before config wins (`frontend/src/contexts/ThemeProvider.tsx:11-28`, `frontend/src/contexts/ThemeProvider.tsx:42-64`). The pre-React bootstrap duplicates that map/fallback (`frontend/index.html:11-90`), config defaults to `light-rounded` (`main/src/services/configManager.ts:37-55`), and Appearance exposes one unfiltered theme selector (`frontend/src/components/settings/categories/AppearanceSettings.tsx:19-58`).
- Every theme already composes on a canonical `light` or `dark` base; `THEME_CLASSES[theme][0]` and `isLightTheme` are the current source of truth (`frontend/src/contexts/themeContextValue.ts:3-41`). Picker family and label are not appearance classifications.
- Electron 41 exposes `nativeTheme.themeSource: 'system' | 'light' | 'dark'`, `shouldUseDarkColors`, and `updated` without a platform restriction (`node_modules/electron/electron.d.ts:9904-10010`). Electron propagates the resolved source to renderer `prefers-color-scheme` and supports Electron-rendered UI on Windows and Linux ([nativeTheme API](https://www.electronjs.org/docs/latest/api/native-theme), [dark-mode guide](https://www.electronjs.org/docs/latest/tutorial/dark-mode)). `shouldUseDarkColorsForSystemIntegratedUI` is a separate macOS/Windows-only query and must not drive Pane content.
- Main completes config/service initialization before `createWindow()` (`main/src/index.ts:1111-1173`), so persisted appearance can set `nativeTheme.themeSource` and seed the first-paint payload before BrowserWindow construction.
- Main sends focus state on focus, blur, minimize, and restore (`main/src/index.ts:918-951`); App only uses it to pause animations/disable transitions (`frontend/src/App.tsx:475-516`, `frontend/src/index.css:11-20`). ThemeProvider has no focus dependency.
- TerminalPanel receives the same event. At exactly 10,000 ms blurred, it arms full recovery, invalidates hot activation, disables WebGL, and attempts renderer disposal (`frontend/src/components/panels/TerminalPanel.tsx:98-100`, `frontend/src/components/panels/TerminalPanel.tsx:565-621`). Refocus then selects full recovery, sets `isRefreshing`, resets/replays the normal buffer or forces alternate-screen redraw, repeats after 300 ms, and holds an opaque terminal-sized mask for 200 ms after paint (`frontend/src/components/panels/TerminalPanel.tsx:720-805`, `frontend/src/components/panels/TerminalPanel.tsx:1908-2028`, `frontend/src/components/panels/TerminalPanel.tsx:2140-2144`).
- Owner observation now independently matches that branch: the flash appears after roughly more than 10 seconds inactive and does not appear below roughly 10 seconds. The exact observed boundary is unmeasured, but the qualitative split matches the only focus path with a 10-second threshold.
- History supports causality: `e10996f0` introduced the blur timer; `b9694629` added refocus repaint after reattach could leave terminals black; `b141e6a6` restored masked full recovery after lighter activation caused ghost rows/shared-atlas corruption; `c1b2a61a` explicitly coupled sustained blur to full recovery.
- BrowserWindow still has no `backgroundColor` (`main/src/index.ts:341-371`), leaving Electron's white default. This remains launch/whole-window hardening evidence, but the owner-confirmed threshold demotes it as the refocus cause ([BrowserWindow guide](https://www.electronjs.org/docs/latest/api/browser-window/)).
- Existing tests cover shell geometry, split tabs, and concrete themes, but the Electron mock always reports focused (`tests/chrome-evidence.spec.ts:34-80`, `tests/split-groups.spec.ts:57-102`, `tests/settings.spec.ts:358-367`, `tests/electronApiMock.ts:349-357`).

## Appearance state model

Persist one mode and three independent palette selections:

```ts
type AppearanceMode = 'system' | 'fixed';

interface AppearanceConfig {
  appearanceMode: AppearanceMode;
  theme: Theme;             // remembered Fixed palette; retained for compatibility
  systemLightTheme: LightTheme;
  systemDarkTheme: DarkTheme;
}

resolvedTheme =
  appearanceMode === 'fixed'
    ? theme
    : prefersDark
      ? systemDarkTheme
      : systemLightTheme;
```

- `LightTheme` is exactly: `light`, `light-rounded`, `folio`, `newsprint`, `teletype`, `haar`, `high-legibility`.
- `DarkTheme` is every remaining current theme: `dark`, `oled`, `dusk`, `dusk-oled`, `forge`, `ember`, `aurora`, `night-owl`, `night-owl-oled`, `terracotta`, `synthwave`, `acid`, `tokyo-rain`, `walnut`, `amber-crt`, `dot-matrix`, `abyss`, `understory`, `colorblind-safe`, `low-fatigue`.
- Derive these sets from the canonical base-class metadata and share the classifier across main/frontend boundaries; do not maintain a third hand-authored classification based on picker families.
- New-install defaults on every desktop platform: `appearanceMode: 'system'`, `theme: 'light-rounded'`, `systemLightTheme: 'light-rounded'`, `systemDarkTheme: 'dark'`.
- High contrast remains orthogonal and applies after the resolved palette.

### Settings behavior

- Replace the single Theme row with a `System | Fixed` mode control.
- System mode shows both filtered selectors at once: **Light palette** accepts only `LightTheme`; **Dark palette** accepts only `DarkTheme`. Indicate which slot is currently active from OS appearance.
- Changing the active System slot applies immediately; changing the inactive slot only persists it. Neither action changes mode or the other slot.
- Fixed mode shows one selector containing every theme. Changing it updates `theme` and applies immediately.
- Switching modes never overwrites any of the three remembered selections. Returning to System restores its pair; returning to Fixed restores its pinned palette.
- UI and config-boundary validation must reject a dark palette in the light slot or a light palette in the dark slot.

### Migration and first paint

- Legacy config with `theme: T` and no appearance fields migrates to `appearanceMode: 'fixed'` and keeps `theme: T`. Seed the same-class System slot with `T`; seed the opposite slot with its new-install default. This preserves current appearance while carrying the known palette preference into System.
- Partial/corrupt new state preserves every valid field, replaces only invalid/misclassified slots with their defaults, and records a diagnostic. It must not silently swap slots or reclassify by label/family.
- Main loads/migrates config before BrowserWindow, sets `nativeTheme.themeSource = 'system'` for System or the fixed palette's base for Fixed, and supplies a synchronous per-window appearance snapshot using the existing pre-window argument/preload pattern.
- The pre-React bootstrap consumes that authoritative snapshot first. A versioned local cache mirrors `appearanceMode`, `theme`, `systemLightTheme`, and `systemDarkTheme` only as browser/test/failure fallback; legacy `localStorage.theme` is interpreted as Fixed. Do not treat a cached resolved theme as the System source of truth.
- Before React, resolve System with synchronous `matchMedia('(prefers-color-scheme: dark)')`, choose the corresponding slot, and stamp its complete class list on `html` and `body`. Set `color-scheme` and a matching BrowserWindow backing color before the window is visible so first-paint correctness includes native backing, not only React.
- While running, System listens to `prefers-color-scheme` changes and swaps slots; Fixed ignores them. Persisted config, native source, bootstrap snapshot/cache, resolved classes, title overlay, terminal, and Monaco update or roll back as one logical transaction.

## Focus diagnosis: root cause or symptom?

**High confidence: the sustained-blur recovery policy is the root trigger for the reported refresh flash.** Source proves a 10,000 ms timer-to-full-replay-to-mask chain, and owner observation matches both sides of that boundary. Successful WebGL disposal is not required: the timer arms full recovery before attempting disposal.

The root fix is to stop invalidating the currently visible terminal merely because a performance-mode window stayed blurred. Keep its renderer and continuously fed xterm buffer valid, then use the existing silent repaint on refocus. Preserve full recovery for initial/remount, true panel hiding where renderer replacement requires it, battery-saver output gating, context loss, and manual refresh. Do not clear the shared texture atlas.

Changing mask color/duration, globally removing `window-blurred`, or adding a matching BrowserWindow plate would treat symptoms. BrowserWindow/compositor exposure remains a separate hypothesis only if post-fix capture shows chrome outside TerminalPanel flashing.

## Decisions and scope

1. Keep `--color-bg-chrome` as the only tab-row background contract. If both rows already compute to it, add regression assertions without CSS churn.
2. Audit macOS UI typography semantically; keep all terminal/code/log/path/hash surfaces monospace.
3. Implement the paired System/Fixed state, filtered settings UI, migration, synchronous bootstrap, live following, rollback, and native integration above on macOS, Windows, and Linux.
4. Use Windows app/Chromium color preference, not the system-integrated-UI query. Retain Linux's Electron/desktop-environment QA caveat.
5. Remove the default performance-mode 10-second visible-terminal invalidation/full-recovery coupling; retain documented recovery invariants and resource-saving battery mode.

Likely touched areas: shared/main/frontend config types and validation; config migration; main `nativeTheme` startup and bootstrap payload; pre-React HTML/preload; theme metadata/context/provider; Appearance settings and persistence; BrowserWindow/title overlay color synchronization; Electron mocks; tab/typography assertions; TerminalPanel lifecycle policy/tests.

## Non-goals

- Adding or redesigning palettes.
- Automatically pairing palettes by picker family, name, or visual similarity.
- Changing terminal fonts, Monaco, or semantically monospace content.
- Reworking tab layout, split behavior, or flat-chrome architecture.
- Removing protected recovery paths or hiding the focus defect by recoloring the mask.
- Solving every upstream Linux desktop-environment theme-detection difference.

## Acceptance criteria

- Every top/split tab row computes to `--color-bg-chrome`, one hairline, no card radius/shadow.
- macOS ordinary UI uses the shared sans stack; terminal and code/diff/log surfaces remain monospace, including live terminal-font updates.
- Fresh macOS, Windows, and Linux installs start in System and render the selected light or dark slot correctly before the first visible paint, live-switch with the OS, and remain correct after restart/background changes.
- System remembers and independently edits one valid light palette and one valid dark palette. Fixed remembers one unrestricted palette. Mode switches preserve all three.
- Legacy users retain their current palette in Fixed after upgrade; the corresponding System slot inherits it. Invalid slot data cannot produce a light/dark mismatch.
- Native/Electron UI, Window Controls Overlay, terminal, and Monaco match the resolved palette/base where supported; save failure restores one consistent persisted and visible state.
- In default performance mode, blur/refocus below, at, and above 10 seconds never enters the full-refresh/mask path and preserves terminal content, selection, viewport, and scroll.
- Initial/remount, panel switching, battery saver, context loss, normal shell, and alternate-screen recovery remain correct without ghost rows, duplicate transcript, black/stale frames, or atlas corruption.
- `pnpm lint`, `pnpm typecheck`, targeted Playwright/main tests, and `pnpm theme:contrast` pass.

## Test and visual QA matrix

| Area | Automated coverage | Visual/platform QA |
| --- | --- | --- |
| Appearance model | Boundary tests for classifier, slot validation, defaults, legacy/partial/corrupt migration, mode switching, independent slot persistence, rollback | Exercise Light palette, Dark palette, and Fixed controls; verify inactive-slot edits do not restyle |
| First paint/live following | Test authoritative bootstrap vs cache/legacy fallback, System light/dark resolution, Fixed immunity, media-query changes, backing/WCO synchronization | Cold launch and live switch in macOS Light/Dark/Auto; Windows light/dark app mode; Linux representative supported package/DE/session |
| Palette coverage | Parameterize every theme: exactly one light/dark set, valid slot filtering, terminal/Monaco receive resolved palette | Pair non-default palettes such as Folio + Forge; restart in each OS state and cross the scheduled OS change while backgrounded |
| Focus boundary characterization | Fake timers at 9,999/10,000/10,001 ms prove the current branch before change; after change prove no visible-terminal invalidation at any duration in performance mode, while battery/context-loss paths remain | Record app-switch/click-refocus at 8 s, 9.5 s, 10 s, 10.5 s, and 12 s; capture terminal plus persistent chrome and lifecycle logs |
| Terminal invariants | Normal/alternate screen, WebGL loaded/failed/context loss, selection/scroll, output during blur, performance/battery tests | Repeat boundary sweep with normal shell and fullscreen TUI; look for mask, blank frame, ghost rows, replay, scroll jump |
| Chrome/typography/regression | Existing chrome, split, settings, accessibility, theme screenshot, terminal selection, and contrast suites plus computed-style assertions | Split/unsplit tabs across representative palettes; macOS Retina UI-font audit at 1x/1.25x |

## Risks and dependencies

- Main, preload/bootstrap, React, and settings persistence must share one appearance schema and base classifier; drift can create first-paint or native/renderer mismatches.
- Retaining the visible WebGL renderer during blur costs GPU memory. Measure idle CPU/GPU and preserve battery saver rather than reintroducing a time-based default invalidation.
- Prior lighter activation recovery caused ghost rows and shared-atlas corruption. Restrict the change to window blur/refocus; do not weaken panel replacement or context-loss recovery.
- Linux uses the same Electron API, but integration varies by environment. Electron has recorded Linux system-theme detection failures (for example [electron/electron#43416](https://github.com/electron/electron/issues/43416)); QA must record distro, desktop environment, display server, and package type.
- The exact owner-visible boundary has not been measured. Code says 10,000 ms; the runtime sweep must establish scheduler/paint behavior around it, but this does not block implementation.

## Assumptions

- “Neutral chrome” means semantic per-theme `--color-bg-chrome`, not one literal gray.
- Current `THEME_CLASSES[theme][0]` is authoritative for light/dark eligibility, including `low-fatigue` as dark despite its warm presentation.
- Fixed is the user-facing name for the single-palette manual mode.
- Named palettes are valid in System slots when their canonical base matches the slot; System is not limited to base `light` and `dark`.
- The owner timing evidence is sufficient to proceed with the root-level focus fix; the boundary/region capture is mandatory implementation verification, not an unresolved product decision.
