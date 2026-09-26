# Monorepo context is the repository root (see .actor/actor.json dockerContextDir).
FROM apify/actor-node:22 AS builder

USER root
RUN npm install -g pnpm@10.33.3
USER myuser
WORKDIR /usr/src/app

COPY --chown=myuser:myuser package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY --chown=myuser:myuser packages/common packages/common
COPY --chown=myuser:myuser actors/sitemap-url-diff-extractor actors/sitemap-url-diff-extractor
COPY --chown=myuser:myuser actors/rising-repos-for-github/package.json actors/rising-repos-for-github/package.json
COPY --chown=myuser:myuser actors/bulk-core-web-vitals-checker/package.json actors/bulk-core-web-vitals-checker/package.json

RUN pnpm install --frozen-lockfile --filter sitemap-url-diff-extractor... \
    && pnpm --filter sitemap-url-diff-extractor rebuild esbuild
RUN pnpm --filter sitemap-url-diff-extractor exec esbuild src/main.ts \
    --bundle \
    --platform=node \
    --target=node22 \
    --format=esm \
    --outfile=dist/main.js \
    --external:apify \
    --external:sax \
    --external:robots-parser

FROM apify/actor-node:22
USER root
WORKDIR /usr/src/app
COPY --from=builder --chown=myuser:myuser /usr/src/app/actors/sitemap-url-diff-extractor/dist ./dist
RUN npm install --omit=dev --no-package-lock apify@3.7.2 sax@1.6.1 robots-parser@3.0.1 \
    && chown -R myuser:myuser /usr/src/app
USER myuser
CMD ["node", "dist/main.js"]
