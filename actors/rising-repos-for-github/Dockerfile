FROM apify/actor-node:22 AS builder

USER root
# The base image already ships a pnpm shim (EEXIST without --force), and /usr/src/app
# is not writable by myuser, so the throwaway builder stage runs as root.
RUN npm install -g --force pnpm@10.33.3
WORKDIR /usr/src/app

COPY --chown=myuser:myuser package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY --chown=myuser:myuser actors/rising-repos-for-github actors/rising-repos-for-github
COPY --chown=myuser:myuser packages/common/package.json packages/common/package.json
COPY --chown=myuser:myuser actors/sitemap-url-diff-extractor/package.json actors/sitemap-url-diff-extractor/package.json
COPY --chown=myuser:myuser actors/bulk-core-web-vitals-checker/package.json actors/bulk-core-web-vitals-checker/package.json

RUN pnpm install --frozen-lockfile --filter rising-repos-for-github...
RUN pnpm --filter rising-repos-for-github build

FROM apify/actor-node:22
USER root
WORKDIR /usr/src/app
COPY --from=builder --chown=myuser:myuser /usr/src/app/actors/rising-repos-for-github/dist ./dist
RUN npm install --omit=dev --no-package-lock apify@3.7.2 \
    && npm pkg set type=module \
    && chown -R myuser:myuser /usr/src/app
USER myuser
CMD ["node", "dist/main.js"]
