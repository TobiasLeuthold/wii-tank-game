# Tanks! – couch co-op

A two-player tank game in the style of Wii Play "Tanks!", running in the browser.
It needs no install and no build step.

## Start

Double-click `index.html`. It opens in Chrome or Edge.

## Controls

| | Drive | Shoot | Mine |
|---|---|---|---|
| P1 (blue) | W A S D | Space | hold Space, or E |
| P2 (red) | Arrow keys | 0 (top row or numpad) | hold 0, or Num . / Enter |
| 1 player | W A S D, aim with the mouse | Left click | Space |

In 2-player mode, tap left/right to turn just a little for long shots; hold to turn faster.
Esc / P pauses, and M turns music on/off.

## Features

- 20 missions with 9 enemy tank types. The **Enemy tanks** screen in the main menu explains what each one does.
- Versus mode: P1 vs P2 in 5 arenas, first to 3 round wins.
- Progress saves automatically in the browser. Use **Continue** to resume, or **Select mission** to start any mission.
- Options for an aim line, friendly fire, steering style, music and sound effects.

## Tweaking

- `js/levels.js` holds the mission maps as 22×15 text grids. The legend is at the top of the file.
- `js/config.js` holds the stats for players and enemy tanks.
