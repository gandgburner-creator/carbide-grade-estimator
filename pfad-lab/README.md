# PFAD Laboratory — deployed build

Live: https://gandgburner-creator.github.io/carbide-grade-estimator/pfad-lab/

This folder is a static production build of the PFAD laboratory application
(`npm run build` in `pfad/`). The build is from commit
7f707710c6ac35e3946dcebb3cf307514d08ef3e on branch
`claude/bible-master-build-prompt-xtrg6e`; the app shows that commit in its
top bar and writes it into every export. Source, user guide and tests are on
that branch, in `pfad/` (guide: `pfad/docs/LAB_APP.md`).

The app has three workspaces: the **Laboratory**, and two experimental construction workspaces (guide: `pfad/docs/FLOW_GUIDED_GEOMETRY.md`):
**Flow-guided geometry A · particles**, set up in plain units (cm, °C, m, km/h, degrees), which starts from a rounded plate (half-circle ends) and a
construction pointer with a straight tether to the trailing edge (by hand, one measured step, or a sweep), also with a live fill (one smooth pass from the first-found separation point, with a stop-and-keep button), an auto-build button, a CFD auto fill (the pointer moves by itself during one CFD run), streamlines that also work while a run goes, lift and drag in newtons and kilogram-force, plates whose leading and trailing round ends have different diameters, and a red dot, a pointer and a green dot (anchor): the red and the green dot stay on the wall and slide along it from the leading tip (0) to the trailing tip (dragged or typed, nothing else limits them), a curve that starts on the plate's wall leaves it tangentially, and the pointer is free above the wall, with adjustable arc directions between them,
streamlines of the mean flow, and the lift and drag on the plate (a scaled estimate that is not a prediction); and **Flow-guided geometry B · CFD**, the same
plate and pointer with a conventional lattice-Boltzmann Navier–Stokes solver instead of particles (separate from the particle research, no Universes, run at the highest
Reynolds number its resolution allows, validated only on channel flow and the circular cylinder). Both are experimental and not validated for airfoil performance;
nothing is optimised. Universe B is locked in all three.

The app runs entirely in the browser. Simulations (particles and CFD) run in Web Workers, and the
run library is stored in the browser's IndexedDB. Nothing is sent to a server.

To redeploy, run `npm run build` in `pfad/` on the source branch, then replace
the contents of this folder with `pfad/dist/` and keep this README.
