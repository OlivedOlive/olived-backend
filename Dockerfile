FROM node:22-slim
WORKDIR /app
# Prisma's migration tool needs OpenSSL, which the slim image leaves out.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY . .
# Dev packages stay installed because the Prisma CLI runs migrations and the seed on the server.
RUN npm ci && npm run build
ENV NODE_ENV=production
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
