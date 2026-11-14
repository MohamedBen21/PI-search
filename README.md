# π Search

Explore the digits of pi and search for any sequence of numbers — or any word — inside up to billions of digits.

The interface is a black page of white digits with a search bar at the bottom. Matches are highlighted in yellow, and a switch in the search bar turns the digits into letters so you can find words hidden in pi. Searching, finding and failing each have their own sound effect.

## Features

- **Billions of digits** — scroll, drag or jump anywhere in a multi-gigabyte file with smooth rendering
- **Sequence search** — find the first occurrence of any digit sequence, then step through further occurrences with **Next**
- **Letters mode** — every pair of digits becomes a letter on a repeating alphabet, so words can be searched too
- **Sound effects** — a digital scanning sound while searching, a chime when a match is found, a buzz when it is not (synthesised in the browser, no audio files; mutable)
- **Fast navigation** — mouse wheel, touch drag with inertia, a scrub rail for the whole file, a "go to position" box, zoom and keyboard shortcuts
- **Zero dependencies at runtime** — a single Node.js file serves the API and the static frontend

## Requirements

- [Node.js](https://nodejs.org/) 18 or later
- A pi digits file (see [Getting the pi digits](#getting-the-pi-digits))

## Installation

```bash
git clone https://github.com/MohamedBen21/PI-search.git
cd PI-search
mkdir data            # skip if the folder already exists
```
The repository includes `data/pi-1.txt`, the first 30 million digits of pi, so the site works right after cloning. If `data/pi.txt` exists, the server uses it instead, so the larger file only needs to be added for deeper searches.

If you want the 750 million numbers then add the digits file as described below, and start the server:

```bash
node server.js
```

Open <http://localhost:3000>.

## Getting the pi digits

The server needs one text file, `data/pi.txt`, containing **only the decimal digits of pi after the "3."** — no spaces, no line breaks, no leading "3." (a leading `3.` is tolerated). It should start with `14159265358979…`.

The file is not stored in the repository because of its size. Choose one of the following.

### Option 1 — Download it from GitHub Releases (quickest)

The release [v1.0](https://github.com/MohamedBen21/PI-search/releases/tag/v1.0) provides a ready-to-use `pi.txt` (715 MB, 750 million digits of pi).

Download it directly into the `data/` folder:

```bash
# macOS, Linux, Windows 10+ (use curl.exe in PowerShell)
curl -L -o data/pi.txt https://github.com/MohamedBen21/PI-search/releases/download/v1.0/pi.txt
```

```powershell
# Windows PowerShell alternative
Invoke-WebRequest -Uri "https://github.com/MohamedBen21/PI-search/releases/download/v1.0/pi.txt" -OutFile "data/pi.txt"
```

Or [download `pi.txt` directly](https://github.com/MohamedBen21/PI-search/releases/download/v1.0/pi.txt) with your browser and move it into the `data/` folder. No cleaning is needed: the file is already in the format the server expects.

### Option 2 — Compute it with y-cruncher

[y-cruncher](https://numberworld.org/y-cruncher/) is a free program that computes pi to billions of digits in minutes.

1. Download y-cruncher and run it.
2. Choose **Custom Compute a Constant** → **Constant: Pi** → **Algorithm: Chudnovsky**.
3. Set **Decimal Digits** (for example `1b` for one billion) and **Digit Output: Plain Text File (.txt)**.
4. Start the computation. The default run writes several files; the one you need is `Pi - Dec - Chudnovsky.txt`. The `Hex` file and the small report file are not needed.
5. Clean the output into the format the server expects:

   ```bash
   # Windows, macOS, Linux (Node.js)
   node tools/clean-pi.js "Pi - Dec - Chudnovsky.txt" data/pi.txt

   # macOS, Linux, WSL (bash)
   tools/clean-pi.sh "Pi - Dec - Chudnovsky.txt" data/pi.txt
   ```

> **Memory:** in the default "Ram Only" mode y-cruncher needs roughly 4.4 GiB of free RAM per billion digits. If the menu warns about insufficient memory, lower the digit count or switch the computation mode to disk-based (Swap Mode).

### Option 3 — Generate a smaller file with Python

Useful for testing; practical up to roughly 100 million digits.

```bash
pip install gmpy2
python3 tools/gen-pi.py 30000000        # writes data/pi.txt
```

## Configuration

| Variable  | Default         | Description                    |
| --------- | --------------- | ------------------------------ |
| `PORT`    | `3000`          | HTTP port                      |
| `PI_FILE` | `data/pi.txt`   | Path to the digits file        |

```bash
PI_FILE=/path/to/pi.txt PORT=8080 node server.js
```

## Usage

### Searching

- Type a sequence into the search bar and press **Enter** or **Search**.
- On a match the view jumps to it and highlights it in yellow; **Next ›** finds the next occurrence and wraps around at the end of the file.
- Positions are 1-based after the decimal point: in `3.14159…` the first `1` is digit 1.

### Letters mode (123 / ABC)

The **123 / ABC** switch in the search bar changes the display from digits to letters. Digits are read in pairs starting from the first decimal digit, and the alphabet repeats:

| Pair      | Letter              |
| --------- | ------------------- |
| `01`–`26` | `a`–`z`             |
| `27`–`52` | `a`–`z` (again)     |
| `53`–`78` | `a`–`z` (again)     |
| `79`–`99` | `a`–`u`             |
| `00`      | `v` (counted as 100) |

Each letter therefore corresponds to three or four digit pairs. A word of *n* letters first appears after roughly 26ⁿ pairs, so words of up to about six letters are usually found in a file of one billion digits or more; longer words rarely are.

### Controls

| Action                | Control                                      |
| --------------------- | -------------------------------------------- |
| Scroll                | Mouse wheel, drag, touch, `↑` `↓` `PgUp` `PgDn` |
| Jump across the file  | Rail on the right edge                       |
| Jump to a position    | "go to" box (top right)                      |
| Zoom                  | `A−` / `A+` buttons or `Ctrl` + wheel        |
| Focus the search bar  | `/`                                          |
| Clear the highlight   | `Esc`                                        |
| Mute / unmute         | Speaker icon                                 |

## How it works

The digits file is never loaded into memory. The browser requests only the slice it is displaying, and searches stream through the file in 16 MB chunks on the server.

| Endpoint                                   | Purpose                                                        |
| ------------------------------------------ | -------------------------------------------------------------- |
| `GET /api/info`                            | Number of digits available                                     |
| `GET /api/digits?start=&len=`              | A slice of digits (at most 20,000)                             |
| `GET /api/search?q=<digits>&from=&wrap=`   | First occurrence of a digit sequence at or after `from`        |
| `GET /api/search?w=<word>&from=&wrap=`     | First pair-aligned occurrence of a word (letters mode)         |

A search returns `{ found, index, length, total, ms }`, where `index` is the 0-based start position.

## Project structure

```
server.js            Node.js server (API + static files)
public/              Frontend (index.html, style.css, app.js, fonts)
tools/gen-pi.py      Generate pi digits with Python (small/medium sizes)
tools/clean-pi.js    Convert a y-cruncher dump into the server format (cross-platform)
tools/clean-pi.sh    Same, as a bash script
data/                Place pi.txt here (not tracked by git)
```

## Credits

- Digits of pi computed with [y-cruncher](https://numberworld.org/y-cruncher/) by Alexander J. Yee
- Typeface: [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (SIL Open Font License)
