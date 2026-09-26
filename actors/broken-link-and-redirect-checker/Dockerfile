# Monorepo context is the repository root (see .actor/actor.json dockerContextDir).
FROM apify/actor-node:22 AS builder

USER root
# The base image already ships a pnpm shim (EEXIST without --force), and /usr/src/app
# is not writable by myuser, so the throwaway builder stage runs as root.
RUN npm install -g --force pnpm@10.33.3
WORKDIR /usr/src/app

COPY --chown=myuser:myuser package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY --chown=myuser:myuser packages/common packages/common
COPY --chown=myuser:myuser actors/broken-link-and-redirect-checker actors/broken-link-and-redirect-checker
COPY --chown=myuser:myuser actors/sitemap-url-diff-extractor/package.json actors/sitemap-url-diff-extractor/package.json
COPY --chown=myuser:myuser actors/rising-repos-for-github/package.json actors/rising-repos-for-github/package.json
COPY --chown=myuser:myuser actors/bulk-core-web-vitals-checker/package.json actors/bulk-core-web-vitals-checker/package.json

RUN pnpm install --frozen-lockfile --filter broken-link-and-redirect-checker... \
    && pnpm --filter broken-link-and-redirect-checker rebuild esbuild
# @apify-actors/common resolves to dist/index.js (package.json exports), so build it first.
RUN pnpm --filter @apify-actors/common build
RUN pnpm --filter broken-link-and-redirect-checker exec esbuild src/main.ts \
    --bundle \
    --platform=node \
    --target=node22 \
    --format=esm \
    --outfile=dist/main.js \
    --external:apify \
    --external:robots-parser \
    --external:undici

FROM apify/actor-node:22
USER root
WORKDIR /usr/src/app
COPY --from=builder --chown=myuser:myuser /usr/src/app/actors/broken-link-and-redirect-checker/dist ./dist
RUN npm install --omit=dev --no-package-lock apify@3.7.2 robots-parser@3.0.1 undici@7.16.0 \
    && npm pkg set type=module \
    && chown -R myuser:myuser /usr/src/app
USER myuser
CMD ["node", "dist/main.js"]
