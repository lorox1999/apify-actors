# Monorepo context is the repository root (see .actor/actor.json dockerContextDir).
# Lighthouse 13 requires Node >= 22.19. The Apify Chrome image tag :22 supplies both.
FROM apify/actor-node-puppeteer-chrome:22 AS builder

USER root
# The base image already ships a pnpm shim (EEXIST without --force), and /usr/src/app
# is not writable by myuser, so the throwaway builder stage runs as root.
RUN npm install -g --force pnpm@10.33.3
WORKDIR /usr/src/app

COPY --chown=myuser:myuser package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY --chown=myuser:myuser packages/common packages/common
COPY --chown=myuser:myuser actors/bulk-core-web-vitals-checker actors/bulk-core-web-vitals-checker
COPY --chown=myuser:myuser actors/sitemap-url-diff-extractor/package.json actors/sitemap-url-diff-extractor/package.json
COPY --chown=myuser:myuser actors/rising-repos-for-github/package.json actors/rising-repos-for-github/package.json

RUN pnpm install --frozen-lockfile --filter bulk-core-web-vitals-checker... \
    && pnpm --filter bulk-core-web-vitals-checker rebuild esbuild
# @apify-actors/common resolves to dist/index.js (package.json exports), so build it first.
RUN pnpm --filter @apify-actors/common build
RUN pnpm --filter bulk-core-web-vitals-checker exec esbuild src/main.ts \
    --bundle \
    --platform=node \
    --target=node22 \
    --format=esm \
    --outfile=dist/main.js \
    --external:apify \
    --external:lighthouse \
    --external:lighthouse/* \
    --external:chrome-launcher \
    --external:robots-parser

FROM apify/actor-node-puppeteer-chrome:22
USER root
WORKDIR /usr/src/app
COPY --from=builder --chown=myuser:myuser /usr/src/app/actors/bulk-core-web-vitals-checker/dist ./dist
RUN node -e "const [maj,min]=process.versions.node.split('.').map(Number); if(maj<22||(maj===22&&min<19)){console.error('Node >= 22.19 required for Lighthouse 13, found '+process.version); process.exit(1)}" \
    && npm install --omit=dev --no-package-lock apify@3.7.2 lighthouse@13.5.0 chrome-launcher@1.2.1 robots-parser@3.0.1 \
    && npm pkg set type=module \
    && chown -R myuser:myuser /usr/src/app
USER myuser
CMD ["node", "dist/main.js"]
