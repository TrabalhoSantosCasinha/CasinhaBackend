# Imagem do backend da Casinha (usada pelo deploy na VM)
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# pasta de dados gravável pelo usuário "node" (vira um volume no compose)
RUN mkdir -p data && chown -R node:node data
USER node
EXPOSE 4000
CMD ["node", "server.js"]
