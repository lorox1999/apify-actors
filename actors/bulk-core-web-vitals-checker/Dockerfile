FROM apify/actor-node-puppeteer-chrome:22 AS builder

USER root
RUN npm install -g pnpm@10.33.3
USER myuser
WORKDIR /usr/src/app

COPY --chown=myuser:myuser package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY --chown=myuser:myuser actors/bulk-core-web-vitals-checker actors/bulk-core-web-vitals-checker
COPY --chown=myuser:myuser packages/common/package.json packages/common/package.json
COPY --chown=myuser:myuser actors/sitemap-url-diff-extractor/package.json actors/sitemap-url-diff-extractor/package.json
COPY --chown=myuser:myuser actors/rising-repos-for-github/package.json actors/rising-repos-for-github/package.json

RUN pnpm install --frozen-lockfile --filter bulk-core-web-vitals-checker...
RUN pnpm --filter bulk-core-web-vitals-checker build

FROM apify/actor-node-puppeteer-chrome:22
USER root
WORKDIR /usr/src/app
COPY --from=builder --chown=myuser:myuser /usr/src/app/actors/bulk-core-web-vitals-checker/dist ./dist
RUN npm install --omit=dev --no-package-lock apify@3.7.2 \
    && chown -R myuser:myuser /usr/src/app
USER myuser
CMD ["node", "dist/main.js"]
