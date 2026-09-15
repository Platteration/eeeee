FROM node:24-bookworm-slim AS build
WORKDIR /build
COPY package*.json ./
COPY tools/prepare-ocr.js tools/prepare-ocr.js
RUN npm ci --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8000 OCR_DATA_DIR=/data
WORKDIR /app
COPY --from=build /build/vendor ./vendor
COPY index.html styles.css privacy.html ./
COPY src ./src
COPY server ./server
COPY tools/serve.js ./tools/serve.js
COPY package.json ./
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8000
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "tools/serve.js"]
