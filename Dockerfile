FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

RUN addgroup -g 1001 -S nodejs && \
    adduser -S botuser -u 1001 -G nodejs

USER botuser

EXPOSE 3000

ENV PORT=3000

CMD ["node", "index.js"]
