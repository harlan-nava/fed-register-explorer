# Federal Register Policy Explorer

A static web app (React + D3 + Tailwind + Vite) to visualize Federal Register activity over time, with filters for Program Area → Structure → Part, and document-type controls.

## Local development

```bash
npm install
npm run dev
```

Visit the printed local URL.

## Build

```bash
npm run build
npm run preview
```

## Deploy — GitHub Pages (recommended)

This repo includes a GitHub Actions workflow that builds and publishes to Pages from `main`.

1. Create a new GitHub repo and push this project.
2. In your repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The included workflow uses `VITE_BASE="/<repo>/"` automatically, so assets resolve under your repository subpath.

After the workflow runs, your site will be live at:

```
https://<your-user>.github.io/<repo>/
```

## Deploy — Netlify or Vercel

- **Netlify**: New site from Git → build command `npm run build` → publish directory `dist`.
- **Vercel**: Import project → framework preset Vite → it just works.

