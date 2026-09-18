# Carbide Grade Estimator

A single-page tool that predicts hardness, fracture toughness, TRS, density and coercivity for a WC–Co carbide grade from its cobalt content and grain size — branded for EVERPADS.

No build step, no dependencies. It's one `index.html` plus a logo image.

## Deploy on GitHub Pages

1. Create a new repo on GitHub (public or private — Pages works on both, private repos need GitHub Pro/Team/Enterprise for Pages).
2. From this folder:

   ```bash
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git branch -M main
   git push -u origin main
   ```

3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `root`** → Save.
4. Your page goes live at `https://<your-username>.github.io/<repo-name>/` within a minute or two.

## Local preview

Just open `index.html` directly in a browser — no server needed.
