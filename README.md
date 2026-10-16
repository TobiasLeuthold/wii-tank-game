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

Esc / P pauses, and M mutes.

## Features

- 20 missions with 9 enemy tank types.
- Progress saves automatically in the browser. Use **Continue** to resume, or **Select mission** to start any mission.
- Options for friendly fire, steering style and sound.

## Tweaking

- `js/levels.js` holds the mission maps as 22×15 text grids. The legend is at the top of the file.
- `js/config.js` holds the stats for players and enemy tanks.
