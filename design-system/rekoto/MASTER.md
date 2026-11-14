# Rekoto design system

Reference: "Lodom – Screen Recording Dashboard" (Dribbble shot 24243744) for layout only.
Colors are Rekoto's own: **yellow and black**.

## Colors

- Accent yellow `#FFC400` (hover `#FFB300`). Text on yellow is always black `#141414`, never white.
- Yellow-family text on white uses `#8A6200` (pure yellow is unreadable on white).
- Black pill buttons `#161616` for secondary heavy actions (top-bar "New recording", "Open folder").
- Light: app surface white, page wash `#F1F1F3`, borders `#E8E8EC`.
- Dark (Windows dark mode, or the theme switch in the top bar): surfaces `#141416`, black buttons invert to near-white.
- Red only for the recording dot.

## Layout (from the reference)

1. Top bar: logo, pill search, theme switch, icon buttons, black "New recording" pill.
2. Sidebar: pill nav items; active = yellow tint + yellow outline. Workspace pill and local-storage card at the bottom.
3. Library: breadcrumb, 34px title, workspace line, yellow "Record new video" pill, underlined tabs with a yellow bar,
   list/grid toggle, "Sorting by". Cards: header row (avatar, workspace, time ago), thumbnail with white duration pill, stats + title.
4. Record: "Record a new video" card with three mode tiles, Title + square camera preview, pill device rows, mic waveform, big yellow Start pill.
5. Video page: back arrow + editable title, byline, rounded player, fact cards.

## Rules

- Pills (999px radius) for buttons, inputs, nav; 18–30px radius for cards.
- Plus Jakarta Sans.
- No features that do not exist (no comments, likes, AI tabs, upgrade plans).
