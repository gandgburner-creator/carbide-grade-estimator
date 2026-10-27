# PFAD Laboratory — deployed build

Live: https://gandgburner-creator.github.io/carbide-grade-estimator/pfad-lab/

This folder is a static production build of the PFAD laboratory application
(`npm run build` in `pfad/`). The build is from commit
23035ab89233b40717b5f0308f48c2492735dabb on branch
`claude/bible-master-build-prompt-xtrg6e`; the app shows that commit in its
top bar and writes it into every export. Source, user guide and tests are on
that branch, in `pfad/` (guide: `pfad/docs/LAB_APP.md`).

The app runs entirely in the browser. Simulations run in a Web Worker, and the
run library is stored in the browser's IndexedDB. Nothing is sent to a server.

To redeploy, run `npm run build` in `pfad/` on the source branch, then replace
the contents of this folder with `pfad/dist/` and keep this README.
