# PFAD Laboratory — deployed build

Live: https://gandgburner-creator.github.io/carbide-grade-estimator/pfad-lab/

This folder is a static production build of the PFAD laboratory application
(`npm run build` in `pfad/`). The build is from commit
b6d43daca6cfac072ba073df1246297220e5e579 on branch
`claude/bible-master-build-prompt-xtrg6e`; the app shows that commit in its
top bar and writes it into every export. Source, user guide and tests are on
that branch, in `pfad/` (guide: `pfad/docs/LAB_APP.md`).

The app has two workspaces: the **Laboratory** and, new in this build, the
**Flow-guided geometry** workspace, set up in plain units (cm, °C, m, km/h, degrees), with a live fill that grows the surface while the simulation runs and an auto-build button (experimental: the detector is not validated,
nothing is optimised; guide: `pfad/docs/FLOW_GUIDED_GEOMETRY.md`). Universe B is
locked in both.

The app runs entirely in the browser. Simulations run in a Web Worker, and the
run library is stored in the browser's IndexedDB. Nothing is sent to a server.

To redeploy, run `npm run build` in `pfad/` on the source branch, then replace
the contents of this folder with `pfad/dist/` and keep this README.
