# Embedded Engineer Portfolio

A modern, production-ready personal portfolio website built with [Astro](https://astro.build) and [TailwindCSS](https://tailwindcss.com).

## Tech Stack

- **Astro** — Static site generation with content collections
- **TailwindCSS** — Utility-first styling with dark mode
- **TypeScript** — Type-safe content schemas and utilities
- **Markdown** — Blog posts and project pages

## Local Development

```bash
# Install dependencies
npm install

# Start dev server at http://localhost:4321
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Adding a New Project

Create a file at `src/content/projects/your-project-name.md`:

```markdown
---
title: "Your Project Title"
description: "A short one-paragraph description shown in cards and meta tags."
date: 2024-12-01
tags: ["STM32", "FreeRTOS", "C"]
coverImage: "/images/projects/your-project.jpg"
status: "completed"          # completed | in-progress | archived
githubUrl: "https://github.com/yourusername/your-repo"
demoUrl: "https://your-demo-url.com"  # optional
featured: false               # true → shown on homepage
order: 10                    # sort order for featured list (lower = first)
---

## Overview

Write your full project description in Markdown here...
```

No other code changes required — the project appears automatically on `/projects`.

## Adding a New Blog Post

Create a file at `src/content/blog/your-post-slug.md`:

```markdown
---
title: "Your Article Title"
description: "A compelling one-sentence description."
date: 2024-12-01
tags: ["Zephyr", "BLE", "IoT"]
coverImage: "/images/blog/your-cover.jpg"  # optional
draft: false      # true → excluded from build
featured: false   # true → shown on homepage
---

## Introduction

Write your article content in Markdown here...
```

The post appears automatically on `/blog`.

## Personalizing the Site

### 1. Your info — edit ONE file: `src/config.ts`

This is the single source of truth. Editing it updates the navbar, hero,
footer, contact section, SEO meta tags, and structured data automatically:

```ts
export const SITE = {
  name: 'Dat Nguyen',              // your display name
  initials: 'DN',                 // logo initials
  title: 'Embedded Software Engineer',
  intro: '...',                   // hero paragraph
  location: 'Hanoi, Vietnam',
  email: 'nguyendatmc581@gmail.com',
  url: 'https://dantng.github.io',
  githubUsername: 'dantng', // used by the /repos page
};

export const SOCIALS = {
  github:   'https://github.com/dantng',
  facebook: 'https://facebook.com/nguyen.tien.at.471119/',
  linkedin: 'https://linkedin.com/in/dantnguyen581/',
  twitter:  '',   // leave '' to hide
};
```

> Any social link left as `''` is automatically hidden everywhere.

### 2. Longer prose (still manual)

These pages contain long-form content unique to you:

| File | What to change |
|------|---------------|
| `src/components/Timeline.astro` | Your career history |
| `src/pages/about.astro` | Full bio and skills |
| `src/pages/resume.astro` | Work experience and education |
| `astro.config.mjs` | `site` URL for your GitHub Pages domain |
| `public/favicon.svg` | Your logo/initials |

## GitHub Repositories (auto-synced)

The `/repos` page automatically fetches **all your public repositories**
from GitHub at build time and renders each repo's **README** as its own page
(`/repos/<repo-name>`). No manual work — just set `githubUsername` in
`src/config.ts`.

- Forks and archived repos are excluded; repos are sorted by stars.
- READMEs are rendered with relative image/link paths rewritten to absolute
  GitHub URLs so images display correctly.

### Avoiding GitHub rate limits

Unauthenticated builds are limited to 60 API requests/hour. If you have many
repos or build often, set a token (a classic token with `public_repo` scope
is enough):

```bash
# Local
export GITHUB_TOKEN=ghp_xxx        # macOS/Linux
$env:GITHUB_TOKEN = "ghp_xxx"      # Windows PowerShell
npm run build
```

In GitHub Actions, the built-in `GITHUB_TOKEN` is passed automatically — see
`.github/workflows/deploy.yml`.

## Deployment to GitHub Pages

### First-time setup

1. Push this repo to GitHub
2. Go to **Settings → Pages** in your repository
3. Under **Source**, select **GitHub Actions**
4. Edit `astro.config.mjs` and set `site` to your GitHub Pages URL:
   ```js
   site: 'https://yourusername.github.io'
   // or for a project page:
   // site: 'https://yourusername.github.io/repo-name'
   // base: '/repo-name'
   ```
5. Push to `main` — the workflow in `.github/workflows/deploy.yml` handles the rest

### Custom domain

1. Add your domain in **Settings → Pages → Custom domain**
2. Create a `CNAME` file in `/public/` containing your domain:
   ```
   your-domain.com
   ```
3. Update `site` in `astro.config.mjs` to your custom domain

## Project Structure

```
src/
├── components/       # Reusable Astro components
├── content/
│   ├── config.ts    # Content collection schemas
│   ├── blog/        # Blog post Markdown files
│   └── projects/    # Project Markdown files
├── layouts/         # Page layouts (Base, Blog, Project)
├── pages/           # File-based routing
├── styles/          # Global CSS
└── utils/           # TypeScript utilities
public/              # Static assets (images, favicon)
.github/workflows/   # CI/CD pipeline
```

## Image Recommendations

Place project and blog cover images in `public/images/`:

```
public/
└── images/
    ├── blog/
    │   └── your-post-cover.jpg    # 1200×630 px recommended
    └── projects/
        └── your-project.jpg       # 1200×630 px recommended
```

Supported formats: JPG, PNG, WebP, AVIF.
