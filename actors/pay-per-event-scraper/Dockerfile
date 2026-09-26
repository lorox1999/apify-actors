# Apify base image with Node.js 22 (used when deploying the Actor to the Apify platform).
FROM apify/actor-node:22

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version

# Copy the rest of the source code.
COPY . ./

CMD ["npm", "start", "--silent"]
