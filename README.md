# EVERPADS — Milling picks: technical review

An interactive technical report on tungsten-carbide milling picks, prepared for
Mirzam Gulf Contracting Co., Kuwait.

**Live:** https://gandgburner-creator.github.io/carbide-grade-estimator/

It compares the EVERPADS milling pick with the AOJI-6/20 pick on the evidence
both sides can check — the two published grade sheets — and shows every
calculation it uses rather than asking anyone to take a number on trust.

## What's in it

Fifteen sections, all of them live: move a control and the microstructure, the
charts and the numbers recompute from one shared model.

- **Pick anatomy** — carbide tip, steel body, wear plate, sleeve, each with the
  failure mode it owns.
- **Rotation** — a moment balance about the pick axis showing how attack angle,
  tip concentricity, shank coating, debris ingress and sleeve deformation decide
  whether a pick indexes or drags.
- **Grain visualiser** — two microstructures side by side at the same field of
  view and the same 6% cobalt, so the grain-size difference is visible directly.
- **The physics** — the seven equations the report runs on, written out, with
  live values: volume fraction, contiguity, Fullman's mean free path,
  Hall–Petch hardness, fracture toughness, critical flaw size, coercivity.
- **Grade estimator** — cobalt and grain size in, a full predicted grade sheet out.
- **Trade-off charts** — hardness and toughness against grain size, on separate
  panels sharing one x-axis.
- **Duty-weighted service life** — why the harder grade is the shorter-lived one
  on asphalt, with the impact share of the duty as the single judgement input.
- **Sheet reconciliation** — the four places the AOJI sheet does not agree with
  itself, plus a solver that turns a measured hardness back into a grain size.
- **Coercivity** — the non-destructive measurement that settles the question.
- **Sintering** — Ostwald ripening, and what a furnace drift of ±60 °C does to
  a grade that a hardness test alone would still pass.
- **Steel body** — induction case/core hardness profile, coating, wear plate, sleeve.
- **Certificate checklist, consistency, commercial position, references.**

## Model

Calibrated on the EVERPADS measured grade sheet alone: 6% cobalt at 5 µm
reproduces its 87.6–88.4 HRA and 66–80 Oe. With no further adjustment the same
fit returns 89.9–90.9 HRA for a 6% cobalt grade at 1.2–2.0 µm, and back-solves
87.9 HRA at 6% cobalt to roughly 6.5 µm.

Every constant and what it is anchored to is listed in section 15 of the page,
along with what the model explicitly cannot tell you.

## Files

- `index.html` — the whole report. Self-contained: inline CSS and JS, no build
  step, no dependencies. The only external request is Google Fonts, and the page
  degrades to system fonts without it, so the file can be emailed and opened offline.
- `logo-mark.png` — EVERPADS mark, referenced from the page.

## Editing and deploying

Clone, edit `index.html`, commit, push to `main`. GitHub Pages serves from
`main` / root and redeploys automatically within about a minute. There is no
build and no Actions workflow to maintain.

Keep the header attribution — *Prepared for Mr. Hamad* / *Prepared by
Eng. Ghaith al elaiwi* — unless asked to remove it.

### House style

Dark industrial, from the EVERPADS parts-catalogue app:

| Token | Value |
|---|---|
| Background / surface / border | `#141414` / `#1e1e1e` / `#2d2d2d` |
| Ink / muted | `#f3f1ec` / `#98958d` |
| Accent | `#F6AC1B` → `#EA8900` |
| Chart green / blue | `#5BD08C` / `#7FB3F5` |
| Status red | `#f2694f` — reserved for status only, never a data series |
| Fonts | Oswald (display), Inter (body), JetBrains Mono (numbers) |

### Two content rules carried over from the source documents

- The shank coating is described only as a **proprietary zinc–aluminium flake
  coating**. The internal guide marks the trade name as confidential and
  instructs staff to call it a proprietary coating with clients. Do not name it
  on this page.
- The page uses the **grade-sheet figures** (4.0–6.0 µm, 87.6–88.4 HRA), not the
  internal training guide's "20 µm crystal size / 95 HRC" line, which is not
  consistent with the grade sheet and would undercut the report's own argument.
